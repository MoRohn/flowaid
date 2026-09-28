"""Per-workspace document stores and the job records.

PageIndex's local store has no tenancy: ``list_documents`` returns everything under its
``storage_path``. So each FlowAId workspace gets its own directory, and every read names the
workspace. Identifiers are validated before they touch the filesystem.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any, Optional

WORKSPACE_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
JOB_ID = WORKSPACE_ID
#: the local SDK's document ids ("pi-" + uuid4 hex)
DOC_ID = re.compile(r"^pi-[0-9a-f]{32}$")


class NotFound(LookupError):
    pass


def check_workspace(workspace_id: str) -> str:
    if not isinstance(workspace_id, str) or not WORKSPACE_ID.match(workspace_id):
        raise ValueError("workspaceId must be a lowercase UUID")
    return workspace_id


def check_doc(doc_id: str) -> str:
    if not isinstance(doc_id, str) or not DOC_ID.match(doc_id):
        raise ValueError("docId must look like pi-<32 hex>")
    return doc_id


def check_job(job_id: str) -> str:
    if not isinstance(job_id, str) or not JOB_ID.match(job_id):
        raise ValueError("jobId must be a lowercase UUID")
    return job_id


def write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def read_json(path: Path) -> Optional[Any]:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except ValueError:
        return None


class Layout:
    """Where things live under the data directory."""

    def __init__(self, data_dir: Path):
        self.root = data_dir
        self.workspaces = data_dir / "workspaces"
        self.jobs = data_dir / "jobs"
        self.tmp = data_dir / "tmp"
        for d in (self.workspaces, self.jobs, self.tmp):
            d.mkdir(parents=True, exist_ok=True)
            os.chmod(d, 0o700)

    def workspace(self, workspace_id: str) -> Path:
        path = self.workspaces / check_workspace(workspace_id)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def job_file(self, job_id: str) -> Path:
        return self.jobs / f"{check_job(job_id)}.json"

    def scratch(self) -> Path:
        """A private directory for one job's upload and results (removed by the caller)."""
        return Path(tempfile.mkdtemp(dir=self.tmp, prefix="job-"))


class Documents:
    """Reads against one workspace's PageIndex store, through the SDK's local client.

    ``client_factory(storage_path)`` builds a ``pageindex.PageIndexLocalClient``; it is a
    parameter so tests can run without the SDK installed.
    """

    def __init__(self, layout: Layout, client_factory):
        self._layout = layout
        self._factory = client_factory
        self._lock = threading.Lock()
        self._clients: dict[str, Any] = {}

    def client(self, workspace_id: str):
        with self._lock:
            c = self._clients.get(workspace_id)
            if c is None:
                c = self._factory(str(self._layout.workspace(workspace_id)))
                self._clients[workspace_id] = c
            return c

    def meta(self, workspace_id: str, doc_id: str) -> dict:
        check_doc(doc_id)
        try:
            return self.client(workspace_id).get_document(doc_id)
        except Exception as exc:  # the SDK raises PageIndexAPIError("… not found")
            raise NotFound(f"document {doc_id} not found") from exc

    def tree(self, workspace_id: str, doc_id: str) -> list[dict]:
        """The outline with page spans and summaries, without page text."""
        meta = self.meta(workspace_id, doc_id)
        client = self.client(workspace_id)
        raw = None
        api = getattr(client, "_api", None)
        # The public get_tree renames start_index and drops end_index; the local API keeps the
        # stored tree verbatim (pinned SDK 0.2.20, covered by the integration test).
        if api is not None and hasattr(api, "raw_tree"):
            raw = api.raw_tree(doc_id)
        if raw is None:
            raw = [_from_public(n) for n in client.get_tree(doc_id, node_summary=True)["result"]]
            _fill_end_pages(raw, int(meta.get("pageNum") or 0))
        return [_outline(n) for n in raw]

    def pages(self, workspace_id: str, doc_id: str, pages: list[int]) -> list[dict]:
        meta = self.meta(workspace_id, doc_id)
        count = int(meta.get("pageNum") or 0)
        bad = [p for p in pages if not 1 <= p <= count]
        if bad:
            raise ValueError(f"pages {bad} are outside 1..{count}")
        spec = ",".join(str(p) for p in sorted(set(pages)))
        out = self.client(workspace_id).get_page_content(doc_id, spec)
        return [{"page": int(p["page_index"]), "text": p.get("markdown") or ""} for p in out]

    def list_ids(self, workspace_id: str) -> list[dict]:
        client = self.client(workspace_id)
        docs, offset = [], 0
        while True:
            res = client.list_documents(limit=1000, offset=offset)
            batch = res.get("documents") or []
            docs.extend(
                {"docId": d.get("id"), "metadata": d.get("metadata"), "createdAt": d.get("createdAt")}
                for d in batch
            )
            offset += len(batch)
            if not batch or offset >= int(res.get("total") or 0):
                return docs

    def delete(self, workspace_id: str, doc_id: str) -> bool:
        check_doc(doc_id)
        try:
            self.client(workspace_id).delete_document(doc_id)
            return True
        except Exception:
            return False


def _outline(node: dict) -> dict:
    out = {
        "nodeId": node.get("node_id"),
        "title": node.get("title") or "",
        "startPage": node.get("start_index"),
        "endPage": node.get("end_index"),
    }
    if node.get("summary"):
        out["summary"] = node["summary"]
    children = node.get("nodes") or []
    if children:
        out["children"] = [_outline(c) for c in children]
    return out


def _from_public(node: dict) -> dict:
    out = {
        "node_id": node.get("node_id"),
        "title": node.get("title"),
        "start_index": node.get("page_index"),
        "summary": node.get("summary") or node.get("prefix_summary"),
    }
    if node.get("nodes"):
        out["nodes"] = [_from_public(c) for c in node["nodes"]]
    return out


def _fill_end_pages(nodes: list[dict], last: int) -> None:
    """Without stored end pages: a node ends where the next one at its level starts."""
    for i, n in enumerate(nodes):
        nxt = nodes[i + 1].get("start_index") if i + 1 < len(nodes) else None
        n["end_index"] = max(n.get("start_index") or 1, (nxt - 1) if nxt else last)
        if n.get("nodes"):
            _fill_end_pages(n["nodes"], n["end_index"])
