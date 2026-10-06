# Decisions

Living record of choices that later phases should not reopen without a new note here. Product scope stays in `RECEPTIONIST_DASHBOARD_BRIEF.md`. Phase 0 plan: `docs/phase-0-foundations-plan.md`.

## Locked earlier (still in force)

Stack, roles (`admin`, `client_owner`, `client_staff`), invite-only signup, hostnames, Cloudflare grey-cloud first, Resend plus console email locally, `ADMIN_EMAIL` seed, `@alinstra/*` packages, Railway US East with separate staging and production, Prisma 7.10.0, pnpm 10.28.2, and Turborepo. See the Phase 0 plan for the full list.

## 2026-09-30 — Phase 0 implementation choices

### Invites are a custom table

Better Auth's organization and invitation plugins are not used. Invites live in `@alinstra/db` (`Invite`) and are tied to our `Client` / `clientId` model.

- Token is 32 random bytes, URL-safe. Only a SHA-256 hash is used for lookup.
- A ciphertext of the token (`ENCRYPTION_KEY`) is stored so the email worker can build the link, then cleared after a successful send.
- Single use (`acceptedAt`), revocable (`revokedAt`), and expiring (7 days).
- `admin` may invite a `client_owner` for a client. A `client_owner` may invite `client_staff` only for their own `clientId`. `client_staff` cannot invite.
- Accept takes the token, name, and password. Role and `clientId` are copied from the invite row. The accept function does not take a `clientId` argument.
- Public signup is disabled.

### 2FA secrets at rest (Better Auth 1.7.7)

**Finding:** the `twoFactor` plugin encrypts TOTP secrets before insert. `enableTwoFactor` calls `symmetricEncrypt` with `ctx.context.secretConfig` (derived from `BETTER_AUTH_SECRET`) and stores the ciphertext in `twoFactor.secret`. The cipher is XChaCha20-Poly1305 with a SHA-256 digest of the secret as the key. When a versioned `SecretConfig` is used, the stored value is an envelope (`$ba$<version>$<hex>`). Backup codes default to `storeBackupCodes: "encrypted"` (same key). Source checked: `better-auth` `1.7.7`, `packages/better-auth/src/plugins/two-factor/index.ts` and `src/crypto/index.ts`.

We do **not** wrap those columns again. Better Auth decrypts them itself on verify; a second layer would break verification.

`ENCRYPTION_KEY` is a separate 32-byte key for secrets this app owns and Better Auth does not: the invite token ciphertext now, and OAuth / provider tokens in later phases. Helper: `@alinstra/crypto` (`encryptString` / `decryptString`), AES-256-GCM. Payload `v1.<iv>.<tag>.<ciphertext>` (base64url) until Phase S; since then new writes are `v2.<keyId>.<iv>.<tag>.<ciphertext>` and v1 is still readable (see the Phase S Part 1 section below).

Generate a key (32 bytes):

```bash
openssl rand -base64 32
```

or:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put it in `ENCRYPTION_KEY`. Do not commit it. Rotating it makes existing invite ciphertexts and, later, stored OAuth tokens unreadable. Rotating `BETTER_AUTH_SECRET` makes existing TOTP secrets unreadable unless Better Auth secret rollover (`BETTER_AUTH_SECRETS`) is used.

### Sessions

| Actor | Policy |
| --- | --- |
| `admin` | 12-hour absolute maximum from session creation. Activity does not extend it. Next sign-in requires the password and TOTP again. |
| `client_owner`, `client_staff` | 7-day sliding session. Expiry refreshes at most once per hour of use (`updateAge`). |

Better Auth has one global `session.expiresIn` (set to 7 days). Admin sessions are capped in database hooks: create sets `expiresAt` to 12 hours, and update refuses to push `expiresAt` past `createdAt + 12 hours`. Admin routes also reject a session past that cap and require `twoFactorEnabled` before any admin page other than enrollment.

### Rate limits

