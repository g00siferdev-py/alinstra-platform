Phase S.1: review fixes before merge

Work on the existing `phase-s-security` branch. Add new commits on top of `e032517`; don't rebase or squash. Commit this file (`docs/phase-s1-fixes.md`) with them.

Claudia's review of `e032517`:
- 422 tests pass across all packages, run twice. The backup restore drill ran here too, with pg_dump/server 16.15.
- Typecheck, lint and the no-DB build pass. Migrations apply twice cleanly.
- The keyring, cipher columns, masking, access log, alerts, backup format, CI and docs are solid. Don't restructure any of them.

Fix the five items below, then it merges.

## 1. Retell rate limit: only throttle requests that fail the signature (availability)
Today every `/api/retell/*` request counts against 300/min per IP before the signature check. All of Retell's traffic for every client comes from a small set of Retell IPs, so as call volume grows, real webhooks, the inbound greeting lookup, and the take-message and transfer tools would start getting 429s. Messages would silently fail to save. (This came from Claudia's plan; it's not your bug.)
- **Order in every Retell route:**
  1. Read the raw body.
  2. Verify the signature.
  3. Only on failure, count a hit against `retellBadSignaturePerIp` (30 per 10 min per IP) and return 401, or 429 with `Retry-After` once the limit is exceeded.
  4. Valid signed requests are never counted or limited.
- **Cheap guard:** keep a body size cap before verification (reject over 1 MB with 413) so unsigned floods can't make us hash huge bodies.
- **Tests:**
  - 1,000 valid signed requests from one IP never get a 429;
  - bad signatures from one IP get a 429 after 30;
  - an oversized body gets a 413.

## 2. Make decryption failures loud, never silently blank
`open()` in `packages/db/src/cipher.ts` swallows every decrypt error and returns null, so a misconfigured key shows up as empty messages and empty transfer numbers with no signal. The likely mistake is `ENCRYPTION_KEY_V2` or `ENCRYPTION_ACTIVE_KEY=2` set on web but not on the worker.
- On a decrypt failure, `open()` logs `cipher.decrypt_failed` with the key id from `keyIdOf` (when parseable) and the error name, plus the call-site label. Never the payload. It also reports to Sentry with the same fields. Add an optional label argument so callers can pass e.g. `"transfer_target.e164:<id>"`.
- **Agent sync and the transfer tool:**
  - Before publishing, the sync must refuse if any transfer target number can't be decrypted. Mark the sync `failed` with "A transfer number could not be decrypted; check ENCRYPTION_KEY settings on web and worker".
  - The transfer tool returns its normal "can't transfer right now" path, so Ava takes a message.
  - Neither may ever publish or dial an empty number.
- **Message emails and the portal:** if a message body can't be decrypted, show "This message could not be decrypted. Contact support." instead of an empty string.
- **Worker startup:** log the configured key ids and the active key id (ids only), so a web/worker mismatch is visible in Railway logs. Do the same on web startup.
- Tests cover each path above.

## 3. Keep message text and reset links out of Redis job history
`send-message-email` jobs carry the caller name and message body in plaintext, and `send-password-reset-email` jobs carry a live reset URL. BullMQ keeps the last 100 completed jobs in Redis.
- `enqueueMessageEmail` takes `{ messageId, recipients, receivedAt?, timezone? }` only. The worker loads the message by id and decrypts it with `withMessageText`. If the message is missing, log the id and finish without sending.
- Password reset, invite, sign-in notice and message email jobs use `removeOnComplete: true` and `removeOnFail: { age: 86400 }`.
- Leave the admin-notice and other jobs as they are.
- Update the queue tests.
- `docs/SECURITY.md`: in the Redis row of the data inventory, state that job payloads hold ids only for messages, and that sensitive email jobs are removed on completion.

## 4. Clear the fast-xml-parser audit exceptions
- Add a pnpm override (or bump `@aws-sdk/client-s3`) so `fast-xml-parser` resolves to a version that fixes all four advisories.
- Remove those four entries from `audit-allowlist.json`.
- Run the storage tests plus an R2 smoke (put, get, list, delete against the local S3 driver or a mock) to prove nothing broke.
- If the bump is not clean, leave it and say why in the report.

## 5. Pin the GCM tag length
In `decryptString` (`packages/crypto/src/index.ts`), reject a tag that isn't exactly 16 bytes before calling `setAuthTag`, and create the decipher with `{ authTagLength: 16 }`. Add a test with a truncated tag.

## Verify
- `pnpm typecheck`, `pnpm lint`, `pnpm turbo run test --force`. Run the tests twice, and report the total across all packages.
- The no-DB production build.

Report: commit hashes, total test count, and the result of item 4 (fixed, or why not). Don't merge; Claudia gives the go-ahead.
