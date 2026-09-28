"""Protocol v1 against a running server: auth, validation, jobs (ready, failed, cancelled,
timed out, restarted), idempotency, workspace isolation and page reads.

The indexer child and the SDK store are replaced by small fakes here (the real SDK path is
``test_live.py``), so these tests need nothing beyond the standard library.
"""
from __future__ import annotations

import hashlib
import shutil
import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from flowaid_pageindex.config import Config  # noqa: E402
from flowaid_pageindex.server import serve  # noqa: E402
from flowaid_pageindex.store import read_json  # noqa: E402

TOKEN = "t" * 40
WS = "0199a000-0000-7000-8000-00000000aaaa"
OTHER = "0199a000-0000-7000-8000-00000000cccc"
FAKE_CHILD = Path(__file__).with_name("fake_indexer.py")
PDF = b"%PDF-1.7\nfake document\n%%EOF"


class FakeClient:
    """Stands in for pageindex.PageIndexLocalClient: one directory per document under the
    workspace's storage path (the fake indexer child creates them), so both processes see it."""

    def __init__(self, storage_path: str):
        self.root = Path(storage_path)

    def _meta(self, doc_id):
        meta = read_json(self.root / doc_id / "meta.json")
        if meta is None:
            raise RuntimeError("Document not found")
        return meta

    def get_document(self, doc_id):
        self._meta(doc_id)
        return {"id": doc_id, "pageNum": 3, "name": "a.pdf"}

    def get_tree(self, doc_id, node_summary=False):
        self._meta(doc_id)
        return {"result": [{"node_id": "0000", "title": "Only", "page_index": 1}]}

    def get_page_content(self, doc_id, pages):
        return [{"page_index": int(p), "markdown": f"text of page {p}"} for p in pages.split(",")]

    def list_documents(self, limit=50, offset=0):
        docs = [
            {"id": d.name, "metadata": read_json(d / "meta.json").get("metadata")}
            for d in sorted(self.root.iterdir())
            if (d / "meta.json").exists()
        ]
        return {"documents": docs[offset:offset + limit], "total": len(docs)}

    def delete_document(self, doc_id):
        self._meta(doc_id)
        shutil.rmtree(self.root / doc_id)


def frame(spec: dict, pdf: bytes = PDF) -> bytes:
    body = json.dumps({"protocol": "1", **spec}).encode()
    return len(body).to_bytes(4, "big") + body + pdf


