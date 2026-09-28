"""A stand-in for ``flowaid_pageindex.index_job`` in the service tests:
``fake_indexer.py <behaviour> <job-dir>`` where behaviour is ready, scanned or slow."""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from flowaid_pageindex.store import write_json_atomic  # noqa: E402

behaviour, job_dir = sys.argv[1], Path(sys.argv[2])
spec = json.loads((job_dir / "spec.json").read_text())
assert "apiKey" not in json.dumps(spec), "the credential must not be written into the spec"
print("stage:indexing", flush=True)
if behaviour == "slow":
    time.sleep(30)
if behaviour == "scanned":
    write_json_atomic(job_dir / "error.json", {"code": "SCANNED_PDF", "message": "no text layer; run OCR"})
    sys.exit(1)

# "store" the document the way the SDK would: a directory in the workspace's store
import uuid  # noqa: E402

doc_id = "pi-" + uuid.uuid4().hex
write_json_atomic(Path(spec["storagePath"], doc_id, "meta.json"),
                  {"id": doc_id, "metadata": {"flowaidIndexId": spec["indexId"]}})
write_json_atomic(job_dir / "result.json", {
    "docId": doc_id,
    "pageCount": 3,
    "description": None,
    "tree": [{"nodeId": "0000", "title": "Only", "startPage": 1, "endPage": 3}],
    "sdkVersion": "0.2.20",
    "mode": spec["mode"],
    "elapsedMs": 1,
    "receivedKey": os.environ.get("FLOWAID_PAGEINDEX_JOB_API_KEY") == "sk-secret-canary",
    "indexId": spec["indexId"],
})
