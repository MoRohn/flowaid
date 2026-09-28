"""One indexing job, run as a child process: ``python -m flowaid_pageindex.index_job <job-dir>``.

The parent writes ``spec.json`` (without credentials) and ``document.pdf`` into a private job
directory and passes the model's API key, when there is one, through the child's environment
(``FLOWAID_PAGEINDEX_JOB_API_KEY``), never on disk. The child reports progress as ``stage:<name>``
lines on stdout and writes ``result.json`` or ``error.json``. Being a separate process is what
makes a deadline or a cancellation real: the parent kills it.

The PageIndex SDK writes the document into the workspace's store only at the end of a
successful run, so a killed job leaves nothing half-written.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from .store import write_json_atomic


def stage(name: str) -> None:
    print(f"stage:{name}", flush=True)


ADVICE = {
    "SCANNED_PDF": " This PDF has no text layer (it is scanned or image-only), and local PageIndex does"
    " not run OCR. Run OCR on it first (for example with ocrmypdf) and upload the result.",
    "ENCRYPTED_PDF": " Remove the password protection and upload the file again.",
    "MODEL_AUTH": " Check the indexing model's credential in the source settings.",
}


def fail(job_dir: Path, code: str, message: str) -> int:
    message = message[:1800] + ADVICE.get(code, "")
    write_json_atomic(job_dir / "error.json", {"code": code, "message": message})
    return 1


def classify(message: str) -> str:
    text = message.lower()
    if "no text layer" in text or "scanned" in text or "all pages are blank" in text or "no content" in text:
        return "SCANNED_PDF"
    if "encrypted" in text or "password" in text:
        return "ENCRYPTED_PDF"
    if "only pdf" in text or "could not read pdf" in text:
        return "UNSUPPORTED_FORMAT"
    if "credential" in text or "api key" in text or "authentication" in text or "401" in text:
        return "MODEL_AUTH"
    if "rate limit" in text or "429" in text:
        return "MODEL_RATE_LIMITED"
    if "no layout structure" in text or "could not extract a structure" in text:
        return "NO_STRUCTURE"
    return "INDEXING_FAILED"


def count_pages(pdf: Path) -> int:
    import PyPDF2

    with open(pdf, "rb") as f:
        reader = PyPDF2.PdfReader(f)
        if reader.is_encrypted:
            raise ValueError("PDF is encrypted or password-protected")
        return len(reader.pages)


def run(job_dir: Path) -> int:
    spec = json.loads((job_dir / "spec.json").read_text(encoding="utf-8"))
    pdf = job_dir / "document.pdf"
    started = time.monotonic()

    stage("validating")
    try:
        pages = count_pages(pdf)
    except Exception as exc:  # PyPDF2 raises many types for broken files
        return fail(job_dir, classify(str(exc)) if "encrypt" in str(exc).lower() else "UNSUPPORTED_FORMAT",
                    f"the file could not be read as a PDF: {exc}")
    if pages > int(spec["maxPages"]):
        return fail(job_dir, "TOO_MANY_PAGES",
                    f"the PDF has {pages} pages; this service accepts at most {spec['maxPages']}")

    stage("indexing")
    try:
        from pageindex import PageIndexLocalClient
        from pageindex._version import sdk_version

        backend: dict = {}
        if spec["model"].get("apiBase"):
            backend["api_base"] = spec["model"]["apiBase"]
        key = os.environ.get("FLOWAID_PAGEINDEX_JOB_API_KEY")
        if key:
            backend["api_key"] = key
        client = PageIndexLocalClient(
            storage_path=spec["storagePath"],
            index_model=spec["model"]["litellm"],
            index_backend=backend or None,
            optimize=spec["optimize"],
        )
        submitted = client.submit_document(
            str(pdf),
            mode=spec["mode"],
            metadata={"flowaidIndexId": spec["indexId"], "flowaidJobId": spec["jobId"]},
        )
        stage("storing")
        doc_id = submitted["doc_id"]
        meta = client.get_document(doc_id)
        raw = client._api.raw_tree(doc_id)  # pinned 0.2.20: the stored tree with page spans
    except Exception as exc:
        return fail(job_dir, classify(str(exc)), str(exc))

    from .store import _outline

    write_json_atomic(job_dir / "result.json", {
        "docId": doc_id,
        "pageCount": int(meta.get("pageNum") or pages),
        "description": meta.get("description"),
        "tree": [_outline(n) for n in (raw or [])],
        "sdkVersion": sdk_version(),
        "mode": spec["mode"],
        "elapsedMs": int((time.monotonic() - started) * 1000),
    })
    return 0


if __name__ == "__main__":
    sys.exit(run(Path(sys.argv[1])))