def job_spec(job_id: str, workspace: str = WS, pdf: bytes = PDF, **extra) -> dict:
    return {
        "jobId": job_id,
        "workspaceId": workspace,
        "fileName": "a.pdf",
        "contentSha256": hashlib.sha256(pdf).hexdigest(),
        "mode": "flash",
        "optimize": "merge",
        "model": {"litellm": "ollama/qwen2.5:3b", "apiBase": "http://127.0.0.1:11434", "apiKey": "sk-secret-canary"},
        "indexId": "idx-1",
        **extra,
    }


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.start(timeout=30)

    def start(self, timeout: int, behaviour: str = "ready"):
        self.config = Config(token=TOKEN, data_dir=Path(self.dir.name), port=0, job_timeout_s=timeout,
                             concurrency=2)
        self.server = serve(
            self.config,
            client_factory=FakeClient,
            child_argv=[sys.executable, str(FAKE_CHILD), behaviour],
        )
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def stop(self):
        self.server.shutdown()
        self.server.server_close()

    def tearDown(self):
        self.stop()
        self.dir.cleanup()

    def call(self, method, path, body=None, token=TOKEN, ctype="application/json"):
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if token:
            req.add_header("authorization", f"Bearer {token}")
        if data is not None:
            req.add_header("content-type", ctype)
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return res.status, json.loads(res.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    def wait(self, job_id, workspace=WS, until=("ready", "failed", "canceled")):
        for _ in range(200):
            status, body = self.call("GET", f"/v1/jobs/{job_id}?workspaceId={workspace}")
            if body.get("state") in until:
                return body
            time.sleep(0.05)
        self.fail(f"job {job_id} did not finish: {body}")

    # ── tests ──

    def test_health_is_public_and_everything_else_needs_the_token(self):
        status, body = self.call("GET", "/healthz", token=None)
        self.assertEqual(status, 200)
        self.assertEqual(body["protocol"], "1")
        self.assertEqual(self.call("GET", f"/v1/workspaces/{WS}/documents", token=None)[0], 401)
        self.assertEqual(self.call("GET", f"/v1/workspaces/{WS}/documents", token="x" * 40)[0], 401)

    def test_a_job_runs_to_a_ready_document_and_its_credential_never_reaches_disk(self):
        job = "0199a000-0000-7000-8000-000000000001"
        status, body = self.call("POST", "/v1/jobs", frame(job_spec(job)), ctype="application/octet-stream")
        self.assertEqual(status, 202)
        self.assertIn(body["state"], ("queued", "running"))
        done = self.wait(job)
        self.assertEqual(done["state"], "ready")
        self.assertEqual(done["result"]["pageCount"], 3)
        self.assertEqual(done["result"]["tree"][0]["title"], "Only")
        # the fake indexer echoes whether it received the key through its environment
        self.assertTrue(done["result"]["receivedKey"])
        on_disk = "".join(p.read_text(errors="ignore") for p in Path(self.dir.name).rglob("*") if p.is_file())
        self.assertNotIn("sk-secret-canary", on_disk)
        # idempotent: the same job again returns the finished record
        status, again = self.call("POST", "/v1/jobs", frame(job_spec(job)), ctype="application/octet-stream")
        self.assertEqual((status, again["state"]), (200, "ready"))

    def test_rejects_bad_specs_hashes_formats_and_reused_ids(self):
        bad = job_spec("0199a000-0000-7000-8000-000000000002")
        self.assertEqual(self.call("POST", "/v1/jobs", frame({**bad, "mode": "cloud"}))[0], 400)
        self.assertEqual(self.call("POST", "/v1/jobs", frame({**bad, "model": {"litellm": "evil/x"}}))[0], 400)
        self.assertEqual(self.call("POST", "/v1/jobs", frame({**bad, "workspaceId": "../x"}))[0], 400)
        status, body = self.call("POST", "/v1/jobs", frame(bad, pdf=b"%PDF-changed"))
        self.assertEqual((status, body["error"]["code"]), (400, "HASH_MISMATCH"))
        docx = b"PK\x03\x04 not a pdf"
        status, body = self.call("POST", "/v1/jobs", frame({**bad, "contentSha256": hashlib.sha256(docx).hexdigest()}, pdf=docx))
        self.assertEqual((status, body["error"]["code"]), (415, "UNSUPPORTED_FORMAT"))
        self.call("POST", "/v1/jobs", frame(bad))
        other = b"%PDF-1.7 other"
        status, body = self.call("POST", "/v1/jobs", frame({**bad, "contentSha256": hashlib.sha256(other).hexdigest()}, pdf=other))
        self.assertEqual((status, body["error"]["code"]), (409, "CONFLICT"))

    def test_jobs_and_documents_are_invisible_to_other_workspaces(self):
        job = "0199a000-0000-7000-8000-000000000003"
        self.call("POST", "/v1/jobs", frame(job_spec(job)))
        doc = self.wait(job)["result"]["docId"]
        self.assertEqual(self.call("GET", f"/v1/jobs/{job}?workspaceId={OTHER}")[0], 404)
        self.assertEqual(self.call("GET", f"/v1/workspaces/{OTHER}/documents/{doc}/tree")[0], 404)
        self.assertEqual(self.call("POST", f"/v1/workspaces/{OTHER}/documents/{doc}/pages", {"pages": [1]})[0], 404)
        status, body = self.call("GET", f"/v1/workspaces/{WS}/documents")
        self.assertEqual(body["documents"], [{"docId": doc, "indexId": "idx-1"}])
        self.assertEqual(self.call("GET", f"/v1/workspaces/{OTHER}/documents")[1]["documents"], [])

    def test_reads_tree_and_pages_within_bounds_and_deletes(self):
        job = "0199a000-0000-7000-8000-000000000004"
        self.call("POST", "/v1/jobs", frame(job_spec(job)))
        doc = self.wait(job)["result"]["docId"]
        status, body = self.call("GET", f"/v1/workspaces/{WS}/documents/{doc}/tree")
        self.assertEqual(body["tree"][0], {"nodeId": "0000", "title": "Only", "startPage": 1, "endPage": 3})
        status, body = self.call("POST", f"/v1/workspaces/{WS}/documents/{doc}/pages", {"pages": [2, 1]})
        self.assertEqual(body["pages"], [{"page": 1, "text": "text of page 1"}, {"page": 2, "text": "text of page 2"}])
        self.assertEqual(self.call("POST", f"/v1/workspaces/{WS}/documents/{doc}/pages", {"pages": [9]})[0], 400)
        self.assertEqual(self.call("POST", f"/v1/workspaces/{WS}/documents/{doc}/pages", {"pages": list(range(1, 30))})[0], 400)
        self.assertEqual(self.call("GET", f"/v1/workspaces/{WS}/documents/not-a-doc/tree")[0], 400)
        self.assertEqual(self.call("DELETE", f"/v1/workspaces/{WS}/documents/{doc}")[1], {"deleted": True})
        self.assertEqual(self.call("GET", f"/v1/workspaces/{WS}/documents/{doc}/tree")[0], 404)

    def test_a_failing_indexer_reports_its_error_code(self):
        self.stop()
        self.start(timeout=30, behaviour="scanned")
        job = "0199a000-0000-7000-8000-000000000005"
        self.call("POST", "/v1/jobs", frame(job_spec(job)))
        done = self.wait(job)
        self.assertEqual((done["state"], done["error"]["code"]), ("failed", "SCANNED_PDF"))

    def test_cancel_kills_the_child_and_publishes_nothing(self):
        self.stop()
        self.start(timeout=30, behaviour="slow")
        job = "0199a000-0000-7000-8000-000000000006"
        self.call("POST", "/v1/jobs", frame(job_spec(job)))
        self.wait(job, until=("running",))
        status, body = self.call("DELETE", f"/v1/jobs/{job}?workspaceId={WS}")
        self.assertEqual((status, body["state"]), (200, "canceled"))
        time.sleep(0.5)
        self.assertEqual(self.call("GET", f"/v1/jobs/{job}?workspaceId={WS}")[1]["state"], "canceled")
        self.assertEqual(self.call("GET", f"/v1/workspaces/{WS}/documents")[1]["documents"], [])

    def test_a_job_past_its_deadline_fails_with_timeout(self):
        self.stop()
        self.start(timeout=1, behaviour="slow")
        job = "0199a000-0000-7000-8000-000000000007"
        self.call("POST", "/v1/jobs", frame(job_spec(job)))
        done = self.wait(job)
        self.assertEqual((done["state"], done["error"]["code"]), ("failed", "TIMEOUT"))

    def test_a_restart_fails_running_jobs_honestly_and_allows_resubmission(self):
        self.stop()
        self.start(timeout=30, behaviour="slow")
        job = "0199a000-0000-7000-8000-000000000008"
        self.call("POST", "/v1/jobs", frame(job_spec(job)))
        self.wait(job, until=("running",))
        self.stop()
        record = read_json(Path(self.dir.name) / "jobs" / f"{job}.json")
        self.assertEqual(record["state"], "running")
        self.start(timeout=30, behaviour="ready")
        status, body = self.call("GET", f"/v1/jobs/{job}?workspaceId={WS}")
        self.assertEqual((body["state"], body["error"]["code"]), ("failed", "SERVICE_RESTARTED"))
        status, body = self.call("POST", "/v1/jobs", frame(job_spec(job)))
        self.assertEqual(status, 202)
        self.assertEqual(self.wait(job)["state"], "ready")


if __name__ == "__main__":
    unittest.main()
