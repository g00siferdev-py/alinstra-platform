Phase S: security hardening

## 0. Start
1. `git checkout main && git pull`. Confirm `main` is at `5da8693` (Phase L.1) or later. If not, stop and tell me.
2. `git checkout -b phase-s-security`
3. Commit this file (`docs/phase-s-plan.md`) as the first commit.
4. Work in the order below, with **one commit per part**. Run the tests after each part. If a part turns out much bigger than described, finish the parts before it cleanly, stop, and report rather than half-finishing.

What's already in place, so don't redo it:
- AES-256-GCM via `@alinstra/crypto` on CallRecord transcript, summary, raw events and caller number.
- Encrypted invite tokens.
- A private R2 bucket with authenticated-only recording playback.
- Tenant-scoped repositories with isolation tests.
- Login lockout and auth rate limits.
- Admin 2FA, enrolled at first login.
- The call retention purge.
- Retell routes verify `x-retell-signature`.
- `scrubSentryEvent`.

## Ground rules (every part)
- Never log, email, or send to Sentry any plaintext you're protecting: message bodies, caller names, phone numbers, transcripts, extracted document text, backup passphrases or keys. Use ids and counts.
- Every new tenant-scoped table gets a scoped repository plus an isolation test (client A can't read client B).
- ChangeLog entries are written in the same transaction as the change they describe.
- Migrations must be backward-compatible: the old code must keep running while the new migration is applied, because Railway runs `migrate deploy` before the new web instance starts.
- Small commits. Update `STATUS.md` and `DECISIONS.md` as you go.
- Don't push to `main` or `staging`. Push only `phase-s-security` when finished.

## Part 1: Key versioning and encryption at rest
### 1a. Keyring in `@alinstra/crypto`
- Payload format v2: `v2.<keyId>.<iv>.<tag>.<ciphertext>` (base64url), where keyId is `k1`, `k2`, …
- Keys: `k1` = `ENCRYPTION_KEY` (existing, required); `kN` = `ENCRYPTION_KEY_V<N>` for N ≥ 2 (optional).
- `ENCRYPTION_ACTIVE_KEY` (optional, default `1`) picks the key used for new encryptions. New writes always use the v2 format.
- Decrypt reads v1 payloads (always key k1) and v2 payloads (key looked up by id), forever. An unknown key id throws a clear error that names the key id and never the key.
- Env validation, which must fail fast in production:
  - every configured key is 32 bytes, base64-encoded;
  - the active key exists;
  - no two keys are identical.
- Export `encryptString`/`decryptString` with the same signatures as today (they read the keyring from env), plus `keyIdOf(payload)` for the rotation script. Keep the existing tests passing and add tests for every case above.

### 1b. Encrypt more columns
Use a two-step migration. This phase adds cipher columns, writes ciphertext only, backfills, and makes the plaintext columns nullable. Dropping the plaintext columns is a later phase, after staging and production are verified.
- **ClientMessage:**
  - Add `callerNameCipher`, `callbackNumberCipher`, `bodyCipher`, plus a plaintext `callbackMasked` (e.g. "(423) ***-0198") for list display.
  - New messages write only the cipher and masked fields; set the old columns to null.
  - Reads prefer the cipher and fall back to plaintext for rows not yet backfilled.
- **TransferTarget:** add `e164Cipher` and `e164Masked`, same pattern as ClientMessage. Staff cell numbers are exactly what we promise never to leak. Decrypt only at the moment it's needed (agent sync and the transfer tool).
- **KnowledgeBase.staff:** add `staffCipher` (the encrypted JSON) and stop writing `staff`.
  - Hours, services, FAQs, policies and notices stay plaintext; they're what Ava tells callers anyway.
- **KnowledgeDocument.extractedText:** add `extractedTextCipher`.
- **JSON logs:**
  - Audit `ChangeLog.before/after`, `QuickUpdate.payload` and `ChangeRequest.payload` for full phone numbers, especially transfer numbers.
  - From now on, store only masked numbers in those JSON fields.
  - The backfill also redacts existing rows (replace any 10+ digit phone number with its masked form).
- If any query **filters or sorts** on a field you're encrypting, list it in your report and say what you did. Don't silently break search.
- Backfill script: `packages/db/scripts/encrypt-backfill.ts`.
  - Idempotent and resumable, in batches of 500, with a `--dry-run` flag.
  - Prints counts per table and column, never values.
  - It must be safe to run while the app is live.

### 1c. Rotation
- `packages/db/scripts/rotate-encryption-key.ts --to k2 [--dry-run] [--batch 500]`: re-encrypts every cipher column (the CallRecord ones, the new ones above, and `Invite.tokenCipher`) from whatever key it's under to the target key.
  - Idempotent, resumable, batched.
  - Prints per-column counts of payloads by key id before and after.
- `docs/KEY-ROTATION.md` is a runbook Daniel can follow from the Railway console:
  1. Generate a key: `openssl rand -base64 32`.
  2. Add `ENCRYPTION_KEY_V2` to **both** web and worker.
  3. Deploy.
  4. Set `ENCRYPTION_ACTIVE_KEY=2` and deploy again.
  5. Run the script.
  6. Confirm zero `k1` payloads remain.
  7. Keep `ENCRYPTION_KEY` set anyway, because env validation requires it.
  8. Store the new key offline.

  Include the exact console command form that works on Railway: `cd /app/packages/db && pnpm exec tsx scripts/...`.

## Part 2: Read-access audit log
- New model `AccessLog`:
  - `id`, `at`, `actorUserId`, `actorRole`, `clientId`
  - `action`: one of `call.transcript.view`, `call.recording.stream`, `call.raw.view`, `message.list`, `message.view`, `knowledge.document.download`
  - `entityType`, `entityId`, `ip`, `userAgent` (truncated to 200 characters), `impersonating`, `count` (for list views)
  - Indexes on `(clientId, at)` and `(actorUserId, at)`.
- Write a row at every one of those read points. Awaited, best-effort: if the insert fails, report it to Sentry (ids only) and still serve the page. A list view writes one row with `count`, not one per item. Each recording request (including Range requests) logs at most one row per call per actor per 10 minutes, deduped through Redis.
- **Admin `/admin/access`:**
  - A filterable table: client, actor, action, date range. Paginated, with CSV export.
  - Requires admin 2FA, like the Services page.
  - The admin client detail page gets an "Access history" tab (the same table, scoped to that client).
- **Owner portal "Who viewed your calls":**
  - Owners see access rows for their own client only. Their staff appear by name; Alinstra admins appear as "Alinstra support".
  - Staff don't see this page.
  - This backs up the "your eyes only" promise on the site.
- Retention: the nightly purge job deletes `AccessLog` rows older than 400 days.
- Tests: rows are written at each read point; tenant isolation for the owner page; staff can't reach it; the purge respects the 400 days.

## Part 3: Security alerts
- **`LoginEvent` model:**
  - Fields: `id`, `userId?`, `email` (normalized), `at`, `success`, `ip`, `ipPrefix` (/24 for IPv4, /48 for IPv6), `userAgent` (truncated).
  - Written on every sign-in attempt, alongside the existing lockout logic.
  - 180-day retention, handled in the nightly purge.
- **New-network sign-in:** a successful login from an `ipPrefix` the user hasn't successfully signed in from in the last 90 days triggers a notice.
  - Admins get it through the existing admin-notice email.
  - Client owners get a short "New sign-in to your Alinstra account" email with the time, browser, and the prefix shown masked. Add a template next to the existing ones.
  - No geo-IP: we have no country data, because Cloudflare is DNS-only.
  - Skip the alert on a user's very first login.
- **Bulk reads:** more than 50 `call.transcript.view` + `call.recording.stream` rows by one actor in 10 minutes sends an admin notice and a Sentry warning (ids only). Dedupe to one alert per actor per hour, using `getCounter()`.
- **Admin lockout:** when an admin account hits the lockout, send an admin notice.
- All alert sending goes through the queue (`enqueueSendAdminNotice` or a new owner-email job), so a mail failure never breaks a login.

## Part 4: Encrypted nightly backups
- Worker job `backup-db`, scheduled daily at 03:30 America/New_York with the BullMQ job scheduler, next to `purge-calls`. It:
  1. runs `pg_dump --format=custom` from `DATABASE_URL`;
  2. encrypts the stream;
  3. uploads to R2 at `backups/<APP_ENV or "staging">/YYYY/MM/DD/alinstra-<env>-<ISO timestamp>.dump.enc`;
  4. deletes backup objects older than 30 days;
  5. records `{ at, bytes, key, status, error? }` in AppSetting `backup.last`.
- **Encryption:**
  - A streaming file format in `@alinstra/crypto`: a header (magic `ALBK1`, salt, iv) + AES-256-GCM ciphertext + tag.
  - The key comes from `BACKUP_PASSPHRASE` via scrypt (N=2^15, r=8, p=1), with a random salt per file.
  - Add a round-trip test and a tamper test (one flipped byte must fail).
- **Config:**
  - `BACKUP_PASSPHRASE` lives on the worker only.
  - `BACKUP_S3_BUCKET` is optional; it defaults to the main bucket under the `backups/` prefix.
  - If the passphrase is missing, the job logs once a day and sends an admin notice ("Backups are not configured"). It never crashes the worker.
- **pg_dump version:** install `postgresql-client` in the worker Dockerfile.
  - The client's major version must be ≥ the server's. Check the Railway Postgres version (`SHOW server_version` via the Railway console) and match it.
  - The job fails with a clear message if `pg_dump --version` is older than the server.
- **Failure:** an admin notice, plus a Sentry error (no secrets).
- **Services page:** add a "Backups" card showing last backup time, size and status. It turns red if the last success is more than 36 hours old.
- **CLI:** `pnpm --filter @alinstra/worker exec tsx scripts/backup-decrypt.ts <in.enc> <out.dump>` (it reads the passphrase from env or a prompt).
- **Restore runbook `docs/RESTORE.md`:**
  - Download from R2 and decrypt with the CLI.
  - `pg_restore --no-owner --clean --if-exists` into a fresh Railway Postgres (or a local one).
  - Verify row counts against the Services page, then repoint `DATABASE_URL`.
  - Include exact commands.
- **Drill:**
  - An integration test (it skips if `pg_dump` isn't installed) does dump, encrypt, decrypt and restore into a scratch database, then compares row counts.
  - Install `postgresql-client` in CI so the test runs there.

## Part 5: Rate limits
Use the existing `getCounter()`. Return 429 with a `Retry-After` header. Add tests at each limit.
- Retell routes (`/api/retell/*`): 300/min per IP. The signature check happens before any body parsing or DB work (confirm this and keep it).
- Password reset request: 5/hour per email and 20/hour per IP, on top of the existing lockout key.
- Invite send/resend: 10/hour per client.
- Owner edits (quick updates and change requests): 30/hour per user.
- Recording route: 120 requests per 10 min per user (Range requests count).
- Knowledge document download: 60 per 10 min per user.

## Part 6: Supply chain
- `.github/dependabot.yml`:
  - npm weekly, grouping minor and patch updates;
  - github-actions monthly;
  - open-PR limit 5.
- CI: `pnpm audit --prod --audit-level=high`.
  - It fails on high or critical.
  - Exceptions go in `audit-allowlist.json` (each with advisory id, reason, and expiry date), checked by a small script.
- CI: gitleaks.
  - Download the release binary in a step (no license-gated action) and run `gitleaks detect --redact --no-banner`.
  - Add `.gitleaks.toml` that allowlists the known fake test secrets (`re_build`, the `0123…cdef` test secrets, CI-generated values).
  - Gitleaks must pass on the full history. If it finds a real secret, stop and tell me; don't rewrite history.
- `docs/SECURITY-CHECKLIST.md`: a quarterly checklist covering:
  - rotate the vendor keys (Retell, Stripe, R2, Resend, OpenRouter);
  - review `/admin/access`;
  - run a restore drill;
  - review admin sessions and 2FA backup codes;
  - review the Dependabot backlog;
  - rotate the encryption key once a year.

## Part 7: Documents
- `docs/SECURITY.md`:
  - A data inventory table: what we store, where (Postgres, R2, Redis, Retell, Resend, Sentry), whether it's encrypted, retention, and who can see it.
  - The subprocessor list.
  - Access controls.
  - A breach runbook:
    - contain;
    - rotate keys (link the runbook);
    - assess using AccessLog and LoginEvent;
    - notify affected clients within 72 hours of confirming a breach;
    - meet state notification deadlines (marked "confirm current Tennessee and other state requirements with counsel"; don't quote statute deadlines as fact);
    - write a post-incident review.
- `docs/DPA-outline.md`: an outline for a Data Processing Addendum for the lawyer. Cover:
  - roles (the client is the controller, Alinstra the processor);
  - the subprocessors;
  - security measures (link SECURITY.md);
  - breach notice;
  - retention and deletion on termination;
  - recording/consent responsibilities;
  - the follow-up-calls consent attestation.

  It's an outline, not legal text.

## Verify before you report
- `pnpm typecheck`, `pnpm lint`, `pnpm turbo run test --force`. Run the tests twice, and report the total across ALL packages.
- The no-DB production build.
- `prisma migrate deploy` twice on a local DB, plus an encrypt-backfill run on a seeded local DB:
  - report the counts;
  - run it again to show zero work;
  - show that messages, transfer targets and staff still display correctly in admin and the portal.
- A rotation dry run and a real run from k1 to k2 on the local DB, with before/after key-id counts.
- The backup integration test passing locally, with your Postgres client and server versions.

Report back with: branch, commit list, total test count, the backfill and rotation counts, any encrypted field that was used in a search or sort, and the new env vars Daniel must set on Railway (which service gets which). Don't merge; Claudia reviews first.
