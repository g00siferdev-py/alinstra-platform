# Status

Phase 2 is merged into `main`. Staging deploy readiness (navigation, port, worker thread, production-image rehearsal) is on `main` with it. `staging` points at `main`.

## Phase S Part 1 (branch `phase-s-security`, not merged)

- Key versioning in `@alinstra/crypto`: keyring from `ENCRYPTION_KEY` (k1), `ENCRYPTION_KEY_V<N>`, and `ENCRYPTION_ACTIVE_KEY`. New writes are `v2.<keyId>…`; v1 and v2 are readable forever. `getEnv()` fails fast in production on a bad keyring.
- Migration `20261006020000_phase_s_cipher_columns` adds cipher columns for `ClientMessage` (caller name, callback number, body, plus `callbackMasked`), `TransferTarget` (`e164Cipher`, `e164Masked`), `KnowledgeBase.staffCipher`, and `KnowledgeDocument.extractedTextCipher`. Plaintext columns are nullable and not dropped yet.
- New rows are written encrypted only. Older rows are read through the plaintext fallback until `packages/db/scripts/encrypt-backfill.ts` runs. ChangeLog and QuickUpdate JSON mask phone numbers.
- `packages/db/scripts/rotate-encryption-key.ts` and `docs/KEY-ROTATION.md` cover rotation.
- Todo before this part is done on each environment: deploy, run the backfill, confirm "Plaintext still present" is 0. Dropping the plaintext columns is a later phase. Parts 3 to 7 of `docs/phase-s-plan.md` are not started.

## Phase S Part 2 (branch `phase-s-security`, not merged)

- Read-access audit log. Migration `20261006030000_phase_s_access_log` adds the `access_log` table (additive; nothing in the previous release touches it). Every transcript view, recording stream, raw-events view, message list or view, and knowledge document download writes a row: actor, role, client, action, entity id, IP, user agent (200 chars), and `count` for lists. No call or message text is stored or sent to Sentry; a failed insert is reported with ids only and the page is still served.
- Read points: call detail pages (portal and admin) write `call.transcript.view`, `call.raw.view` (admin) and `message.view`; `/api/calls/[id]/recording` writes `call.recording.stream` (one row per call per actor per 10 minutes via Redis); the owner home and admin client detail message lists write one `message.list` row with a count; `/api/knowledge/documents/[id]` writes `knowledge.document.download`.
- Admin: `/admin/access` (filter by client, actor, action, date range; paginated; CSV at `/admin/access/export`) and an "Access history" link on each client page (`/admin/clients/[id]/access`). Both need admin two-factor, like Services.
- Owner: `/home/access` ("Who viewed your calls", nav item "Who viewed"). Own client only; staff by name, Alinstra admins as "Alinstra support" with no ids or IPs. Staff get a 404.
- The nightly `purge-calls` job also deletes `access_log` rows older than 400 days.
- Not done here: rate limits on the recording and document routes (Part 5), and the data inventory in `SECURITY.md` (Part 7). The bulk-read alert is in Part 3 below.

## Phase S Part 3 (branch `phase-s-security`, not merged, not committed)

