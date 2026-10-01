---
"@flowaid/credentials": minor
"@flowaid/env": minor
---

AWS KMS master keys and AWS Secrets Manager references, without the AWS SDK.

- `FLOWAID_MASTER_KEY_PROVIDER=aws-kms` with a key or alias ARN in `FLOWAID_MASTER_KEY_ID` wraps
  the key-encryption keys with KMS `Encrypt`/`Decrypt` (`Decrypt` pinned to the configured key).
  `aws-sm:<secret ARN>[#<json key>]` external references resolve through Secrets Manager
  `GetSecretValue`.
- Requests are signed with Signature Version 4 over `node:crypto` (checked against AWS's
  published test-suite vectors) and sent through the injected fetch. Credentials come from
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`, else the ECS task role
  (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`), else the EC2 instance profile (IMDSv2); the region
  is the ARN's. `AWS_ENDPOINT_URL` points both services at LocalStack or a VPC endpoint.
