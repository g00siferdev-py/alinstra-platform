# Production setup

Daniel follows this top to bottom in Railway and Cloudflare. The code this describes is on `main` after Phase P. Stripe live mode waits on the LLC bank account and the accountant's tax sign-off. Until then the public site stays in prelaunch: visitors see the finished site and `/start`, not Checkout.

## 1. Create the environment

1. Railway → **New Project** named `alinstra`.
2. Add an environment named `production` in **US East**.
3. Add services:
   - **Postgres** (note the major version on the service page; staging was 18).
   - **Redis**.
   - **worker** and **web**, both from this GitHub repo.
4. On both `web` and `worker`:
   - Settings → Source → branch **`main`** (the staging environment stays on branch `staging`).
   - Turn **Wait for CI** on.
5. Do not click **Add** under **Suggested Variables**. Those are guesses and will not match this app.

## 2. Variables

Generate these offline and keep a copy somewhere that is not Railway and not the repo: `ENCRYPTION_KEY` (32 random bytes, base64), `BACKUP_PASSPHRASE`, `BETTER_AUTH_SECRET` (32+ random bytes), and the admin authenticator backup codes after you enroll two-factor.

`LAUNCH_STATE` stays **unset**. Unset means prelaunch. Do not set `LAUNCH_STATE=live` in this pass.

Set `APP_ENV=production` on both services. Set `PG_MAJOR` to the Postgres major version from step 1 (the backup job uses it).

| Variable | Web | Worker | Where the value comes from |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | yes | `production` |
| `APP_ENV` | yes | yes | `production` (new; not a copy of staging) |
| `APP_URL` | yes | yes | `https://alinstra.com` |
| `BETTER_AUTH_URL` | yes | yes | `https://alinstra.com` |
| `BETTER_AUTH_SECRET` | yes | yes | **New** secret. Do not copy staging. |
| `ENCRYPTION_KEY` | yes | yes | **New**. Keep your offline copy. Staging's key must never be reused. |
| `ENCRYPTION_ACTIVE_KEY` | yes | yes | `1` until you rotate (see `docs/KEY-ROTATION.md`) |
| `ADMIN_EMAIL` | yes | yes | The address that receives lead and billing notices |
| `ADMIN_INITIAL_PASSWORD` | web only, until seed | no | One-time, 12+ characters. Delete after two-factor is enrolled |
| `DATABASE_URL` | yes | yes | Railway Postgres → **Connect** → the private URL |
| `REDIS_URL` | yes | yes | Railway Redis → **Connect** |
| `EMAIL_TRANSPORT` | yes | yes | `resend` |
| `EMAIL_FROM` | yes | yes | A verified Resend sender, e.g. `notifications@alinstra.com` |
| `RESEND_API_KEY` | yes | yes | Resend dashboard, production key |
| `SENTRY_DSN` | yes | yes | Sentry project for this app, environment `production` |
| `SENTRY_ENVIRONMENT` | yes | yes | `production` |
| `LOCKOUT_STORE` | yes | no | `redis` |
| `TRUSTED_PROXY_HOPS` | yes | no | `1` |
| `STORAGE_DRIVER` | yes | yes | `s3` |
| `S3_ENDPOINT` | yes | yes | Cloudflare R2 S3 endpoint |
| `S3_BUCKET` | yes | yes | **New** bucket `alinstra-production` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | yes | yes | **New** R2 token scoped to that bucket |
| `S3_REGION` | yes | yes | `auto` |
| `BACKUP_PASSPHRASE` | no | yes | **New**. Keep your offline copy. See `docs/RESTORE.md` |
| `BACKUP_S3_BUCKET` | no | optional | Blank uses `S3_BUCKET` under `backups/` |
| `PG_MAJOR` | no | yes | The Postgres major version from the Railway card |
| `STRIPE_SECRET_KEY` | yes | yes | Stripe **live** dashboard → Developers → API keys → `sk_live_…`. Not `sk_test_`. |
| `STRIPE_WEBHOOK_SECRET` | yes | no | New live endpoint (section 4) |
| `RETELL_API_KEY` | yes | yes | Same Retell workspace as staging |
| `DANIEL_TRANSFER_NUMBER` | yes | yes | E.164 transfer number already used for client zero |
| `RETELL_DEFAULT_AREA_CODE` | yes | yes | Copy from staging if you use a local default |
| `RETELL_DEFAULT_TOLL_FREE` | yes | yes | `true` for the toll-free default |
| `MARKETING_PHONE` | yes | yes | The toll-free line, E.164. Required in production. |
| `TEXT_API_BASE` | yes | no | `https://openrouter.ai/api/v1` unless you change provider |
| `TEXT_API_KEY` | yes | no | OpenRouter (or the text provider) production key. Required. |
| `TEXT_MODEL` | yes | no | Leave unset to use the code default, or copy the staging model |
| `TEXT_FALLBACK_MODEL` | yes | no | Optional. A fallback model skips streaming and uses the buffered turn |
| `TEXT_BUDGET_INPUT_TOKENS` / `TEXT_BUDGET_OUTPUT_TOKENS` | yes | no | Optional. Defaults are 60000 and 12000 |
| `LAUNCH_STATE` | unset | unset | Leave blank until section 9 |

