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

The app must only be reachable through Railway's proxy in production. Railway does not publish a stable proxy CIDR, so Better Auth's `trustedProxies` list is not used.

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

`apps/web` and `apps/worker` cannot import `prisma` or `createPrismaClient` from `@alinstra/db` (ESLint `no-restricted-imports`). Tenant data goes through the scoped repositories. Two commented exceptions: `GET /api/health` (connection probe) and the worker email jobs (invite row update). `@alinstra/auth` still uses Prisma for Better Auth's adapter and invite acceptance.