| Action | Limit |
| --- | --- |
| Login failures | 5 failed password attempts per normalized email + trusted client IP, fixed 15-minute window. A second counter locks the account after 20 failures in an hour, regardless of IP. A successful password (including a 2FA challenge) clears both counters. Lockout returns 429. |
| Password reset requests | 3 requests per email per 15 minutes. The response stays generic. |

`POST /sign-in/email` must include an email in a JSON or form body. If the email cannot be read, the handler returns 400 and does not call Better Auth, so the attempt cannot skip the counters.

Better Auth's built-in limiter counts requests per IP, not failed passwords per account, so login lockout is our own counter (Redis when `REDIS_URL` is set, in-memory when `LOCKOUT_STORE=memory` for tests). Better Auth's limiter is configured with `advanced.ipAddress.ipAddressHeaders: ["x-real-ip"]`. The auth handler copies the trusted client IP into that header and removes `X-Forwarded-For` before Better Auth sees the request.

**Client IP (checked against Railway docs on 2026-10-01).** [Public networking specs](https://docs.railway.com/networking/public-networking/specs-and-limits) list `X-Real-IP` as the header for the client's remote IP. They do not list `X-Forwarded-For`. Railway staff on Station say the edge overwrites `X-Real-IP`, strips a visitor-supplied `X-Forwarded-For`, and that the leftmost remaining value is the connecting IP, with a possible extra internal hop. They have also reported a CDN bug where `X-Real-IP` became the Fastly edge address. We do not trust the leftmost `X-Forwarded-For` entry, because a client can prepend it when a proxy appends.

Resolution order:

1. `X-Real-IP` when it is present (the value Railway documents and overwrites).
2. Otherwise `X-Forwarded-For`, counting `TRUSTED_PROXY_HOPS` entries from the right (default `1`, so the rightmost address is the client).
3. `local` when neither header is present (dev and tests).

The app must only be reachable through Railway's proxy in production. Railway does not publish a stable proxy CIDR, so Better Auth's `trustedProxies` list is not used. The handler rebuilds the request from its URL, method, headers, and body before Better Auth sees it. Reusing Next's request object with new headers throws.

### Migrations

`prisma migrate deploy` runs once per deploy as the Railway **pre-deploy command on the web service only**. The worker start command never migrates. Local dev uses `pnpm db:migrate`.

### Sentry

`sendDefaultPii` is `false` on web (server, edge, and browser) and on the worker. `beforeSend` drops request bodies, cookies, authorization headers, user email, IP, and username, and removes extra fields whose names look like email, phone, transcript, token, password, or secret. Do not attach phone numbers, emails, or transcripts to Sentry events.

### Uptime monitoring

Vendor choice (Better Stack vs UptimeRobot) is deferred until the first real deploy. Phase 0 ships `GET /api/health` (Postgres `SELECT 1` and Redis `PING`). `docs/DEPLOYMENT.md` has a placeholder section for the monitor.

### Other Phase 0 defaults

- Password minimum length: 12.
- Password reset revokes existing sessions.
- Local and test email uses the console transport. Production must set `EMAIL_TRANSPORT=resend`.
- Bootstrap admin: `ADMIN_EMAIL` plus `ADMIN_INITIAL_PASSWORD` (seed only). The address is never hardcoded. Re-running seed does not reset an existing password.
- pnpm version is `10.28.2` (`packageManager` in the root `package.json`, docs, and CI).

### Production secret guard

When `NODE_ENV=production` and the process is not inside `next build` (`NEXT_PHASE=phase-production-build`), startup refuses if `BETTER_AUTH_SECRET` or `ENCRYPTION_KEY` contains `placeholder`, `change-me`, or `build-`, or if `ENCRYPTION_KEY` does not base64-decode to 32 bytes. Docker build placeholders are inline on the web image build command and are not `ENV` in the runtime image. The worker image does not bake secrets at all.

### Direct Prisma in the apps

`apps/web` and `apps/worker` cannot import `prisma` or `createPrismaClient` from `@alinstra/db` (ESLint `no-restricted-imports`). Tenant data goes through the scoped repositories. Commented exceptions: `GET /api/health` (connection probe), the worker invite email job, and `extract-knowledge-text` (extraction status for one document id). `@alinstra/auth` still uses Prisma for Better Auth's adapter and invite acceptance.

## 2026-10-01 — Phase 1

### Files

Cloudflare R2, one private bucket per environment. Local disk uses `UPLOAD_DIR` (default `.data/uploads`, gitignored). A relative path is resolved from the monorepo root so the web app and the worker share one directory. Staging and production set `STORAGE_DRIVER=s3` with an R2 endpoint. The bucket is never public. Production startup refuses `local` storage and a missing bucket, endpoint, or key.

Object keys are `clients/{clientId}/knowledge/{documentId}`. Keys must start with `clients/` and cannot contain `..` or a backslash.

Uploads do not use a Next.js server action (the default body cap is 1 MB). The browser posts metadata to `POST /api/knowledge/uploads`. Locally the file is then `PUT` to the app route. On R2 the same route returns a presigned PUT, and a follow-up POST confirms the object. Size, extension, content type, and magic bytes are checked on the server either way. Limits: 10 MB per file, 50 MB per client, 25 files per knowledge version. Allowed types: PDF, DOCX, TXT, CSV.

Downloads go through `GET /api/knowledge/documents/[id]`. The handler loads the row with the caller's tenant context first. A missing or other-client row is 404. Only then does it redirect to a presigned GET that expires in 5 minutes, or stream the local file. The presigned GET sets `ResponseContentDisposition` to `attachment` with a filename limited to letters, numbers, spaces, dots, and dashes. The local stream sets the same disposition and `x-content-type-options: nosniff`. `knowledgeDocuments.getById` returns null for another client's document; that is covered by the Phase 1 isolation tests.

### Extraction

`extract-knowledge-text` runs on its own `knowledge` queue, concurrency 1, in a worker thread with a memory limit. The parent terminates that thread after 60 seconds and marks the document failed. The `email` queue stays in the main process, so a stuck parse cannot block invite or password-reset mail. Extracted text is capped at 200,000 characters and `extractedTextTruncated` is set when the rest is dropped. A malformed or oversized DOCX (zip) fails that document and does not crash the worker. The zip check streams with fflate `Unzip`: a declared `originalSize` over the cap is rejected before inflation, and a running uncompressed total aborts decompression once it passes the cap. PDF uses `unpdf`, DOCX uses `mammoth` after that check, TXT and CSV must be valid UTF-8.

### Wizard and portal

Submit keeps status `lead`, sets `wizardSubmittedAt`, and stores `portalOwnerEmail`. It does not create an invite. The admin client detail page has "Send portal invite", which uses the existing admin invite flow and the owner email stored on the client. The browser does not choose that address. The client list shows a "Wizard submitted" badge.

Healthcare industries are `dental` and `medical_office`. Those auto-check `healthcareSensitive` unless an admin has edited the flag. Submit is blocked until `complianceReviewDone` is checked and `complianceReviewNote` is non-empty.

Street address is optional. Default timezone is `America/New_York`. Extra configuration-change fee seeds at 4900 cents and is editable on `/admin/plans`. Seeded plan prices are not overwritten on a later seed (`update: {}`).

Discarding an unsubmitted draft sets `archivedAt` and `discardedAt` and writes `wizard.discarded` in the same transaction. Object deletes run after that commit. A failed delete is logged without the file body.

Removing a client is only allowed while status is `lead` or `demo`. It archives the client, marks a remaining draft discarded, revokes pending invites, deletes sessions for that client's users, and marks knowledge documents deleted so the row no longer stores the object key. `client.removed` is written in the same transaction. Uploaded objects are deleted after that commit. The list and detail pages ask for confirmation first, and only show Remove for a lead or demo. Client roles cannot remove a client. A user whose client is archived cannot sign in or keep a session; they return to login with "This account cannot be used." A pending invite for that client cannot be accepted. A live client needs a churn flow in Phase 3: release the phone number, delete the agent, and cancel Stripe. Remove is not that flow.

`client_staff` can open My Business, read-only. Team stays `client_owner` only.

Website import, voice audio, phone purchasing, and the agent prompt are stored as notes or labels. Phase 1 does not call Retell, Stripe, Twilio, or a calendar API.

Auth and database tests share one Postgres database and both truncate it. `@alinstra/auth` tests run after `@alinstra/db` tests so one suite cannot truncate the other's rows.

## 2026-10-01 — CI

### Turborepo env mode
`turbo.json` sets `"envMode": "loose"`, so every task sees the process environment. Turborepo 2 defaults to strict mode, which hid DATABASE_URL and the other workflow env vars from tasks in GitHub Actions. Locally the root `.env` masked this because dotenv reads it from disk. Loose mode means a new env var never has to be registered in two places. The trade-off is that env values are not part of turbo cache keys. That is acceptable because there is no remote cache.

### Prisma generate without a database URL
`packages/db/prisma.config.ts` only sets `datasource.url` when DATABASE_URL exists. `prisma generate` works in Docker image builds without secrets. `prisma migrate deploy` still fails clearly when the URL is missing.

### CI services
CI starts Postgres 16 and Redis 7 service containers, matching docker-compose.yml. The worker isolation test needs a real Redis for BullMQ.

## 2026-10-01 — Phase 2

Prompt text is rendered in `@alinstra/agent` from the client record and the latest knowledge base. Template version is `"3"`. HVAC and veterinary have their own paragraphs. Every other industry uses the general template. The prompt budget is 24,000 characters. Structured fields are written before extracted document text. That material sits in a reference block whose boundary is a random token stored on the AgentConfig, for example `REFERENCE END 8f3a9c1d`. Marker-like text in reference content is rewritten case-insensitively, including extra whitespace, so it cannot close the block. The spoken greeting is built from the assistant name (default Ava) and the disclosure mode. Honest-on-request is always on: the prompt never lets the assistant claim or imply it is human, and it answers truthfully if asked whether it is a real person, a live person, a bot, or AI. Upfront disclosure is optional per client and defaults off (`on_request`). The recording notice stays in the greeting when recording is enabled, and recording defaults on. `{{current_time}}` is a placeholder in the client's timezone. The voice platform fills it in Phase 3, and the prompt uses it with the business hours to decide whether the office is open. Booking mode, live transfer, and message delivery are in the prompt. The stored tools are `take_message` and `callback`, plus `transfer` only when live transfer is on. They are not callable. `platformAgentId` is always null in this phase.

Admins cannot turn off two-factor authentication. The disable endpoint returns 403 for role `admin`. An admin replaces an authenticator by posting a current TOTP or backup code to `/api/auth/two-factor/re-enroll`, which enrolls the new secret immediately and leaves two-factor on. Client users can still disable their optional two-factor.

`Client.namePronunciation` is optional and is copied from wizard step 1. Closures and temporary notices are appended to `KnowledgeBase.notices`. Approving a change request does not copy the request text into the prompt. An admin edits the receptionist fields, previews the prompt, and publishes a new active version. The request stores that version's id. A FAQ value that is still one string becomes a single item titled "Existing" the first time an owner edits FAQs, then an array of question and answer.

A new knowledge base version is written when a quick update or an approved request changes those fields. Uploaded documents stay on the version that received them. The config stores that version id and the document ids.

One active config per client is enforced by a partial unique index. Activate and rollback insert a new row copied from the chosen version. Rollback also forks a new knowledge-base version from that config's knowledge snapshot and restores the voice, greeting, and settings it used, so the next edit builds on the rolled-back state. The previous active row, and a draft that was activated, change status to `superseded`. Prompt text on an existing row is not edited.

Allowance counts change requests with status `pending` or `approved` whose `createdAt` falls in the calendar month of `Client.timezone`. Rejected and cancelled requests are ignored. `overrideIncludedChangesPerMonth` wins over the plan. A plan value of null means unlimited. A client with no plan and no override gets 0 included change requests. Timezones are checked against IANA names when they are saved. If a stored timezone is still invalid when an allowance is calculated, that calculation falls back to `America/New_York`. The stored fee is the plan's `extraChangeFeeCents`.

Tests connect to a database whose name ends in `_test`. Locally that database is `alinstra_test` unless `DATABASE_URL_TEST` is set, and the suite creates it. Reset refuses to truncate any other database. CI uses a service database named `alinstra_test`.

The admin notice email is queued only when a quick update applies immediately. The worker sends it to `ADMIN_EMAIL`. Held updates and change requests are listed on the admin home instead.

## 2026-10-03 — Stripe API version and Retell number binding

Stripe requests send `Stripe-Version: 2026-09-30.endive`. That is the current version as of 3 October 2026. Billing-period end is read from `items.data[].current_period_end` (the largest item), which has been the shape since `2025-03-31.basil`. The webhook endpoint in the Stripe dashboard must use this same version. A missing or past period end is an error and is not saved.

Retell phone numbers bind with `inbound_agents` and omit `agent_version`, because the dashboard default is the latest published version and the create-phone-number schema does not document another default. Toll-free buys send `number_provider: "twilio"` and `country_code: "US"`. Outbound transfers are limited to US and Canada on the number, and transfer targets in the app are +1 NANP numbers only, excluding 900 and 976. Retell LLMs have no name field, so a crash between create and save can leave an orphan LLM. Those objects are not billed monthly.

## 2026-10-02 — Phase 3 providers

A single-prompt Retell agent is a Retell LLM plus an agent that references `llm_id`. Retell has no sandbox. Staging uses one real number (client zero) on Daniel's Alinstra Technologies, LLC account. One API key per environment covers API calls and webhook checks. Verification is the signature and the five-minute timestamp. There is no IP allowlist.

Payment is Stripe Checkout in subscription mode, with the setup fee as a one-time line item unless waived. The client is not live until that Checkout completes. Client zero skips billing and is excluded from revenue and margin. Churn waits until the end of the paid period unless an admin chooses End service now. Prices come from the plan catalog by lookup key. A new amount creates a new Price. Metered overage is a later Price kind (`plan_<code>_overage`), not created in this phase.

`RETELL_API_KEY` and `STRIPE_SECRET_KEY` empty means the in-memory fakes. Production refuses to provision without both keys. No provider call is made until those keys exist.

## 2026-10-02 — Staging and production hosting

Daniel approved this: production is a **separate Railway project**, not a second environment inside the staging project. Each project has its own Postgres, Redis, R2 bucket, Resend key, Sentry environment, and `ENCRYPTION_KEY`. Staging is `staging.alinstra.com`. Production, later, is `app.alinstra.com`.

## 2026-10-06 — Phase S Part 1: key versioning and encryption at rest

**Keyring.** `@alinstra/crypto` reads keys from env: `k1` = `ENCRYPTION_KEY`, `kN` = `ENCRYPTION_KEY_V<N>` (N ≥ 2), and `ENCRYPTION_ACTIVE_KEY` (default `1`) picks the key for new writes. New writes are always `v2.<keyId>.<iv>.<tag>.<ciphertext>`. Decrypt reads v1 (always `k1`) and v2 (key by id) forever; an unknown key id throws an error that names the id and the env var, never the key. `loadKeyring` validates: every key is 32 bytes of base64, no two keys are identical, the active key exists. `getEnv()` calls it in production, so the app refuses to start on a bad keyring. `encryptString(plaintext, encodedKey?)` and `decryptString(payload, encodedKey?)` keep their old signature: with the second argument the string is a single-key ring (`k1`), without it the keyring comes from env. Call sites in `@alinstra/db`, `@alinstra/auth`, and the worker now omit it. `keyIdOf(payload)` and `encryptStringWithKey(plaintext, keyId)` exist for the rotation script. Runbook: `docs/KEY-ROTATION.md`.

**Cipher columns, two-step.** This phase adds the columns and writes ciphertext only; it does not drop plaintext. Dropping `ClientMessage.callerName/callbackNumber/body`, `TransferTarget.e164`, `KnowledgeBase.staff`, and `KnowledgeDocument.extractedText` waits until staging and production are verified and the backfill reports zero plaintext. The migration (`20261006020000_phase_s_cipher_columns`) only adds nullable columns and drops three NOT NULL constraints, so the previous release keeps running while it is applied.

| Table | Cipher columns | Plain, list-safe column |
| --- | --- | --- |
| `client_message` | `callerNameCipher`, `callbackNumberCipher`, `bodyCipher` | `callbackMasked`, e.g. `(423) ***-0198` |
| `transfer_target` | `e164Cipher` | `e164Masked` |
| `knowledge_base` | `staffCipher` (encrypted JSON) | none |
| `knowledge_document` | `extractedTextCipher` | none |

Writes: only ciphertext (and the mask); the old plaintext columns are set to null. Reads: cipher first, plaintext as the fallback for rows the backfill has not reached yet. Reads decrypt in the repository layer (`clientMessages.list`, `transferTargets.list`, `knowledgeBases.getCurrent`, the prompt loader) or at the moment of use (`toolsFor` when publishing to Retell, `decideTransfer` for a by-number lookup). Staff notes are plain text in the prompt that Ava reads, so the prompt and its AgentConfig snapshot still contain them; this phase protects the stored knowledge base rows, not the published prompt. Hours, services, FAQs, policies and notices stay plaintext by design.

**Nothing filters or sorts on an encrypted field.** Messages list by `clientId` and `createdAt`; transfer targets by `clientId` and `createdAt` (a by-number lookup in `decideTransfer` decrypts a handful of rows for one client in memory); the message count queries use `createdAt` only. No search was broken.

**Phone numbers in JSON logs.** `recordChange` masks every phone number (10 to 15 digits, with common separators; dates are left alone) in `ChangeLog.before/after`. `QuickUpdate.payload` is masked too. A held quick update (and an owner step edit held for review) is applied later from its payload, so for held rows the original rides along encrypted under `__sealed`, and `openPayload` restores it when an admin previews or approves. `ChangeRequest` has no payload column, so there was nothing to mask. `WizardDraft.payload` is not part of this part and still holds the numbers the admin typed until the wizard is submitted.

**Backfill and rotation scripts** live in `packages/db/scripts/` and run with `tsx` (a dependency of `@alinstra/db`) from the Railway console. Both are idempotent and resumable (id-ordered batches, optimistic per-row updates so a live write is never overwritten), print counts only, and support `--dry-run`. Rotation covers every cipher column, including the CallRecord ones and `Invite.tokenCipher`, and prints per-column counts by key id before and after.

## 2026-10-06 — Phase S Part 2: read-access audit log

**What is logged.** One `AccessLog` row per read: `call.transcript.view` (call detail page with a transcript or summary, not purged), `call.raw.view` (admin raw events), `message.view` (a call detail page that shows its captured message), `message.list` (owner home and admin client detail, one row with `count` = messages shown; empty lists are skipped), `call.recording.stream`, and `knowledge.document.download`. The call lists, admin Calls page, and the admin home snippets show masked callers and outcomes and are not logged. Rows hold ids, role, IP, a 200-character user agent, and `count`; never text, names, or numbers. `impersonating` is written `false` until admin "view as client" exists.

**Best-effort, awaited.** `recordAccess` awaits the insert, and on failure calls an `onError` hook that the web app points at Sentry with ids only (the database error text can echo values, so only its name and code are reported). The page or file is still served. Recording requests that are refused (404) or unsatisfiable (416) serve nothing and log nothing.

**Recording dedupe.** Seeking sends many Range requests, so the route writes at most one row per call per actor per 10 minutes, claimed with `getCounter().increment` (Redis in production, memory in tests). If Redis is down the row is written anyway; an extra row is better than a missing one.

**No foreign keys.** `access_log.clientId` and `actorUserId` are plain columns so rows survive a removed client or user until the 400-day purge; that is what breach assessment needs. Names are looked up at read time ("Removed user", "Removed client" when gone). The nightly `purge-calls` job runs `purgeAccessLogs` (strictly older than 400 days) and logs only the count; a failure there does not block the stale-recording requeue.

**Who sees what.** `accessLogs(ctx)` is the tenant-scoped reader: owners are pinned to their own client whatever filter is passed, staff are refused, admins may filter by client, actor (email or id), action, and dates. In the owner view admin rows show as "Alinstra support" with no id, IP, or browser; owners and staff show by name. `/admin/access`, its CSV export, and the client Access history page use the `requireAdmin` gate (admin plus two-factor). CSV cells that start with `=`, `+`, `-`, or `@` are prefixed with a quote. Viewing or exporting the access log is itself not logged.

## 2026-10-06 — Phase S Part 3: security alerts

**LoginEvent is written in the auth handler, not a Better Auth hook.** `handleAuthRequest` already owns the lockout counters and sees every `POST /sign-in/email`, including attempts refused with 429 and 403 that never reach Better Auth. One place, one row per attempt. Rows hold a normalized email, IP, `/24` or `/48` prefix, and a 200-character user agent; never a password. The 429 path is logged too (useful forensics), at the cost of one small row per refused attempt; they age out with the 180-day purge. No foreign keys, like `AccessLog`.

**"Successful" means the password was accepted.** For an admin with two-factor, `/sign-in/email` returns 200 with `twoFactorRedirect` and the code is checked on a later request. That password step is recorded as the success, so a new-network notice can fire for an attacker who has the password but not the second factor. The trade-off: that network then counts as seen. Moving the check to session creation would need a second code path for 2FA; revisit if it proves noisy.

**New network, defined simply.** A success whose `ipPrefix` has no successful event for that user in the last 90 days, provided the user has at least one earlier successful event (so a first login never alerts). Failed attempts never make a network "seen". Users who last signed in more than 180 days ago have no history left and are treated as first logins; users who existed before this deploy skip their first post-deploy login. Both are accepted. IPs that are not addresses (`local`) have no prefix and never alert.

**Owner email is its own queue job, not `send-account-email`.** `send-signin-notice` carries only the recipient, ISO time, a browser label, and the already-masked network (`203.0.x.x`, `2001:db8:x`); the raw IP never goes through Redis or into the mail. The worker formats the time in the client's timezone. Admin notices (new network, lockout, bulk read) use the existing `send-admin-notice` job and show the masked network too. Browser labels come from a small user-agent classifier ("Chrome on Windows"), not the raw string.

**Everything is enqueue-only and swallowed.** `trackSignIn` and `checkBulkReads` never throw; a failed insert, Redis outage, or mail failure is logged by error name only. Mail itself is sent by the worker with BullMQ retries, so Resend downtime cannot touch a login.

**Dedupe uses `getCounter()`.** Admin lockout: one notice per admin account per hour (`alert:admin-lockout:<userId>`). Bulk reads: one alert per actor per hour (`alert:bulk-read:<actorId>`). If Redis is down the check throws inside the swallow, so the alert is skipped rather than repeated.

**Bulk-read check runs after the access row is written** (`logAccess`), counting `call.transcript.view` plus `call.recording.stream` rows for that actor in the last 10 minutes from `access_log` (indexed on actor and time). Deduped recording rows mean one recording counts once per 10 minutes, so seeking does not trip it. More than 50 triggers; exactly 50 does not. The Sentry warning and the notice carry actor id, role, client id, count, and window only.

**Retention.** The nightly `purge-calls` job now also runs `purgeLoginEvents` (strictly older than 180 days). Like the access-log purge, a failure is logged and does not block the stale-recording requeue.

## Needs Daniel's review

- Existing AgentConfig rows change `status` when a newer version becomes active. The prompt and settings on that row stay as written. Full immutability, including status, would need a separate "current" pointer.
- The admin email is not sent when an admin approves a held update or a change request. Those show on the admin home.
- Remote GitHub Actions was not watched. The GitHub CLI is not installed. A fresh clone of `phase-2` passed the CI sequence locally against `alinstra_test`.

