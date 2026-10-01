# Deployment

Railway hosts this app. DNS for `alinstra.com` is in Cloudflare. This document is the list of records and service settings Daniel adds. Do not change apex `alinstra.com` records for the marketing site.

## Environments

One Railway project, region **US East**.

| Environment | Git branch | Hostname |
| --- | --- | --- |
| production | `main` | `app.alinstra.com` |
| staging | `staging` | `staging.alinstra.com` |

Each environment has its own web service, worker service, Postgres, and Redis. They must not share a database or Redis. Use provider test modes in staging.

## Services

Build from the repo root (pnpm workspace).

| Service | Config file | Start | Pre-deploy |
| --- | --- | --- | --- |
| web | `railway.web.toml` | `pnpm --filter @alinstra/web start` | `pnpm --filter @alinstra/db exec prisma migrate deploy` |
| worker | `railway.worker.toml` | `pnpm --filter @alinstra/worker start` | none |

Set the config file path on each Railway service so the worker does not pick up the web pre-deploy command. **The worker never runs migrations.** Migrations run once per web deploy, before the new web instance starts.

`prisma migrate deploy` needs `DATABASE_URL` on the web service. Generate the Prisma client during the web build (`pnpm --filter @alinstra/db generate`), which the Dockerfiles already do. Railway's Nixpacks/build command should do the same if you are not using the Dockerfiles:

```bash
pnpm install --frozen-lockfile
pnpm --filter @alinstra/db generate
pnpm --filter @alinstra/web build
```

Worker build:

```bash
pnpm install --frozen-lockfile
pnpm --filter @alinstra/db generate
```

## Environment variables

Copy names from `.env.example`. Set values in Railway, not in git.

| Variable | Web | Worker | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | production | production | |
| `APP_URL` | yes | yes | `https://app.alinstra.com` or `https://staging.alinstra.com` |
| `BETTER_AUTH_URL` | yes | yes | Same as `APP_URL` |
| `BETTER_AUTH_SECRET` | yes | yes | `openssl rand -base64 32`. Also encrypts TOTP secrets. |
| `ENCRYPTION_KEY` | yes | yes | 32-byte base64. See below. |
| `ADMIN_EMAIL` | yes | no | Seed only |
| `ADMIN_INITIAL_PASSWORD` | yes | no | Seed only, first run |
| `DATABASE_URL` | yes | yes | That environment's Postgres |
| `REDIS_URL` | yes | yes | That environment's Redis |
| `RESEND_API_KEY` | yes | yes | |
| `EMAIL_FROM` | yes | yes | `notifications@alinstra.com` |
| `EMAIL_TRANSPORT` | `resend` | `resend` | `console` is refused when `NODE_ENV=production` |
| `SENTRY_DSN` | yes | yes | Optional until Sentry projects exist |
| `SENTRY_ENVIRONMENT` | `production` or `staging` | same | |

Generate `ENCRYPTION_KEY` (32 bytes):

```bash
openssl rand -base64 32
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Better Auth encrypts TOTP secrets with `BETTER_AUTH_SECRET`. `ENCRYPTION_KEY` is for invite-token ciphertext and, later, OAuth and provider tokens. See `docs/DECISIONS.md`.

Seed the admin once per environment, from a one-off command with `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD` set:

```bash
pnpm db:seed
```

## Cloudflare DNS

Grey cloud (DNS only) first. Add records only for `app` and `staging`, plus Resend when email is verified. Leave the apex alone.

For each hostname:

1. Railway → web service → Custom Domain → add `app.alinstra.com` or `staging.alinstra.com`.
2. Railway shows a CNAME target and a TXT ownership record. Add both in Cloudflare.
3. CNAME name `app` or `staging`, proxy status **DNS only**.
4. TXT exactly as Railway shows.
5. Wait until Railway reports the certificate issued.

| Setting | Value |
| --- | --- |
| App CNAME proxy | DNS only (grey cloud) for first bring-up |
| SSL/TLS mode if you later proxy | Full, not Full (strict) |
| `_acme-challenge` | DNS only |

### Later switch to proxied (orange cloud)

1. Certificate is already issued while DNS-only.
2. Cloudflare SSL/TLS mode is **Full**.
3. Turn on the proxy for `app` / `staging`.
4. Confirm HTTPS and `GET /api/health`.
5. If Error 1000 or certificate errors appear, switch back to DNS only.

## Database backup and restore

Railway Postgres has automated daily backups. Per environment:

1. Railway → Postgres → Backups. Confirm a recent backup exists before a risky migration.
2. Restore by creating a new database from that backup (Railway restore), or by downloading the backup and loading it with `pg_restore` / `psql` into a new instance.
3. Point `DATABASE_URL` at the restored instance, redeploy web (so `prisma migrate deploy` runs against it), then redeploy the worker. Do not run migrations from the worker.
4. After the first staging database exists, do one restore drill and note the date in `docs/STATUS.md`.

Take a backup before `prisma migrate deploy` if the migration is destructive. Phase 0 migrations so far only create tables.

## Health check

`GET /api/health` returns `{ ok, db, redis }` and status 200 when both are up, 503 otherwise. It does not include secrets or customer data.

## Uptime monitor

Deferred until the first production deploy. When you pick Better Stack or UptimeRobot:

- Monitor `https://app.alinstra.com/api/health` and `https://staging.alinstra.com/api/health`.
- Alert Daniel's phone on failures.
- Do not send request bodies, emails, phone numbers, or transcripts to the monitor.

Sentry is already initialized with `sendDefaultPii: false` and request bodies stripped. Leave the DSN empty until the Sentry project exists.

## Resend DNS

When the sending domain is verified, add the SPF and DKIM records Resend shows, at Cloudflare, for `alinstra.com`. Do not replace unrelated apex records. `EMAIL_FROM` is `notifications@alinstra.com`.
