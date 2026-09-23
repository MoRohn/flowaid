# @flowaid/credentials

How flowaid keeps secrets: envelope encryption, master keys, external references, redaction and
the credential type catalog. It never imports the database; storage is injected through
`CredentialRepository` and `KekStore`. Design: [ARCHITECTURE.md §10.6](../../docs/design/ARCHITECTURE.md).

## Envelope

```
master key (env | file | AWS KMS | Vault Transit)
 └─ wraps KEK versions            encryption_keys: wrapped_kek, master_kcv, active
     └─ wraps one DEK per credential   AAD id|dek|version
         └─ seals the field record     AES-256-GCM, AAD id|type|version
```

- A ciphertext copied onto another credential, type or key version fails authentication.
- `rotate()` moves a credential to the active KEK version; `KeyRing.createVersion()` starts one.
- `KeyRing.rotateMaster(next)` re-wraps every KEK in one store call. Credentials are untouched.
- `KeyRing.verifyMaster()` runs at boot: a different master fails with `E_MASTER_KEY_MISMATCH`
  (KCV = first 8 bytes of `HMAC-SHA256(master, 'flowaid/master-kcv/v1')`; KMS and Vault
  fingerprint the key identity, since the key never leaves them).
- The file provider creates a missing key with `O_CREAT | O_EXCL` and mode 0600, under a lock the
  caller provides, and only when autogeneration is allowed.

## External references

`env:FLOWAID_SECRET_<NAME>` (never a platform setting such as `FLOWAID_MASTER_KEY`),
`vault:<mount>/<path>#<key>`, `aws-sm:<arn>[#<json key>]`, and `azure-kv:` / `gcp-sm:` (parsed
now, resolved in P6-07). Resolved values are cached for five minutes.

## Redactor

Every decrypted value and secret environment variable is learned, with its base64, base64url and
URL-encoded forms, and scrubbed from anything persisted. Pointer rules from the compiled plan
mask PII, hash sensitive values and drop `doNotPersist` outputs.

## Types

`typesafe.api_key`, `openai.api_key`, `anthropic.api_key`, `google.api_key`, `ollama.host`,
`ollama.none`, `http.bearer`, `http.basic`, `http.api_key`, `http.header`,
`oauth2.client_credentials`, `mcp.headers`, `mcp.oauth`, `github.token`, `aws.iam`,
`postgres.dsn`. Fields marked `x-secret` are encrypted and redacted, including optional ones;
the rest are stored as `publicFields`. Types with a service to call have a `test()` probe.
