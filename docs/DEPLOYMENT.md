# Staging checklist

This is the click-by-click list for the first staging deploy. Production (`app.alinstra.com`) comes later and is only sketched at the end. Do the account steps yourself. Apex `alinstra.com` cutover for the marketing site is documented under **Shipped in Phase M** — leave the apex alone until you run that checklist.

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

`ENCRYPTION_KEY_V2` and `ENCRYPTION_ACTIVE_KEY` are optional and only used when you rotate the encryption key. Both services (web and worker) must always have the same encryption variables. See `docs/KEY-ROTATION.md`.

After the Phase S deploy, run the one-time backfill once per environment from the web service's Railway console: `cd /app/packages/db && pnpm exec tsx scripts/encrypt-backfill.ts --dry-run`, then without `--dry-run`. It encrypts older messages, transfer numbers, staff notes, and document text, and masks phone numbers in the change log.

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
| `MARKETING_PHONE` | optional E.164 fallback for marketing "Call Ava" when client zero has no public phone yet (e.g. `+18883871525`). Leave empty when client zero is live. |
| `TEXT_API_BASE` | optional. OpenAI-compatible chat base URL. Default `https://openrouter.ai/api/v1`. |
| `TEXT_API_KEY` | optional. When empty, the interview wizard is disabled (buttons hidden, routes 404). |
| `TEXT_MODEL` | optional. Default `moonshotai/kimi-k2.5`. |
| `TEXT_FALLBACK_MODEL` | optional. Used once if the primary fails or returns invalid JSON twice. |
| `TEXT_BUDGET_INPUT_TOKENS` | optional. Per-interview input token cap. Default `60000`. |
| `TEXT_BUDGET_OUTPUT_TOKENS` | optional. Per-interview output token cap. Default `12000`. |

`UPLOAD_DIR` and `LOCKOUT_STORE` stay unset. Production storage is the bucket, and lockout uses Redis.

### Worker

