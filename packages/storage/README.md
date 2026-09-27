# @flowaid/storage

Where artifact bytes live: run artifacts written by nodes (`ctx.artifacts.put`) and code-export
packages. The worker writes, the api serves `GET /v1/artifacts/:id/download`.

- **`ArtifactStore`.** `put` / `get` / `open` (a stream plus its size) / `presign` / `delete` over
  opaque keys (`ws/<workspaceId>/<artifactId>`, never derived from user-supplied names). Keys that
  could escape the store (`..`, absolute paths, empty segments) are rejected.
- **`LocalArtifactStore`.** Files under one directory (`<data>/artifacts`, the `flowaid-data`
  volume in compose), `0700` directories and `0600` files. `presign` returns null.
- **`S3ArtifactStore`.** Any S3-compatible store (AWS S3, Cloudflare R2, self-hosted) spoken to
  directly with fetch and AWS Signature Version 4 (`sigv4.ts`, checked against the worked examples
  in the AWS documentation), path-style or virtual-hosted addressing, per-request timeouts. S3
  errors surface as retryable `NETWORK_ERROR`s carrying the S3 error code; a missing object is
  `NOT_FOUND`. `presign` builds a time-limited GET URL (at most 7 days) with optional
  `response-content-disposition` / `response-content-type`.
- **`artifactStorageFrom(env, localRoot)`.** S3 when `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` and
  `S3_SECRET_KEY` are all set, otherwise local. New artifacts go to `primary`; `forKind` reads a
  row from the store recorded in `artifacts.storage`, so local artifacts written before S3 was
  configured stay readable.

The api streams S3 downloads through itself rather than redirecting to a presigned URL, so the
object store does not have to be reachable from browsers (in compose it usually is not).

`startFakeS3()` is an in-process S3-compatible server for tests (path-style PUT/GET/HEAD/DELETE,
SigV4 verification of signed headers and presigned URLs, expiry). The storage, api and worker
tests run against it.
