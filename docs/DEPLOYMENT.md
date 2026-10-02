# Staging checklist

This is the click-by-click list for the first staging deploy. Production (`app.alinstra.com`) comes later and is only sketched at the end. Do the account steps yourself. Do not change apex `alinstra.com` records for the marketing site.

Checked against Railway's docs on 2 October 2026. Config-as-code (`railway.toml`) still works for services that already have a config file path, and stops being read on 1 December 2026. New services cannot opt into it. The files `railway.web.toml` and `railway.worker.toml` are the settings to copy into the dashboard. If a service still shows **Config file path**, set it as well.

Region for everything: **US East**.

Hostname: `staging.alinstra.com`.

## 1. Railway project

1. Sign in at [railway.com](https://railway.com).
2. New Project → Empty project. Name it `alinstra-staging`.
3. Project Settings → Region → **US East**.
4. Add four services from this GitHub repo (`g00siferdev-py/alinstra-platform`), branch `staging`:
   - `web`
   - `worker`
   - Postgres (Railway's Postgres plugin)
   - Redis (Railway's Redis plugin)
5. On **web** and **worker**, Settings → Source → branch `staging`. Root directory stays the repository root (`/`). The Dockerfiles copy the whole pnpm workspace, so the root must not be `apps/web` or `apps/worker`.

Postgres and Redis each get their own volume. Do not point staging at the local Docker database.

### Web service settings

Settings → Build:

- Builder: **Dockerfile**
- Dockerfile path: `apps/web/Dockerfile`

Settings → Deploy:

- Custom start command: `pnpm --filter @alinstra/web start`
- Pre-deploy command: `pnpm --filter @alinstra/db exec prisma migrate deploy`
- Healthcheck path: `/api/health`
- Healthcheck timeout: `300`

If **Config file path** is available, set `/railway.web.toml`. That file contains the same four values. The process listens on Railway's `PORT` (it falls back to 3000 only when `PORT` is unset). Do not add `--port 3000`.

### Worker service settings

Settings → Build:

- Builder: **Dockerfile**
- Dockerfile path: `apps/worker/Dockerfile`

Settings → Deploy:

- Custom start command: `pnpm --filter @alinstra/worker start`
- Pre-deploy command: empty. The worker never migrates.
- Healthcheck path: empty.

If **Config file path** is available, set `/railway.worker.toml`. That file has a start command and no pre-deploy command.

`tsx` is a production dependency of the worker. The knowledge job starts a `worker_thread` with `--import <tsx>` so `extract-knowledge-thread.ts` runs inside this image.

### How to verify this step

- Web → Settings shows Dockerfile `apps/web/Dockerfile`, the migrate pre-deploy command, and healthcheck `/api/health`.
- Worker → Settings shows Dockerfile `apps/worker/Dockerfile`, the start command, and a blank pre-deploy command.

Do not deploy yet. Variables come first, or the production guard will refuse to start.

## 2. Cloudflare R2

Staging gets its own private bucket. The app never makes objects public. Downloads go through the app.

1. Cloudflare dashboard → R2 → Create bucket.
2. Name: `alinstra-staging`. Location hint: **Eastern North America** (same region family as Railway US East).
3. Leave the bucket private. Do not add a public r2.dev domain.
4. R2 → Manage API tokens → Create Account API token.
5. Permission: **Object Read & Write**.
6. Specify bucket: **only** `alinstra-staging`. Do not grant account-wide access.
7. Create token. Copy the Access Key ID, Secret Access Key, and the S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`). The secret is shown once.
8. R2 → `alinstra-staging` → Settings → CORS policy. Add this policy and save. The browser uploads the file with a presigned PUT straight to the bucket. The PUT signs `content-length` and `host`. The SDK also puts `x-amz-checksum-crc32` and `x-amz-sdk-checksum-algorithm` on the query string. The browser sends `Content-Type` as well (`text/plain`, `text/csv`, `application/pdf`, or the Word Open XML type). `host` is not a CORS header. `Content-Type` and `Content-Length` are the headers this policy must allow.

```json
[
  {
    "AllowedOrigins": ["https://staging.alinstra.com"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

`MaxAgeSeconds` is 300, the same lifetime as the presigned URL. This policy is only for the staging bucket. A production bucket would list `https://app.alinstra.com` instead, when that project exists.

### How to verify this step

- The token's bucket scope lists only `alinstra-staging`.
- In R2, the bucket has no public access.
- The bucket CORS policy lists `https://staging.alinstra.com`, methods `PUT` and `GET`, and headers `Content-Type` and `Content-Length`.

## 3. Resend

1. [resend.com](https://resend.com) → Domains → Add domain → `alinstra.com`.
2. Resend shows SPF and DKIM records. Add each one in Cloudflare DNS. Proxy status **DNS only** (grey cloud). Do not replace or edit unrelated apex records.
3. In Resend, click Verify. Wait until the domain is verified.
4. API Keys → Create API key. Name it `alinstra-staging`. Sending access is enough. Copy the key (`re_...`).

`EMAIL_FROM` will be `notifications@alinstra.com`.

### How to verify this step

- Resend → Domains shows `alinstra.com` as verified.
- A later test invite or password email arrives from `notifications@alinstra.com`, not the console logger.

## 4. Sentry

1. [sentry.io](https://sentry.io) → create a project for Next.js named `alinstra-web`, environment `staging`.
2. Create a second project for Node named `alinstra-worker`, environment `staging`.
3. Copy each project's DSN.

Server and worker DSNs are runtime variables. The browser DSN is inlined when the web image builds, so set `NEXT_PUBLIC_SENTRY_DSN` on the web service **before** the first deploy. It is a public DSN. The app already sends with `sendDefaultPii: false` and strips request bodies.

Leave the DSNs empty if you want the first deploy without Sentry. Empty is valid. You can add them and redeploy later.

## 5. Environment variables

Generate secrets on your own machine. Do not commit them. Do not reuse the local `.env` values. Production refuses any secret that contains `placeholder`, `change-me`, or `build-`. `ENCRYPTION_KEY` must base64-decode to exactly 32 bytes.

```bash
openssl rand -base64 32
```

Run that twice. The first value is `BETTER_AUTH_SECRET` (it is also longer than 32 characters). The second is `ENCRYPTION_KEY`.

`ADMIN_INITIAL_PASSWORD`: a password of at least 12 characters, used only by the seed command. You will delete this variable after you enroll two-factor.

In Railway, web and worker do not share a variable group with production later. Reference Postgres with `${{Postgres.DATABASE_URL}}` and Redis with `${{Redis.REDIS_URL}}` (the plugin variable names Railway shows on those services).

`PORT` is set by Railway. Do not set it yourself.

### Web

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://staging.alinstra.com` |
| `BETTER_AUTH_URL` | `https://staging.alinstra.com` |
| `BETTER_AUTH_SECRET` | first `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | second `openssl rand -base64 32` |
| `ADMIN_EMAIL` | the address you will sign in with |
| `ADMIN_INITIAL_PASSWORD` | one-time seed password, 12+ characters |
| `DATABASE_URL` | Railway Postgres URL for this environment |
| `REDIS_URL` | Railway Redis URL for this environment |
| `EMAIL_FROM` | `notifications@alinstra.com` |
| `EMAIL_TRANSPORT` | `resend` |
| `RESEND_API_KEY` | the `re_...` key from step 3 |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | the R2 S3 endpoint from step 2 |
| `S3_BUCKET` | `alinstra-staging` |
| `S3_ACCESS_KEY_ID` | the R2 token access key |
| `S3_SECRET_ACCESS_KEY` | the R2 token secret |
| `S3_REGION` | `auto` |
| `SENTRY_DSN` | web project DSN, or empty |
| `SENTRY_ENVIRONMENT` | `staging` |
| `NEXT_PUBLIC_SENTRY_DSN` | same web DSN, or empty. Must be set before the image builds. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `staging` |
| `TRUSTED_PROXY_HOPS` | `1` (the default). Railway's client IP is `X-Real-IP`, which the app prefers when it is present. |

`UPLOAD_DIR` and `LOCKOUT_STORE` stay unset. Production storage is the bucket, and lockout uses Redis.

### Worker

Same as web for: `NODE_ENV`, `APP_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, `REDIS_URL`, `EMAIL_FROM`, `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`.

| Variable | Value |
| --- | --- |
| `ADMIN_EMAIL` | same admin address (required by the env schema; the worker does not seed) |
| `SENTRY_DSN` | worker project DSN, or empty |
| `SENTRY_ENVIRONMENT` | `staging` |

Do not set `ADMIN_INITIAL_PASSWORD` on the worker.

### How to verify this step

- Web variables include `EMAIL_TRANSPORT=resend`, `STORAGE_DRIVER=s3`, and a bucket-scoped R2 token.
- Worker variables have no pre-deploy and no `ADMIN_INITIAL_PASSWORD`.
- Neither secret contains the words the production guard rejects.

## 6. Cloudflare DNS

Grey cloud first. Leave the apex alone.

1. Railway → web service → Settings → Networking → Custom Domain → add `staging.alinstra.com`.
2. Railway shows a CNAME target and a TXT ownership record.
3. Cloudflare → DNS → add the CNAME. Name `staging`. Target is the Railway hostname. Proxy status **DNS only**.
4. Add the TXT record exactly as Railway shows. Proxy status **DNS only**.
5. Wait until Railway says the certificate is issued.

| Setting | Value |
| --- | --- |
| `staging` CNAME | DNS only (grey cloud) |
| Railway TXT | DNS only |
| SSL/TLS if you later proxy | Full, not Full (strict) |

### How to verify this step

- `https://staging.alinstra.com` loads after the first successful deploy, with a Railway certificate.
- The apex site is unchanged.

## 7. First deploy

1. Railway → web → Deploy. The pre-deploy command applies migrations before the new web process starts.
2. Railway → worker → Deploy. No migration runs.
3. Wait until the web deployment is healthy.

### How to verify this step

- Web deployment logs do not say `Refusing to start`.
- `GET https://staging.alinstra.com/api/health` returns `200` and a JSON body with `"ok": true`, `"db": "up"`, and `"redis": "up"`. A failure is `503` with `"down"` on the check that failed.
- Worker logs show the process started and do not show a migrate command.

## 8. Seed the admin, enroll two-factor, delete the seed password

1. Railway → web → Settings → one-off command (or a shell in the running web service):

   ```bash
   pnpm db:seed
   ```

2. Open `https://staging.alinstra.com/login`. Sign in with `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD`.
3. Because the account has no authenticator yet, you land on `/home` and are sent to `/account/security`. Enroll the authenticator and save the backup codes somewhere offline.
4. Sign out. Sign in again with the same password. You should land on `/login/two-factor`, not `/home`. Enter the current authenticator code.
5. Railway → web → Variables → delete `ADMIN_INITIAL_PASSWORD`. Redeploy web so the process drops that variable. Seed will not reset the password on later runs.

Admin two-factor cannot be turned off. Replace the authenticator from the account menu if you lose the device.

### How to verify this step

- `/login` with the admin email and password stops on **Two-factor check**.
- `ADMIN_INITIAL_PASSWORD` is gone from the web service variables.
- A second `pnpm db:seed` logs that the admin user is already present and does not change the password.

## 9. After staging is up

- Header on a signed-in page: Alinstra (home), Home, Clients, Plans, and the account menu with Sign out.
- Add a client, then **Save & exit**. The clients list shows **Continue setup** with the step number, and opening it returns to that step.
- Upload a small `.txt` knowledge file on an unsubmitted client **in the browser** at `https://staging.alinstra.com` (not only from a server-side script). The browser PUT goes straight to R2. If the CORS policy is missing, the browser console shows a CORS error and the file never confirms. When the policy is right, the worker log shows extraction finish and the file downloads.
- The local `prod-smoke` script uploads from inside the web container, so a green smoke run does not prove this browser step.

Take a Railway Postgres backup before any later migration that drops or rewrites data. Restore by creating a new database from that backup, pointing `DATABASE_URL` at it, redeploying web (so migrate runs there), then redeploying the worker.

## Local production rehearsal

This uses the real Dockerfiles, `NODE_ENV=production`, and a private S3 bucket as a stand-in for R2. On 2 October 2026 the MinIO images on Docker Hub and Quay refused anonymous pulls, and `dl.min.io` returned 410, so the stand-in is RustFS (`rustfs/rustfs`) with the same path-style S3 API the app uses for R2. It does not use the local `alinstra` database or the dev Redis. From the repo root:

```bash
docker compose --profile prod-smoke up -d --build postgres-smoke redis-smoke s3 s3-init web-prod worker-prod
docker compose --profile prod-smoke exec web-prod pnpm --filter @alinstra/db exec prisma migrate deploy
docker compose --profile prod-smoke exec web-prod pnpm db:seed
docker compose --profile prod-smoke exec web-prod pnpm --filter @alinstra/worker exec tsx /app/apps/web/scripts/prod-smoke.ts
```

The last command must print `PROD_SMOKE_OK`. It checks `/api/health`, signs in, enrolls two-factor, uploads through the presigned URL, waits until extraction is `done`, and downloads the file. Web is published on `localhost:3001` so a dev server on port 3000 can stay up. The smoke script itself talks to the web process inside the compose network.

Stop it with:

```bash
docker compose --profile prod-smoke down
```

## Phase 3 keys (only after the phase-3 branch is what staging runs)

Leave these empty until you are ready for one real Retell number. Empty keys make the process use fakes and refuse live provisioning when `NODE_ENV=production`.

| Variable | Web and worker | How to get it |
| --- | --- | --- |
| `RETELL_API_KEY` | both | Retell dashboard → API keys. One key with the webhook badge. Staging and production are different keys. |
| `RETELL_DEFAULT_VOICE_ID` | both | The id from the voice card after you pick in `docs/voice-options.md`. |
| `STRIPE_SECRET_KEY` | both | Stripe test mode secret key (`sk_test_...`) for staging. |
| `STRIPE_WEBHOOK_SECRET` | web | Stripe → Developers → Webhooks → endpoint `https://staging.alinstra.com/api/stripe/webhook` → signing secret. |
| `DANIEL_TRANSFER_NUMBER` | both | Your cell in E.164, for client zero. |

Retell webhook URL: `https://staging.alinstra.com/api/retell/webhook`. Inbound URL is set by the app when it buys the number. There is no Retell sandbox and no spend cap in the API. Use one number. End service, or delete the number, to stop the monthly charge. Watch the Retell Billing tab.

### How to verify this step

- A client with two-factor admin can start provisioning and the page shows a Checkout link before the client is live.
- Client zero skips Checkout, gets a number, and shows In sync after a config change.
- A browser upload still works. The health check is still `"db": "up"` and `"redis": "up"`.

## Production later

Repeat this checklist in a separate Railway project. Hostname `app.alinstra.com`. Own Postgres, Redis, R2 bucket, Resend key, and Sentry environment `production`. Grey-cloud CNAME for `app` only. Do not share staging's database, Redis, bucket token, or `ENCRYPTION_KEY`. Enroll a new admin and delete that environment's `ADMIN_INITIAL_PASSWORD` the same way.
