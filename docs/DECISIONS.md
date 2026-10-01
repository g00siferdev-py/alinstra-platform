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

`ENCRYPTION_KEY` is a separate 32-byte key for secrets this app owns and Better Auth does not: the invite token ciphertext now, and OAuth / provider tokens in later phases. Helper: `@alinstra/crypto` (`encryptString` / `decryptString`), AES-256-GCM, payload `v1.<iv>.<tag>.<ciphertext>` (base64url).

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
