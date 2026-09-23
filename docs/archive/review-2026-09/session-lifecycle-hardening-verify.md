# Verify: session-lifecycle-hardening (security lens)

Verdict: **stands** (not refuted). Severity: **high**.

## Evidence (docs/design, checked 2026-09-22)

- `API.md` line 19: `fa_session` is `httpOnly, SameSite=Lax, ES256 JWT, 15 min, claims sub, ws, role, sid`; `fa_refresh` is `httpOnly, path /v1/auth/refresh, 30 d, rotated on use, hashed in refresh_tokens`. No `Secure` attribute, no `__Host-` prefix, no `SameSite` stated for `fa_refresh`. Nothing in `packages/env/src/schema.ts` or `.env.example` toggles cookie security (no `ALLOW_INSECURE_HTTP`, no `SECURE_COOKIES`).
- `API.md` line 19: "State-changing **session** requests must send `X-Requested-With: flowaid`". `POST /v1/auth/refresh` is auth mode `public (cookie)` (line 42), so it is not covered by that rule as written; logout is `session` and is covered.
- `DATABASE.md` lines 67-76: `refresh_tokens` has `tokenHash, expiresAt, revokedAt, replacedById, userAgent, ip` — no `family_id`/`sid`, so replay of an already-rotated token cannot revoke the whole chain without walking `replaced_by_id` links (and nothing in the docs says it does).
- `DATABASE.md` lines 49-57: `users` has no `token_version`; no route or text anywhere in `API.md`, `ARCHITECTURE.md` (§ security, line 799) or `DATABASE.md` invalidates a live JWT on logout, password change, member removal (`DELETE …/members/:userId`, line 48) or role change (`PATCH …/members/:userId`). `role` is a JWT claim, so a removed/demoted member keeps the old role for up to 15 min.
- `API.md` line 24: rate limits are keyed by principal (`session 600/min, api key 1 200/min, webhook path 300/min`). `/v1/auth/login` is `public` with no per-IP or per-email limit and no constant-time behaviour on unknown email specified. `audit_events.action` examples (`DATABASE.md` 659) list no `auth.*` actions.
- No `GET/DELETE /v1/me/sessions`, no `logout-all` route in the route catalogue (`API.md` §3.1). `users.mfa_secret_enc` exists but no MFA routes either (out of scope of this finding).
- `CORS_ORIGINS` and `FLOWAID_BASE_URL` are independent env values (`packages/env/src/schema.ts` 345-347); nothing checks they are same-site, which matters because `SameSite=Lax` + `X-Requested-With` is the only CSRF defence.

## Why not refuted

Every item in the finding is a concrete absence in the authoritative design docs from which `apps/api` will be built. The enhancement list is implementable as doc changes now (API.md §1/§3.1, DATABASE.md `users`/`refresh_tokens`, env schema) and as code when the api package lands.

## Severity note

High rather than critical: nothing is deployed yet and the 15 min JWT bounds the revocation window. High rather than medium because three of the gaps (no `Secure` on cookies, no login throttling on a public password route, no revocation on member removal) are standard-checklist items that would each be a finding against a shipped product.
