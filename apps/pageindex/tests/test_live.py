"""The real path: the pinned PageIndex SDK and a real model, through the service.

Runs only when ``FLOWAID_PAGEINDEX_LIVE_MODEL`` names a LiteLLM model (e.g. ``ollama/qwen2.5:3b``;
``FLOWAID_PAGEINDEX_LIVE_API_BASE`` for Ollama, ``FLOWAID_PAGEINDEX_LIVE_API_KEY`` for hosted
models) and the ``pageindex`` package is importable. Uses the redistributable samples in
``fixtures/pageindex``.
"""
from __future__ import annotations

import hashlib
import json
import os
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

MODEL = os.environ.get("FLOWAID_PAGEINDEX_LIVE_MODEL")
SAMPLES = Path(__file__).resolve().parents[3] / "fixtures" / "pageindex"
TOKEN = "live" * 10
WS = "0199a000-0000-7000-8000-00000000aaaa"

try:
    import pageindex  # noqa: F401

    HAVE_SDK = True
except ImportError:
    HAVE_SDK = False


@unittest.skipUnless(MODEL and HAVE_SDK, "set FLOWAID_PAGEINDEX_LIVE_MODEL and install requirements.lock")
class LiveTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        cls.start()

    @classmethod
    def start(cls):
        cls.server = serve(Config(token=TOKEN, data_dir=Path(cls.dir.name), port=0, job_timeout_s=900))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def stop(cls):
        cls.server.shutdown()
        cls.server.server_close()

    @classmethod
    def tearDownClass(cls):
        cls.stop()
        cls.dir.cleanup()

    def call(self, method, path, body=None):
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("authorization", f"Bearer {TOKEN}")
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def index(self, name: str, job_id: str) -> dict:
        pdf = (SAMPLES / name).read_bytes()
        model = {"litellm": MODEL}
        if os.environ.get("FLOWAID_PAGEINDEX_LIVE_API_BASE"):
            model["apiBase"] = os.environ["FLOWAID_PAGEINDEX_LIVE_API_BASE"]
        if os.environ.get("FLOWAID_PAGEINDEX_LIVE_API_KEY"):
            model["apiKey"] = os.environ["FLOWAID_PAGEINDEX_LIVE_API_KEY"]
        spec = json.dumps({
            "protocol": "1", "jobId": job_id, "workspaceId": WS, "fileName": name,
            "contentSha256": hashlib.sha256(pdf).hexdigest(), "mode": "flash", "optimize": "off",
            "model": model, "indexId": f"idx-{job_id[-4:]}",
        }).encode()
        status, body = self.call("POST", "/v1/jobs", len(spec).to_bytes(4, "big") + spec + pdf)
        self.assertEqual(status, 202, body)
        deadline = time.monotonic() + 900
        while time.monotonic() < deadline:
            _, body = self.call("GET", f"/v1/jobs/{job_id}?workspaceId={WS}")
            if body["state"] in ("ready", "failed", "canceled"):
                return body
            time.sleep(1)
        self.fail("indexing did not finish in 15 minutes")

    def test_1_indexes_a_real_pdf_reads_its_tree_and_pages_and_survives_a_restart(self):
        done = self.index("northwind-travel-policy.pdf", "0199a000-0000-7000-8000-00000000f001")
        self.assertEqual(done["state"], "ready", done.get("error"))
        result = done["result"]
        self.assertEqual(result["pageCount"], 4)
        self.assertEqual(result["sdkVersion"], "0.2.20")
        titles = json.dumps(result["tree"])
        self.assertIn("Booking travel", titles)
        doc = result["docId"]
        # restart: a new service over the same data directory still serves the index
        type(self).stop()
        type(self).start()
        _, tree = self.call("GET", f"/v1/workspaces/{WS}/documents/{doc}/tree")
        flat = []

        def walk(nodes):
            for n in nodes:
                flat.append(n)
                walk(n.get("children", []))

        walk(tree["tree"])
        self.assertTrue(all(1 <= n["startPage"] <= n["endPage"] <= 4 for n in flat), flat)
        hotels = next(n for n in flat if "Hotels" in n["title"])
        _, pages = self.call("POST", f"/v1/workspaces/{WS}/documents/{doc}/pages", {"pages": [hotels["startPage"]]})
        self.assertIn("$260", pages["pages"][0]["text"])

    def test_2_refuses_a_scanned_pdf_with_an_actionable_error(self):
        done = self.index("northwind-support-handbook-scanned.pdf", "0199a000-0000-7000-8000-00000000f002")
        self.assertEqual(done["state"], "failed")
        self.assertEqual(done["error"]["code"], "SCANNED_PDF", done["error"])
        self.assertIn("OCR", done["error"]["message"])


if __name__ == "__main__":
    unittest.main()
