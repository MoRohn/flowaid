# @flowaid/credentials

## 0.10.0

### Patch Changes

- Updated dependencies [d568cf6]
  - @flowaid/workflow-core@0.10.0
  - @flowaid/env@0.10.0
  - @flowaid/shared@0.10.0

## 0.9.0

### Minor Changes

- b19f9bc: AWS KMS master keys and AWS Secrets Manager references, without the AWS SDK.

  - `FLOWAID_MASTER_KEY_PROVIDER=aws-kms` with a key or alias ARN in `FLOWAID_MASTER_KEY_ID` wraps
    the key-encryption keys with KMS `Encrypt`/`Decrypt` (`Decrypt` pinned to the configured key).
    `aws-sm:<secret ARN>[#<json key>]` external references resolve through Secrets Manager
    `GetSecretValue`.
  - Requests are signed with Signature Version 4 over `node:crypto` (checked against AWS's
    published test-suite vectors) and sent through the injected fetch. Credentials come from
    `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`, else the ECS task role
    (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`), else the EC2 instance profile (IMDSv2); the region
    is the ARN's. `AWS_ENDPOINT_URL` points both services at LocalStack or a VPC endpoint.

- feb43fe: Security and reliability hardening (P3-3, P3-4, P3-6, P3-7):

  - With `REDIS_URL`, request rate limits, sign-in throttles and the webhook replay cache are kept in Redis, so they hold across api replicas.
  - Migration 0012 gates the row-level-security bypass on membership in the new `flowaid_rls_bypass` role (granted to `flowaid_app` and the owner, never to the sandbox host's `flowaid_code`). A migrating role without `CREATEROLE` needs the role created first (see `docker/postgres-init/01-roles.sql`).
  - Each mutation's audit row is written inside the transaction that makes the change.
  - `flowaid keys rotate-master` (`pnpm keys`, `node dist/keys.js` in the api image) re-wraps every key-encryption key and re-seals every credential under a new master key, verified and resumable.
  - Timers are due by the database clock, not the worker's.

### Patch Changes

- Updated dependencies [b19f9bc]
- Updated dependencies [0778a7b]
- Updated dependencies [feb43fe]
- Updated dependencies [c630951]
- Updated dependencies [6b5c535]
  - @flowaid/env@0.9.0
  - @flowaid/workflow-core@0.9.0
  - @flowaid/shared@0.9.0

## 0.8.0

### Patch Changes

- @flowaid/env@0.8.0
  - @flowaid/shared@0.8.0
  - @flowaid/workflow-core@0.8.0

## 0.7.0

### Patch Changes

- @flowaid/env@0.7.0
  - @flowaid/shared@0.7.0
  - @flowaid/workflow-core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [e67dd32]
  - @flowaid/env@0.6.0
  - @flowaid/shared@0.6.0
  - @flowaid/workflow-core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [859e8fc]
- Updated dependencies [702ab83]
  - @flowaid/workflow-core@0.5.0
  - @flowaid/env@0.5.0
  - @flowaid/shared@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [dff6c83]
- Updated dependencies [bf0de6e]
- Updated dependencies [0a0ec14]
  - @flowaid/env@0.4.0
  - @flowaid/workflow-core@0.4.0
  - @flowaid/shared@0.4.0