Same as web for: `NODE_ENV`, `APP_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, `REDIS_URL`, `EMAIL_FROM`, `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`.

| Variable | Value |
| --- | --- |
| `ADMIN_EMAIL` | same admin address (required by the env schema; the worker does not seed) |
| `SENTRY_DSN` | worker project DSN, or empty |
| `SENTRY_ENVIRONMENT` | `staging` |
| `APP_ENV` | `staging` (production: `production`). Names the backup folder, `backups/<APP_ENV>/...`. Blank means `staging`, so production **must** set it. |
| `BACKUP_PASSPHRASE` | a long random passphrase (at least 16 characters): `openssl rand -base64 32`. **Worker only**; never set it on web. Store a copy offline (password manager). Without it backups do not run and you get a "Backups are not configured" email once a day. Losing it makes every backup unreadable. |
| `BACKUP_S3_BUCKET` | optional. A separate private bucket for backups. Blank uses `S3_BUCKET` under the `backups/` prefix. The R2 token must be able to write to it. |

Do not set `ADMIN_INITIAL_PASSWORD` on the worker.

#### Backups and the Postgres client version

The worker image installs `postgresql-client-16` (build arg `PG_MAJOR`, default `16`). `pg_dump` must be the same major as the Railway Postgres server or newer. Check the server once, in the Railway Postgres service's Data tab or with `railway connect Postgres` and then:

```sql
SHOW server_version;
```

If the major is not 16, add a **service variable** `PG_MAJOR=<major>` on the worker (Railway passes service variables to Docker builds as build args) and redeploy. The job also checks at run time and fails with a clear message (`pg_dump 16 is older than the database server 17`) and an admin email if they ever drift, for example after Railway upgrades Postgres.

The job runs daily at 03:30 America/New_York. To try it without waiting, run it once from the worker's Railway shell: `cd /app/apps/worker && pnpm exec tsx scripts/backup-now.ts`. Then check Admin → Services → Backups and the object in R2. Restore steps: `docs/RESTORE.md`.

### How to verify this step

- Web variables include `EMAIL_TRANSPORT=resend`, `STORAGE_DRIVER=s3`, and a bucket-scoped R2 token.
- Worker variables have no pre-deploy and no `ADMIN_INITIAL_PASSWORD`.
- Neither secret contains the words the production guard rejects.
- `BACKUP_PASSPHRASE` is set on the worker and absent from web. `APP_ENV` is set on the worker.
- After the first deploy, run `scripts/backup-now.ts` once (see above). The log line `database backup uploaded` shows the `pgDump` and `server` majors, and Admin → Services → Backups turns green.

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

- Header on a signed-in page: Alinstra (home), Home, Clients, Plans, Services, and the account menu with Sign out.
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

## Staging lessons from the first deploy

The `railway.toml` files are reference only. New Railway services cannot opt in to config-as-code. The dashboard is the source of truth. Copy settings from the toml, then confirm each one in the service settings.

Check Settings → Source on web and worker. The first web service was still on `phase-2` and failed its health check. Staging that should run this work tracks `phase-3` until that branch is the one you mean to run. Do not point staging at `main` for Phase 3.

Deploy once before adding the custom domain. Railway detects the port from the running service. Adding the domain first leaves the target port unset.

Railway's one-click Cloudflare DNS turns the proxy on. The `staging` CNAME must be DNS only (grey cloud).

Never click Add under Railway's Suggested Variables. Those values come from `.env.example`, including `change-me-min-12-chars`, and the production guard refuses to start.

Seed the admin from the web service's Console tab: `pnpm db:seed`. Then delete `ADMIN_INITIAL_PASSWORD` after two-factor is enrolled.

Redis on Railway's private network is dual-stack. The ioredis clients use `family: 0` so they can resolve that hostname.

Admin notice emails go to the worker's `ADMIN_EMAIL` variable. Changing the admin's login email on `/account` does not change that variable. Update `ADMIN_EMAIL` on the worker (and web, for client-zero message mail) separately.

## Phase 3 keys (only after the phase-3 branch is what staging runs)

Leave these empty until you are ready for one real Retell number. Empty keys make the process use fakes and refuse live provisioning when `NODE_ENV=production`.

| Variable | Web and worker | How to get it |
| --- | --- | --- |
| `RETELL_API_KEY` | both | Retell dashboard → API keys. One key with the webhook badge. Staging and production are different keys. |
| `RETELL_DEFAULT_AREA_CODE` | both | Optional 3-digit US area code for local numbers when the wizard leaves it blank. |
| `RETELL_DEFAULT_TOLL_FREE` | both | `true` or `false`. Default `false`. Used only when the wizard has not chosen. Client zero's wizard starts with toll-free checked. |
| `STRIPE_SECRET_KEY` | both | Stripe test mode secret key (`sk_test_...`) for staging. |
| `STRIPE_WEBHOOK_SECRET` | web | Stripe → Developers → Webhooks → endpoint `https://staging.alinstra.com/api/stripe/webhook` → signing secret. |
| `DANIEL_TRANSFER_NUMBER` | both | Your cell as a US or Canada number, `+1` then 10 digits, for client zero. |

Stripe webhook API version: the code pins `2026-09-30.endive` (`STRIPE_API_VERSION` in `packages/providers/src/types.ts`) on every request it makes. Subscribe to `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.deleted`, `customer.subscription.updated`, `invoice.payment_failed`, and `invoice.paid`. Full dashboard checklist: `docs/BILLING.md`.

The webhook endpoint created on 4 October 2026 is on `2026-08-26.dahlia` because the dashboard did not yet offer `endive` for new endpoints. That mismatch is safe: the webhook handler reads `items.data[].current_period_end` (present in both versions) and never the removed top-level `current_period_end`. When the dashboard lets you select `2026-09-30.endive` for the endpoint, bump it so the event payloads match the version the code requests. No code change is needed for the bump.

Retell webhook URL: `https://staging.alinstra.com/api/retell/webhook`. Inbound URL is set by the app when it buys the number. There is no Retell sandbox and no API spend cap. Before buying the first number, set cost and usage alerts in the Retell dashboard. Use one number. End service, or delete the number, to stop the monthly charge.

Toll-free numbers need a toll-free verification before they can send texts. That is deferred past Phase 5 (no SMS yet); buying the number for voice does not need it.

### Retell billing (learned on the first live call)

Retell bills two ways at once:

- **Usage is prepaid credits.** Calls, LLM, and voice minutes draw down a credit balance. Auto recharge may be off on a new account; when the balance hits zero, calls stop. Before the first real client, turn **auto recharge on** and set a **Budget Setting** (monthly cap) in the Retell dashboard under Billing so a runaway day cannot drain the card.
- **Phone numbers are monthly subscriptions billed to the card on file**, not to credits. Toll-free is $5/month plus $0.06 per inbound minute; local is $2/month.
- Retell requires **identity verification** on the account before it sells phone numbers. Finish that in the dashboard before the first **Confirm and buy**; otherwise `retell_number` fails with a verification error.
- A **past-due card** or an overdue balance makes inbound calls fail at the carrier with **"user busy"**. The agent is fine; the account is not. Check Billing in the Retell dashboard first when a caller reports busy signals. The admin **Services** page repeats this note on the Retell card and its **Check** button confirms the API key still authenticates.

### Call timing defaults

Each client's agent carries three timing values, set on the wizard's Coverage step and stored in `client.coverage.callTiming`:

| Setting | Default | Range | Retell field |
| --- | --- | --- | --- |
| Max call length | 15 minutes | 1–60 | `max_call_duration_ms` |
| End after silence | 30 seconds | 10–300 | `end_call_after_silence_ms` |
| Remind after silence | 8 seconds | 5–60 | `reminder_trigger_ms` |

Defaults and ranges live in `CALL_TIMING_DEFAULTS` and `CALL_TIMING_LIMITS` in `packages/providers/src/types.ts`; the Retell mapping clamps to those ranges in `retellTiming()`. Ava also has the built-in `end_call` tool and a prompt rule to use it once the caller is done. The first sync after this deploy applies 15 min / 30 s / 8 s to client zero's existing agent.

### Privacy model (Phase 4 part 1)

Ava never sees a staff member's phone number. Transfer targets are published to Retell as `transfer_<slug>` tools named only by label; the number is attached by the server at publish time and never appears in the prompt or any dynamic variable. `/api/retell/tools/transfer` answers `{ allowed, tool }` or `{ allowed: false, reason }`, never a number. The only numbers Ava may read aloud are the client's **public phone** and **public email** from wizard step 1 (`publicPhone`, `publicEmail`); when they are blank she says the office will call back. Client zero's public phone is set to its Alinstra number when it is bought.

### Calls: transcripts, recordings, access, retention (Phase 4b)

Phase 3 stored call metadata only. Phase 4b deliberately reverses that: transcripts and recordings are stored as an access-controlled, retention-limited feature. No new environment variables; the existing `ENCRYPTION_KEY`, Redis, and R2 bucket are used.