`assertProductionEnv` refuses to start when `APP_ENV=production` if the Stripe key is `sk_test_`, the webhook secret is missing, `APP_URL` is not `https://alinstra.com` or `https://www.alinstra.com`, `TEXT_API_KEY` or `MARKETING_PHONE` is empty, or the active encryption key is missing. The worker also refuses to start without `BACKUP_PASSPHRASE`.

## 3. First deploy

1. Push to `main` (an empty commit is enough if nothing else changed) and wait until GitHub CI is green.
2. Railway → production `web` and `worker` → confirm the deploy card's commit message matches that push.
3. Open a **fresh** console on `web` (not a shell left over from another deploy).
4. If the deploy log does not already say migrations applied, run `pnpm db:migrate:deploy`.
5. Run `pnpm db:seed` (plans + the admin user from `ADMIN_EMAIL`).
6. In the `web` and `worker` logs, confirm there is no `Refusing to start` line. A keyring line means the process passed the guard.
7. Sign in, enroll two-factor, save the backup codes offline, then delete `ADMIN_INITIAL_PASSWORD` and redeploy `web`.

## 4. Stripe live

Do this only after the LLC bank account is connected and the accountant has signed off on tax registration. Until then leave the live keys unset only if you are not booting `APP_ENV=production` yet — production will not start on `sk_test_`. The site keeps sending Get started to `/start` until section 9.

In the Stripe dashboard, switch to **live** mode and repeat `docs/BILLING.md` §1:

1. Customer portal: update cards, invoice history, cancel **at period end**. Do not allow plan switching.
2. Smart Retries, 8 tries within 2 weeks. If all retries fail → **Mark the subscription as unpaid**.
3. Customer emails for failed payments: on.
4. Stripe Tax on, origin address set, registrations only where the accountant said to register. Catalog tax code and exclusive prices come from sync, not from clicking around the product list.
5. Developers → Webhooks → **Add endpoint** `https://alinstra.com/api/stripe/webhook` with these seven events: `checkout.session.completed`, `checkout.session.expired`, `invoice.payment_failed`, `invoice.paid`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
6. Put `sk_live_…` on web and worker. Put the new signing secret on web only.
7. Fresh web console: `cd packages/db && pnpm stripe:sync`.

## 5. Retell

Use the same Retell workspace. Client zero's agent and number already exist there.

`publicSiteConfig()` reads the internal client's public phone (client zero). If that phone is empty, the site uses `MARKETING_PHONE`.

1. Admin → create client zero if seed did not (the internal Alinstra client).
2. Put the toll-free number on that client's public phone so the header says Call Ava with the real line.
3. In Retell, turn **auto recharge** on and set a budget cap before `LAUNCH_STATE=live`.

## 6. DNS cutover (Cloudflare, DNS only)

1. Railway → production `web` → Settings → **Custom Domain** → add `alinstra.com` and `www.alinstra.com`.
2. Railway shows the records to add. In Cloudflare DNS, add those records as **DNS only** (grey cloud). Do not proxy them.
3. Do not edit MX, SPF, DKIM, DMARC, or the `staging` CNAME.
4. Wait until Railway shows the certificate as active.
5. Open `https://alinstra.com` and `https://www.alinstra.com`. Both should load the site.
6. Open `https://alinstra.com/robots.txt`. It should allow `/` and disallow `/admin`, `/home`, and `/api`. (`APP_ENV=production` is what allows indexing. Staging stays `Disallow: /`.)
7. Remove the Namecheap parking A record and the Gamma `www` CNAME only after the two hostnames above load.

## 7. Backups

1. After the worker has been up past 03:30 America/New_York, Admin → Services → Backups should show the first production object under `backups/production/`.
2. Do one restore drill into a scratch database, following `docs/RESTORE.md`. Do not restore over the production database.

## 8. Smoke test

1. From an outside phone, call the toll-free line: after-hours opening, a request for Daniel's number (refused), a pause long enough to hear the silence timing, and a weekday transfer.
2. Submit `/start` on `https://alinstra.com`. The admin inbox (`ADMIN_EMAIL`) should get one "New lead" email, and `/admin/leads` should show Source `prelaunch`.
3. Sign in as admin.
4. Sentry (environment `production`) should have no startup errors.

## 9. Going live later

1. Stripe live is verified (section 4, including a real webhook delivery).
2. Set `LAUNCH_STATE=live` on the production `web` service. Marketing pages read this on each request, so you do not need a new build. Redeploy only if Railway does not restart the process when the variable changes.
3. On the real site, confirm plan buttons go to `/signup?plan=…`, `/signup` no longer redirects to `/start`, and the pages still do not say "coming soon", "launching", "reserve", "text", or "most popular".