- Migration `20261006040000_phase_s_login_event` adds the `login_event` table (additive; no foreign keys; nothing in the previous release touches it). Columns: `userId?`, normalized `email`, `at`, `success`, `ip`, `ipPrefix` (/24 IPv4, /48 IPv6), `userAgent` (200 chars).
- `handleAuthRequest` (`packages/auth/src/handler.ts`) writes one `LoginEvent` for every `POST /sign-in/email`: success, wrong password, unknown email, archived client (403), and attempts refused by the lockout (429). The write sits next to the existing lockout counters and never changes the response.
- New-network sign-in: a successful sign-in from an `ipPrefix` the user has not signed in from successfully in 90 days, and not their first successful sign-in. Admins get the existing admin notice; client owners get a new "New sign-in to your Alinstra account" email (`newSignInEmail` in `@alinstra/email`, queue job `send-signin-notice`, rendered in the worker in the client's timezone) showing time, browser label ("Chrome on Windows"), and the network masked to its first two octets (`203.0.x.x`). No geo-IP. Staff get nothing.
- Admin lockout: when a failed sign-in trips the lockout for an admin account, one admin notice (deduped per account per hour with `getCounter()`).
- Bulk reads: after each `call.transcript.view` or `call.recording.stream` row is written, the web app counts that actor's rows in the last 10 minutes. Above 50 it queues an admin notice and sends a Sentry warning (ids and counts only), once per actor per hour via `getCounter()`.
- The nightly `purge-calls` job also deletes `login_event` rows older than 180 days.
- All alerts go through the queue (`enqueueSendAdminNotice`, `enqueueSignInNotice`); each is wrapped so a Redis, database, or mail failure is logged (error name only) and the login or page is served anyway.
- Tests: `packages/db/src/phase-s-login-events.test.ts`, `packages/auth/src/security-alerts.test.ts` (unit and through the real handler), `apps/web/src/lib/access-log.test.ts` (bulk read), `apps/worker/src/jobs/calls.test.ts` and `send-signin-notice.test.ts`, `packages/email/src/new-signin-email.test.ts`. Lint, typecheck, and all workspace tests pass locally.
- Not done: Parts 4 to 7. No new env vars. The `/admin/access?actor=<id>` link in the bulk-read notice relies on the Part 2 actor filter accepting a user id.

## Phase S Part 4 (branch `phase-s-security`, not merged, not committed)

- Encrypted nightly backups. New worker job `backup-db` (calls queue, BullMQ job scheduler `backup-db-daily`, `30 3 * * *` in `America/New_York`, next to `purge-calls`): `pg_dump --format=custom` from `DATABASE_URL`, streamed through AES-256-GCM into a temp file (plaintext never hits disk), uploaded to R2 at `backups/<APP_ENV or staging>/YYYY/MM/DD/alinstra-<env>-<ISO timestamp>.dump.enc`, then backups older than 30 days under that environment prefix are deleted. The result is written to AppSetting `backup.last` (`{ at, bytes, key, status, error? }`) and, on success only, `backup.lastSuccess`.
- File format in `@alinstra/crypto` (`createBackupEncryptStream` / `createBackupDecryptStream`): `ALBK1` + salt(16) + iv(12) + ciphertext + tag(16). Key is scrypt(`BACKUP_PASSPHRASE`, N=2^15, r=8, p=1) with a random salt per file; the header is authenticated as GCM AAD. Tests cover round trip, chunk boundaries, wrong passphrase, a flipped byte anywhere (header, body, tag), truncation, trailing bytes, and non-backup input.
- Config: `BACKUP_PASSPHRASE` (worker only, at least 16 characters), `BACKUP_S3_BUCKET` (optional, defaults to `S3_BUCKET` under `backups/`), `APP_ENV` (names the key prefix; blank means `staging`, so **set `APP_ENV=production` on the production worker**). With no passphrase the job records `not_configured`, logs a warning, queues one "Backups are not configured" admin notice per 24 hours (Redis `SET NX`), and never throws.
- Failure: any error records `failed`, queues a "Nightly backup failed" admin notice, and rethrows so the existing worker failed-job handler reports it to Sentry. Messages are sanitised (URLs, DB password, and passphrase stripped; pg_dump stderr capped). pg_dump gets credentials through `PG*` environment variables, not argv.
- Version guard: the job compares `pg_dump --version` with `SHOW server_version_num` and fails before dumping if the client major is older than the server. `apps/worker/Dockerfile` installs `postgresql-client-${PG_MAJOR}` (default 16) from the PGDG apt repo, because Debian bookworm's own client is 15.
- Services page: a Backups card (last success, size, last attempt and status, last error). It turns red when the last success is more than 36 hours old or there has never been one; a later failed attempt cannot hide an old success.
- CLI: `pnpm --filter @alinstra/worker exec tsx scripts/backup-decrypt.ts <in.enc> <out.dump>`; passphrase from `BACKUP_PASSPHRASE` or a hidden prompt. It deletes the output file if verification fails. Runbook: `docs/RESTORE.md`.
- Drill: `apps/worker/src/jobs/backup.integration.test.ts` creates a scratch source database, runs the real job (real `pg_dump`), decrypts, `pg_restore`s into a second scratch database, and compares row counts and a content checksum. It skips itself without `pg_dump`, `pg_restore`, and `psql`; CI now installs `postgresql-client`. It passed here inside the real worker image against the local Postgres 16.15 container.
- Storage additions: `StoredObject.putFile` and `list`, `getBackupStorage()`, and `backups/` keys accepted next to `clients/`.
- Not verified: an actual upload to R2 (no credentials here), and the Railway Postgres major version (see the report and `docs/DEPLOYMENT.md`). Parts 5 to 7 are not started.

## Verified locally

- Phase 2: `pnpm test` passed 60 tests (prompt rendering, admin two-factor, allowance, isolation, plus the Phase 0–1 suites). `pnpm lint` and `pnpm typecheck` were run after the navigation and deploy-readiness changes.
- An account with two-factor enabled lands on `/login/two-factor` after the password.
- Signed-in pages show the app header. In the wizard, Save & exit stores the draft and returns to the clients list. Header links save first. A pending save asks before leaving. The clients list shows Continue setup with the step number, and that link reopens the wizard on that step. Discard draft asks for confirmation and is styled separately.
- `pnpm --filter @alinstra/web start` listens on `PORT`, falling back to 3000.
- Production rehearsal (`docker compose --profile prod-smoke`) built the web and worker Dockerfiles. Against Postgres, Redis, and RustFS (S3 stand-in; MinIO's images were not anonymously pullable), migrate, seed, `/api/health`, admin sign-in, a presigned upload, extraction in the production worker image, and download all succeeded (`PROD_SMOKE_OK`).
- Isolation: a client user cannot read another client's draft, knowledge, documents, or change log. A storage key is always under that client's id.
- Extraction: truncated text, a malformed or oversized DOCX fails as `ExtractionFailed`, and the timeout helper rejects
- Production env guard still rejects placeholder secrets. Staging and production also require R2 (`STORAGE_DRIVER=s3`)

## CI
- GitHub Actions runs install, prisma generate, migrate deploy, lint, typecheck, and test against Postgres 16 and Redis 7 service containers. Fixed 2026-10-01: Turborepo strict env mode hid DATABASE_URL from tasks, and CI had no Redis.
- Phase 3 is on branch `phase-3` only. It is not merged. The 3 October review fixes (tool parameters, phone-number binding, inbound webhook shape, sync enqueue, Stripe item periods, checkout expiry, NANP transfer limits) are on this branch. Provisioning stays on fakes until keys are set. See `docs/phase-3-plan.md`.
- Remote GitHub Actions is unverified. `gh` is not installed. Lint, typecheck, and 84 tests passed locally against `alinstra_test` on this review. A fresh clone of the earlier `phase-3` commit `d093a73` had passed 72 tests; this review was not cloned to a second directory.

## Phase 2

- `@alinstra/agent` renders receptionist template version 3. The greeting uses the assistant name (default Ava) and disclosure mode. Honest-on-request is always on. Upfront disclosure is optional and defaults off. The recording notice stays on by default. `{{current_time}}` is filled by the voice platform in Phase 3. Reference blocks use a random token stored on the config. No model or external API calls.
- Wizard step 11 shows that prompt. Submit creates AgentConfig version 1 as draft. `platformAgentId` stays null.
- Owners can quick-update hours, closures, staff and transfer numbers, and one FAQ. Sensitive wording is held. A safe change creates a new active config and queues an admin email.
- Owners can submit a text change request. Allowance is the calendar month in the client timezone. A client with no plan and no override gets 0 included requests. Past the allowance, the extra fee is stored after confirmation. Billing is still Phase 3.
- Admin client pages: Agent Config (versions, diff, preview, activate, rollback) and Change Requests. Approving a request edits the receptionist fields and publishes a new version. The request text is not copied into the prompt. Rollback forks the knowledge base from the chosen version. Admin home lists held updates and pending requests.
- Admins cannot turn off two-factor authentication. They replace an authenticator with a current code, and two-factor stays on. Client users can still disable optional two-factor.
- Tests use the `alinstra_test` database and refuse to truncate any other database.
- Portal: My Business is editable for owners. Staff stay read-only. Owners have Change Requests.

## Shipped in Phase 1

- `Plan`, expanded `Client`, `WizardDraft`, `KnowledgeBase`, `KnowledgeDocument`, `ChangeLog`
- Scoped repositories and isolation tests for the new tenant-scoped tables
- Change log written in the same transaction as the change
- 11-step admin wizard with autosave, per-step validation, and submit that stays `lead`
- Private uploads (local disk in dev, R2 presign in staging/production) and authenticated downloads
- Worker job `extract-knowledge-text` on the `knowledge` queue (concurrency 1, killed after 60 seconds). The `email` queue stays separate
- Admin client list (Wizard submitted badge, remove for lead or demo), client detail (invite, discard, remove, users, change log), `/admin/plans`
- Portal home, team (owner only), and read-only My Business for owner and staff

## Explicitly deferred

- Retell, Stripe, Twilio, calendar, demo mode, and provisioning
- Churn for a live client (release the number, delete the agent, cancel Stripe). Remove only covers lead and demo
- Uptime monitor vendor
- Railway project creation and Cloudflare records. The click-by-click list is `docs/DEPLOYMENT.md`. Daniel does the account steps.
- First staging database restore drill

## How to run

See the root `README.md`. Admin sign-in still requires two-factor enrollment at `/account/security` before `/admin/clients` and `/admin/plans`.

## How to resume

1. Read `docs/DECISIONS.md`, `docs/DEPLOYMENT.md`, `docs/phase-3-plan.md`, and this file.
2. Phase 2 is on `main`. The items under "Needs Daniel's review" in `docs/DECISIONS.md` are still open.
3. Phase 3 is planned only (`docs/phase-3-plan.md`). No provisioning, Retell, or Stripe code yet.