**Webhook events consumed.** `POST /api/retell/webhook` (signature `x-retell-signature`, verified with `RETELL_API_KEY`) handles `call_started`, `call_ended`, and `call_analyzed` ([Retell webhook docs](https://docs.retellai.com/features/webhook)). Other events (`transcript_updated`, `transfer_*`) are ignored. Retell retries without a 2xx and may deliver the same event twice or `call_analyzed` before `call_ended`; the handler is idempotent by `call_id` and merges fields, so order does not matter. Fields read from the call object ([get-call reference](https://docs.retellai.com/api-references/get-call)): `call_id`, `agent_id`, `from_number`, `to_number`, `start_timestamp`, `end_timestamp`, `duration_ms`, `disconnection_reason`, `transcript`, `transcript_with_tool_calls` (falls back to `transcript_object`), `recording_url` (presence only, see below), `call_analysis.{call_summary,user_sentiment,call_successful,in_voicemail}`, and `call_cost.combined_cost` (cents).

**What is stored and how.** On `CallRecord`: the transcript (plain text plus the structured turn array with roles, word offsets, and tool invocations paired with their results), the call summary, the caller's number, and the raw webhook events are each encrypted with `@alinstra/crypto` under `ENCRYPTION_KEY` (`transcriptCipher`, `summaryCipher`, `callerE164Cipher`, `rawEventsCipher`). Plain columns: `callerMasked`, duration, end reason, `sentiment`, `successful`, `inVoicemail`, `costCents`, `outcome` (`message_taken | transferred | booked | no_action | hung_up`, derived from the tool calls and disconnection reason), `recordingStatus` (`none | pending | stored | failed | purged`), `recordingKey`, `purgedAt`. The Retell `recording_url` is never written to the database, Redis, or logs; the raw events kept for the admin view have it stripped.

**`calls` queue.** New BullMQ queue, consumed by the worker alongside `email`, `knowledge`, and `provision`.

- `store-recording` (jobId `recording-<retellCallId>`, 3 attempts, exponential backoff from 30 s). Enqueued once, on the first event that reports a recording. The payload is only the Retell call id; the worker calls Retell's `GET /v2/get-call/{id}` to resolve the recording, downloads it (64 MB cap), and writes it to R2 under `clients/<clientId>/calls/<retellCallId>.<ext>` (`wav` by default; `mp3`/`ogg`/`webm` from the served content type). Success marks the row `stored`; failure marks `failed` with the error text (visible to admin on the call page) and lets BullMQ retry.
- `purge-calls` (job scheduler id `purge-calls-daily`, cron `15 3 * * *`, registered by the worker at start; re-registering is idempotent). For each client it purges calls that started at or before `now − callRetentionDays`: deletes the R2 object, nulls the transcript, summary, caller, and raw-event ciphers, sets `purgedAt`, and keeps duration, outcome, sentiment, and cost. One `calls.purged` ChangeLog line per client per run when anything was purged; `Client.lastCallPurgeAt` / `lastCallPurgeCount` feed the "Last purge" line on the admin client page. Archived clients purge on the same schedule and are purged **fully** (everything regardless of retention) once `serviceEndsAt + 30 days` has passed (`ARCHIVED_PURGE_GRACE_DAYS`). The same job also re-enqueues recordings stuck in `pending` (see below).

**Recording job resilience.** `applyRetellCall` moves a row to `recordingStatus = "pending"` before the webhook enqueues `store-recording`. If that enqueue throws (Redis blip), the webhook rolls the row back to `"none"` via `resetRecordingPending`, so Retell's next event or retry can re-queue on the usual `none → pending` transition. Separately, the daily `purge-calls` job finds rows still `pending` with no `recordingKey`, `purgedAt` null, and `updatedAt` older than one hour, and re-enqueues `store-recording` for each (jobId `recording-<retellCallId>` dedupes safely). Rows marked `failed` are left alone for admin visibility.

**R2 layout.** `clients/<clientId>/knowledge/...` (Phase 2 uploads) and `clients/<clientId>/calls/<retellCallId>.<ext>` (recordings). The bucket stays private; recordings have no public or presigned URLs.

**Playback.** `GET /api/calls/[id]/recording` streams from R2 after the access check, with `Range` support (206 / `Content-Range`) so the `<audio>` element can seek; `Cache-Control: private, no-store`. Anything the caller may not see is `404`, never `403`.

**Access model.** `canAccessCall(viewer, call)` guards every calls route and page: admin sees every client; an owner sees their own client; staff see their own client only when the owner has turned on **Can view calls** for them on the Team page (`User.canViewCalls`, default off; each toggle writes a `call_access` ChangeLog line). Admin and owner see the full caller number (decrypted at render); staff see the masked number. The Calls nav link is hidden from staff without the grant.

**Retention setting.** `Client.callRetentionDays` (7–365, default 90) lives on the Compliance wizard step and the admin edit flow. Healthcare-sensitive clients see a "shorter is better" hint; nothing is forced.

### Shipped in Phase 5

#### Owner edit flow and review holds

Owners edit their submitted client from **My Business** (`/home/business`) through the same step list the admin sees. Each editable step opens `/home/business/edit/[step]` and calls `editClientStep` under the owner's `TenantContext` (scoped to their `clientId`). Saves write the client row, rebuild an `AgentConfig` when the step affects Ava, enqueue a sync when provisioned, and append an `owner_edit` ChangeLog with the same redacted diff shape as `admin_edit`. **Plan (step 3) and Compliance (step 9)** stay admin-only; the owner sees them read-only with "Email support@alinstra.com to change this." Call retention stays editable on My Business via `setCallRetention`. Staff see My Business read-only.

Risky owner step edits do not publish immediately. When the edited text trips `sensitiveHoldReason`, or when voice, transfer targets, or booking mode change, the save creates a held `QuickUpdate` of kind `owner_step`. The owner sees **Waiting for review** (with the submitted values) on My Business; the admin approves or rejects from the home held-update queue as today. Approval applies the step and syncs; rejection stores a reason the owner can read. Existing QuickUpdateForms (hours, closure notices, staff, one FAQ) keep publishing directly unless their own sensitive-text hold fires.

#### Client using their own number

Surfaced on `/home/business/forwarding` when wizard step 8 `phone.mode = "forward"` (the schema value; older docs said `own_number`). Linked from My Business; Alinstra-number clients (`new_number`) see a muted note that forwarding is not needed. Nothing in the app sets up forwarding — the carrier does it.

A client who keeps their existing business number forwards it to their Alinstra number only when they do not answer, so Ava takes the calls they miss. Set **conditional call forwarding** (no answer and busy), not unconditional forwarding.

- **AT&T (landline and wireless):** dial `*92` then the Alinstra number to forward on no answer; `*90` then the number for busy. Cancel with `*93` / `*91`.
- **Verizon:** dial `*71` then the Alinstra number for no-answer and busy forwarding. Cancel with `*73`.
- **T-Mobile:** dial `**61*1<alinstra number>#` for no answer and `**67*1<alinstra number>#` for busy. Cancel with `##61#` / `##67#`.
- **Landline and VoIP providers (Comcast, Spectrum, RingCentral, Ooma, and others):** the codes vary; most expose "Forward when unanswered" and "Forward when busy" in the account portal. Set both to the Alinstra number and pick the ring count before forwarding (3–4 rings).

Carrier codes change and some business lines have forwarding disabled by default. Confirm the exact codes with the carrier, then test by calling the business number from a cell and letting it ring out; Ava should answer with the client's greeting. The portal page shows the Alinstra number large, a copy button, and a short test checklist with a link to Calls.

#### Continuous greeting (template v7)

Ava's opening is one continuous utterance: greeting, optional recording notice, and (when closed) the after-hours line, ending in "How can I help?". The inbound webhook overrides Retell's `begin_message` from `office_open` so she does not pause for the caller mid-greeting. Prompt template version is `"7"`.

### Number purchase approval (Phase 4)

Retell's API has no "list available numbers" endpoint; `POST /create-phone-number` buys whatever matches the area code or toll-free flag. Because the admin cannot pick a specific number, the admin page uses a confirmation modal instead of a picker. **Start provisioning** opens the modal, which names the kind of number (toll-free, or local in the wizard's area code or `RETELL_DEFAULT_AREA_CODE`) and its monthly cost (toll-free $5/month plus $0.06 per inbound minute; local $2/month). Nothing is bought until the admin clicks **Confirm and buy**; that stamps `numberApprovedAt` on the provisioning run. A run that reaches `retell_number` without that stamp stops with the step marked `awaiting_approval` and the page shows an **Approve and buy number** button. The worker never buys a number for a run without `numberApprovedAt`.

When any provisioning step fails, the worker emails `ADMIN_EMAIL` (or the admin who started the run when that variable is empty) with the client, the step label, the provider error text, and a link to the client page. The same error text appears on the client page in a copyable block.

### How to verify this step

- A client with two-factor admin can start provisioning and the page shows a Checkout link before the client is live. The link opens `/billing/thanks` after payment, which does not require an admin login.
- Client zero skips Checkout, gets a number, and shows In sync after a config change.
- A browser upload still works. The health check is still `"db": "up"` and `"redis": "up"`.

### Shipped in Phase M

Public marketing site at `/` (route group `apps/web/src/app/(marketing)/`). Copy source: `docs/marketing-copy.md`. `[Product]` renders from `PRODUCT_NAME` in `apps/web/src/lib/brand.ts` (currently `"Ava"`). `ASSISTANT_NAME` is `"Ava"` and does not change with the product rename.

**Routes.** `/`, `/pricing`, `/industries`, `/about`, `/start`, `/legal`. Portal routes (`/home`, `/admin`, `/account`) keep their own layouts with `AppHeader`. Signed-in visitors see "Go to dashboard" in the marketing header via a client island that hits `/api/session-status` — Home/Pricing/Industries/About stay ISR (`revalidate = 3600`). `/start` is dynamic (lead form).

**`publicSiteConfig()`.** Tenant-free helper in `packages/db` that returns `{ phone, email }` from the internal client (client zero), cached in-process for one hour. Phone falls back to optional env `MARKETING_PHONE`; email falls back to `hello@alinstra.com`. Never hard-code the Call Ava number in components.

**`publicPlans()`.** Tenant-free active plans ordered by `sortOrder` for the pricing table. Cents formatted server-side; `includedChangesPerMonth === null` shows as Unlimited.

**Leads.** Prisma model `Lead` (migration `20261005010000_phase_m_leads`). `/start` saves a row, rate-limits 5/hour/IP via `@alinstra/auth` counters, rejects a honeypot silently, and enqueues `sendAdminNotice` ("New lead: \<business\>"). No auto-reply to the lead. Admin list at `/admin/leads` (newest first, mark contacted, Create client prefilled).

**SEO.** Per-page metadata with canonical `https://alinstra.com`. `/sitemap.xml` and `/robots.txt` (disallow `/admin`, `/home`, `/api`).

**Apex DNS cutover (when ready to put marketing on alinstra.com).** Staging stays on `staging.alinstra.com` unchanged.

1. Railway → web service → Settings → Networking → Custom Domain → add `alinstra.com` and `www.alinstra.com` (or the Railway hostname you will CNAME to).
2. Cloudflare → DNS → replace the apex **A** record `162.0.212.4` with a **CNAME-flattened** record for `@` pointing at the Railway web hostname. Proxy status **DNS only** (grey cloud).
3. Cloudflare → DNS → set `www` **CNAME** to the same Railway hostname. Proxy status **DNS only**.
4. Leave the `staging` CNAME as it is (still DNS only).
5. Wait for Railway certificates on both apex and `www`. Confirm `https://alinstra.com` serves marketing and `https://staging.alinstra.com` still serves staging.

Do not orange-cloud (proxy) the apex or `www` until you have a reason; grey cloud matches the staging setup.

## Shipped in Phase 5b-i (interview wizard)

Chat-style AI onboarding that fills the existing `WizardDraft` / `WizardPayload`. Nothing in render, provisioning, or holds changed. Plan: `docs/phase-5b-interview-plan.md`.

**Feature flag.** When `TEXT_API_KEY` is empty, "Start with an interview" is hidden and `/admin/clients/[id]/interview` plus `/home/business/interview` return 404. The API key is env-only — never stored in `AppSetting`.

**Provider.** `packages/providers` `TextPlatform` / `httpText()` posts OpenAI chat-completions to `{TEXT_API_BASE}/chat/completions`. Same client works against OpenRouter, Ollama Cloud, OpenAI, and Anthropic's OpenAI-compatible endpoint. OpenRouter gets `HTTP-Referer: https://alinstra.com` and `X-Title: Alinstra`. Retries on 429/5xx with backoff; 30s timeout; prompts are never logged.

**Cost guard.** Each interview stops with a friendly message after the input/output token budgets (defaults 60k / 12k). Override via env or `/admin/interview` (`AppSetting` overrides base/model/fallback/budget; env remains the default).

**Question banks.** Data files under `packages/agent/src/interview/banks/`. `general.ts` always loads; `hvac.ts` and `veterinary.ts` append for those industries. To add an industry: add a bank file, register it in `banks/index.ts`, and use the industry string from the client/wizard. No engine code changes required for new questions.

**Switching models.** Set `TEXT_MODEL` / `TEXT_FALLBACK_MODEL` in the environment, or save overrides on `/admin/interview`. Sessions record the model and token counts used.

**Routes.** Admin: `/admin/clients/new` (optional interview intent), `/admin/clients/[id]/interview`, `/admin/interview` (settings + sessions). Owner: `/home/business/interview` while `wizardSubmittedAt` is null ("Set up your receptionist"). Finish merges collected fields into the draft without overwriting admin/owner-filled values, then returns to the wizard (admin) or My Business (owner).

## Production later

Repeat this checklist in a separate Railway project. Hostname `app.alinstra.com` for the portal if you split hosts later; with Phase M the marketing site can live on the apex while staging stays on `staging`. Own Postgres, Redis, R2 bucket, Resend key, and Sentry environment `production`. Grey-cloud CNAMEs. Do not share staging's database, Redis, bucket token, or `ENCRYPTION_KEY`. Enroll a new admin and delete that environment's `ADMIN_INITIAL_PASSWORD` the same way.
