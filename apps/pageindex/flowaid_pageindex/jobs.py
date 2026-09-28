"""Indexing jobs: each runs in a child process (``index_job.py``) under a deadline and a
concurrency cap, and its record is kept on disk so a restarted service can still report how a
job ended. FlowAId owns the durable state; the service's records exist so the worker can poll
and so a finished result is never lost between two polls.

A job that was running when the service stopped is reported as failed with ``SERVICE_RESTARTED``
on the next start; the worker resubmits it (job ids make submission idempotent).
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from .store import Documents, Layout, check_job, check_workspace, read_json, write_json_atomic

TERMINAL = {"ready", "failed", "canceled"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Conflict(ValueError):
    pass


class JobManager:
    def __init__(
        self,
        layout: Layout,
        documents: Documents,
        *,
        concurrency: int,
        timeout_s: int,
        max_pages: int,
        child_argv: Optional[list[str]] = None,
        log: Callable[[str, dict], None] = lambda _msg, _data: None,
    ):
        self._layout = layout
        self._documents = documents
        self._timeout = timeout_s
        self._max_pages = max_pages
        self._argv = child_argv or [sys.executable, "-m", "flowaid_pageindex.index_job"]
        self._log = log
        self._slots = threading.BoundedSemaphore(concurrency)
        self._lock = threading.Lock()
        self._procs: dict[str, subprocess.Popen] = {}
        self._cancel: set[str] = set()
        self._reconcile()

    # ── records ──

    def _record(self, job_id: str) -> Optional[dict]:
        return read_json(self._layout.job_file(job_id))

    def _save(self, rec: dict) -> None:
        write_json_atomic(self._layout.job_file(rec["jobId"]), rec)

    def _update(self, job_id: str, **changes) -> dict:
        with self._lock:
            rec = self._record(job_id) or {}
            rec.update(changes)
            self._save(rec)
            return rec

    @staticmethod
    def public(rec: dict) -> dict:
        return {k: rec.get(k) for k in (
            "jobId", "workspaceId", "state", "stage", "createdAt", "startedAt", "endedAt", "result", "error",
        )}

    def _reconcile(self) -> None:
        for path in self._layout.jobs.glob("*.json"):
            rec = read_json(path)
            if rec and rec.get("state") not in TERMINAL:
                rec.update(state="failed", stage=None, endedAt=now_iso(),
                           error={"code": "SERVICE_RESTARTED",
                                  "message": "the PageIndex service restarted while this job ran; submit it again"})
                write_json_atomic(path, rec)
        # scratch left by a crash
        for leftover in self._layout.tmp.glob("job-*"):
            shutil.rmtree(leftover, ignore_errors=True)

    # ── API ──

    def get(self, workspace_id: str, job_id: str) -> Optional[dict]:
        rec = self._record(check_job(job_id))
        if not rec or rec.get("workspaceId") != check_workspace(workspace_id):
            return None
        return rec

    def submit(self, spec: dict, pdf: bytes) -> tuple[dict, bool]:
        """Starts a job; the same job id returns the existing record (created=False)."""
        job_id = check_job(spec["jobId"])
        workspace_id = check_workspace(spec["workspaceId"])
        with self._lock:
            existing = self._record(job_id)
            if existing:
                if existing.get("workspaceId") != workspace_id or existing.get("contentSha256") != spec["contentSha256"]:
                    raise Conflict("a job with this id already exists for different content")
                if existing.get("error", {}) and existing["error"].get("code") == "SERVICE_RESTARTED":
                    pass  # a resubmission after a restart runs again below
                else:
                    return existing, False
            rec = {
                "jobId": job_id,
                "workspaceId": workspace_id,
                "indexId": spec["indexId"],
                "contentSha256": spec["contentSha256"],
                "state": "queued",
                "stage": "queued",
                "createdAt": now_iso(),
                "startedAt": None,
                "endedAt": None,
                "result": None,
                "error": None,
            }
            self._save(rec)
        job_dir = self._layout.scratch()
        os.chmod(job_dir, 0o700)
        (job_dir / "document.pdf").write_bytes(pdf)
        child_spec = {
            "jobId": job_id,
            "indexId": spec["indexId"],
            "mode": spec["mode"],
            "optimize": spec["optimize"],
            "model": {k: v for k, v in spec["model"].items() if k != "apiKey"},
            "storagePath": str(self._layout.workspace(workspace_id)),
            "maxPages": self._max_pages,
        }
        write_json_atomic(job_dir / "spec.json", child_spec)
        api_key = spec["model"].get("apiKey")
        threading.Thread(
            target=self._run, args=(rec, job_dir, api_key), name=f"job-{job_id}", daemon=True
        ).start()
        return rec, True

    def cancel(self, workspace_id: str, job_id: str) -> Optional[dict]:
        rec = self.get(workspace_id, job_id)
        if not rec:
            return None
        if rec["state"] in TERMINAL:
            # a finished document whose build was cancelled upstream must not be published
            return rec
        with self._lock:
            self._cancel.add(job_id)
            proc = self._procs.get(job_id)
        if proc and proc.poll() is None:
            _kill(proc)
        return self._update(job_id, state="canceled", stage=None, endedAt=now_iso())

    # ── the runner ──

    def _run(self, rec: dict, job_dir: Path, api_key: Optional[str]) -> None:
        job_id = rec["jobId"]
        try:
            self._slots.acquire()
            try:
                if job_id in self._cancel:
                    return
                self._update(job_id, state="running", stage="starting", startedAt=now_iso())
                env = {k: v for k, v in os.environ.items() if not k.startswith("FLOWAID_PAGEINDEX_TOKEN")}
                if api_key:
                    env["FLOWAID_PAGEINDEX_JOB_API_KEY"] = api_key
                proc = subprocess.Popen(
                    [*self._argv, str(job_dir)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    env=env,
                    start_new_session=True,
                )
                with self._lock:
                    self._procs[job_id] = proc
                deadline = time.monotonic() + self._timeout
                timer = threading.Timer(self._timeout, lambda: _kill(proc))
                timer.start()
                assert proc.stdout is not None
                for line in proc.stdout:
                    if line.startswith("stage:") and job_id not in self._cancel:
                        self._update(job_id, stage=line[6:].strip()[:40])
                proc.wait()
                timer.cancel()
                stderr = (proc.stderr.read() if proc.stderr else "")[-2000:]
                for pipe in (proc.stdout, proc.stderr):
                    if pipe:
                        pipe.close()
                with self._lock:
                    self._procs.pop(job_id, None)
                if job_id in self._cancel:
                    self._discard(rec, job_dir)
                    return
                if time.monotonic() >= deadline and proc.returncode != 0:
                    self._update(job_id, state="failed", stage=None, endedAt=now_iso(),
                                 error={"code": "TIMEOUT", "message": f"indexing took longer than {self._timeout} s"})
                    return
                result = read_json(job_dir / "result.json")
                if proc.returncode == 0 and result:
                    self._update(job_id, state="ready", stage=None, endedAt=now_iso(), result=result)
                    self._log("job ready", {"jobId": job_id, "pages": result.get("pageCount")})
                    return
                error = read_json(job_dir / "error.json") or {
                    "code": "INDEXING_FAILED",
                    "message": f"the indexer exited with {proc.returncode}: {_last_line(stderr)}",
                }
                self._update(job_id, state="failed", stage=None, endedAt=now_iso(), error=error)
                self._log("job failed", {"jobId": job_id, "code": error.get("code")})
            finally:
                self._slots.release()
        except Exception as exc:  # never leave a job running forever
            self._update(job_id, state="failed", stage=None, endedAt=now_iso(),
                         error={"code": "INTERNAL", "message": str(exc)[:500]})
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)

    def _discard(self, rec: dict, job_dir: Path) -> None:
        """A cancelled job that still produced a document: remove it so it is never read."""
        result = read_json(job_dir / "result.json")
        if result and result.get("docId"):
            self._documents.delete(rec["workspaceId"], result["docId"])
            self._log("discarded a cancelled job's document", {"jobId": rec["jobId"]})


def _kill(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def _last_line(text: str) -> str:
    lines = [ln for ln in text.strip().splitlines() if ln.strip()]
    return lines[-1][:300] if lines else "no output"
