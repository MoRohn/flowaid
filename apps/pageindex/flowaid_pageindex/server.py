"""The HTTP surface (protocol v1), standard library only.

    GET    /healthz                                   liveness (no auth): protocol, service, SDK
    GET    /readyz                                    readiness (no auth): SDK importable, storage writable
    POST   /v1/jobs                                   start an indexing job (framed body, see below)
    GET    /v1/jobs/{jobId}?workspaceId=              a job's state, stage, result or error
    DELETE /v1/jobs/{jobId}?workspaceId=              cancel it
    GET    /v1/workspaces/{ws}/documents              the workspace's documents (for reconciliation)
    GET    /v1/workspaces/{ws}/documents/{docId}/tree the outline with page spans and summaries
    POST   /v1/workspaces/{ws}/documents/{docId}/pages  {"pages": [n, …]} → page text
    DELETE /v1/workspaces/{ws}/documents/{docId}

Every /v1 route needs ``Authorization: Bearer <FLOWAID_PAGEINDEX_TOKEN>`` (compared in constant
time). A job body is a 4-byte big-endian length, that many bytes of JSON spec, then the PDF.
Logs are JSON lines without document text or credentials.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import sys
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, urlparse

from . import PROTOCOL_VERSION, SERVICE_VERSION
from .config import Config
from .jobs import Conflict, JobManager
from .store import Documents, Layout, NotFound, check_doc, check_workspace

MAX_SPEC_BYTES = 64 * 1024
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def log(msg: str, data: Optional[dict] = None) -> None:
    sys.stderr.write(json.dumps({"level": "info", "msg": msg, "time": time.time(), **(data or {})}) + "\n")


def sdk_version() -> Optional[str]:
    try:
        from importlib.metadata import version

        return version("pageindex")
    except Exception:
        return None


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def validate_spec(spec: Any) -> dict:
    if not isinstance(spec, dict):
        raise ApiError(400, "BAD_REQUEST", "the job spec must be a JSON object")
    if spec.get("protocol") != PROTOCOL_VERSION:
        raise ApiError(400, "PROTOCOL", f"this service speaks protocol {PROTOCOL_VERSION}")
    try:
        check_workspace(spec.get("workspaceId"))
    except ValueError as exc:
        raise ApiError(400, "BAD_REQUEST", str(exc)) from exc
    if not isinstance(spec.get("contentSha256"), str) or not SHA256.match(spec["contentSha256"]):
        raise ApiError(400, "BAD_REQUEST", "contentSha256 must be 64 lowercase hex characters")
    if spec.get("mode") not in ("flash", "standard"):
        raise ApiError(400, "BAD_REQUEST", "mode must be flash or standard")
    if spec.get("optimize") not in ("merge", "full", "off"):
        raise ApiError(400, "BAD_REQUEST", "optimize must be merge, full or off")
    model = spec.get("model")
    if not isinstance(model, dict) or not isinstance(model.get("litellm"), str) or not re.match(
        r"^(openai|anthropic|ollama)/[\w.:\-/]{1,120}$", model["litellm"]
    ):
        raise ApiError(400, "BAD_REQUEST", "model.litellm must be openai/…, anthropic/… or ollama/…")
    if model.get("apiBase") is not None and not re.match(r"^https?://[^\s]{1,300}$", str(model["apiBase"])):
        raise ApiError(400, "BAD_REQUEST", "model.apiBase must be an http(s) URL")
    if not isinstance(spec.get("indexId"), str) or len(spec["indexId"]) > 64:
        raise ApiError(400, "BAD_REQUEST", "indexId is required")
    return spec


def make_handler(config: Config, jobs: JobManager, documents: Documents, sha256: Callable[[bytes], str]):
    token = config.token.encode()

    class Handler(BaseHTTPRequestHandler):
        server_version = f"flowaid-pageindex/{SERVICE_VERSION}"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:  # silence the default access log
            pass

        # ── plumbing ──

        def _send(self, status: int, body: Any) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _error(self, e: ApiError) -> None:
            self._send(e.status, {"error": {"code": e.code, "message": e.message}})

        def _authorized(self) -> bool:
            header = self.headers.get("authorization", "")
            given = header[7:].encode() if header.startswith("Bearer ") else b""
            return hmac.compare_digest(given, token)

        def _body(self, limit: int) -> bytes:
            length = int(self.headers.get("content-length") or 0)
            if length > limit:
                raise ApiError(413, "PAYLOAD_TOO_LARGE", f"the body may be at most {limit} bytes")
            return self.rfile.read(length) if length else b""

        def _route(self, method: str) -> None:
            url = urlparse(self.path)
            parts = [p for p in url.path.split("/") if p]
            query = parse_qs(url.query)
            try:
                if url.path == "/healthz" and method == "GET":
                    return self._send(200, {"ok": True, "protocol": PROTOCOL_VERSION,
                                            "service": SERVICE_VERSION, "sdk": sdk_version()})
                if url.path == "/readyz" and method == "GET":
                    return self._ready()
                if not self._authorized():
                    raise ApiError(401, "UNAUTHORIZED", "a valid bearer token is required")
                if self.headers.get("x-flowaid-protocol", PROTOCOL_VERSION) != PROTOCOL_VERSION:
                    raise ApiError(400, "PROTOCOL", f"this service speaks protocol {PROTOCOL_VERSION}")
                if parts[:2] == ["v1", "jobs"]:
                    return self._jobs(method, parts, query)
                if parts[:2] == ["v1", "workspaces"] and len(parts) >= 4 and parts[3] == "documents":
                    return self._documents(method, parts)
                raise ApiError(404, "NOT_FOUND", "no such route")
            except ApiError as e:
                self._error(e)
            except NotFound as e:
                self._error(ApiError(404, "NOT_FOUND", str(e)))
            except ValueError as e:
                self._error(ApiError(400, "BAD_REQUEST", str(e)))
            except Exception as e:  # noqa: BLE001 - the last line of defence
                log("unhandled error", {"error": type(e).__name__})
                self._error(ApiError(500, "INTERNAL", "the PageIndex service failed; see its log"))

        def do_GET(self) -> None:  # noqa: N802
            self._route("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._route("POST")

        def do_DELETE(self) -> None:  # noqa: N802
            self._route("DELETE")

        # ── routes ──

        def _ready(self) -> None:
            problems = []
            if sdk_version() is None:
                problems.append("the pageindex package is not installed")
            try:
                probe = config.data_dir / ".ready"
                probe.write_text("ok")
                probe.unlink()
            except OSError as exc:
                problems.append(f"the data directory is not writable: {exc.strerror}")
            self._send(200 if not problems else 503, {"ready": not problems, "problems": problems})

        def _jobs(self, method: str, parts: list[str], query: dict) -> None:
            if method == "POST" and len(parts) == 2:
                body = self._body(config.max_bytes + MAX_SPEC_BYTES + 4)
                if len(body) < 4:
                    raise ApiError(400, "BAD_REQUEST", "the job body is empty")
                n = int.from_bytes(body[:4], "big")
                if n > MAX_SPEC_BYTES or 4 + n > len(body):
                    raise ApiError(400, "BAD_REQUEST", "the job spec length is invalid")
                try:
                    spec = validate_spec(json.loads(body[4:4 + n].decode("utf-8")))
                except json.JSONDecodeError as exc:
                    raise ApiError(400, "BAD_REQUEST", "the job spec is not JSON") from exc
                pdf = body[4 + n:]
                if len(pdf) > config.max_bytes:
                    raise ApiError(413, "PAYLOAD_TOO_LARGE", f"the PDF may be at most {config.max_bytes} bytes")
                if not pdf.startswith(b"%PDF-"):
                    raise ApiError(415, "UNSUPPORTED_FORMAT", "local PageIndex indexes PDF files only")
                if sha256(pdf) != spec["contentSha256"]:
                    raise ApiError(400, "HASH_MISMATCH", "the PDF does not match contentSha256")
                try:
                    rec, created = jobs.submit(spec, pdf)
                except Conflict as exc:
                    raise ApiError(409, "CONFLICT", str(exc)) from exc
                log("job submitted" if created else "job resubmitted",
                    {"jobId": rec["jobId"], "bytes": len(pdf), "mode": spec["mode"], "model": spec["model"]["litellm"]})
                return self._send(202 if created else 200, JobManager.public(rec))
            if len(parts) == 3 and method in ("GET", "DELETE"):
                workspace_id = (query.get("workspaceId") or [""])[0]
                rec = jobs.cancel(workspace_id, parts[2]) if method == "DELETE" else jobs.get(workspace_id, parts[2])
                if not rec:
                    raise ApiError(404, "NOT_FOUND", "no such job in this workspace")
                return self._send(200, JobManager.public(rec))
            raise ApiError(405, "METHOD_NOT_ALLOWED", "unsupported method")

        def _documents(self, method: str, parts: list[str]) -> None:
            workspace_id = check_workspace(parts[2])
            if len(parts) == 4 and method == "GET":
                listed = documents.list_ids(workspace_id)
                return self._send(200, {"documents": [
                    {"docId": d["docId"], "indexId": (d.get("metadata") or {}).get("flowaidIndexId")} for d in listed
                ]})
            if len(parts) < 5:
                raise ApiError(404, "NOT_FOUND", "no such route")
            doc_id = check_doc(parts[4])
            if len(parts) == 5 and method == "DELETE":
                return self._send(200, {"deleted": documents.delete(workspace_id, doc_id)})
            if len(parts) == 6 and parts[5] == "tree" and method == "GET":
                return self._send(200, {"tree": documents.tree(workspace_id, doc_id)})
            if len(parts) == 6 and parts[5] == "pages" and method == "POST":
                try:
                    wanted = json.loads(self._body(16 * 1024) or b"{}").get("pages")
                except json.JSONDecodeError as exc:
                    raise ApiError(400, "BAD_REQUEST", "the body is not JSON") from exc
                if not isinstance(wanted, list) or not wanted or not all(isinstance(p, int) for p in wanted):
                    raise ApiError(400, "BAD_REQUEST", "pages must be a non-empty list of integers")
                if len(set(wanted)) > config.max_pages_per_read:
                    raise ApiError(400, "BAD_REQUEST", f"read at most {config.max_pages_per_read} pages at once")
                return self._send(200, {"pages": documents.pages(workspace_id, doc_id, wanted)})
            raise ApiError(404, "NOT_FOUND", "no such route")

    return Handler


def serve(config: Config, client_factory=None, child_argv=None) -> ThreadingHTTPServer:
    """Builds the server (not started). ``client_factory`` and ``child_argv`` are for tests."""
    import hashlib

    def default_factory(storage_path: str):
        from pageindex import PageIndexLocalClient

        return PageIndexLocalClient(storage_path=storage_path)

    layout = Layout(config.data_dir)
    documents = Documents(layout, client_factory or default_factory)
    jobs = JobManager(
        layout,
        documents,
        concurrency=config.concurrency,
        timeout_s=config.job_timeout_s,
        max_pages=config.max_pages,
        child_argv=child_argv,
        log=log,
    )
    handler = make_handler(config, jobs, documents, lambda b: hashlib.sha256(b).hexdigest())
    server = ThreadingHTTPServer((config.host, config.port), handler)
    server.daemon_threads = True
    return server


def main() -> int:
    from .config import ConfigError, load_config

    try:
        config = load_config()
    except ConfigError as exc:
        sys.stderr.write(f"flowaid-pageindex: {exc}\n")
        return 2
    os.umask(0o077)
    server = serve(config)
    log("listening", {"host": config.host, "port": server.server_address[1], "sdk": sdk_version(),
                      "dataDir": str(config.data_dir)})
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0
