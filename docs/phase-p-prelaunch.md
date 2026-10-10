# Phase P: pre-launch mode + production readiness

Base: `main` at `d6b8156` (I.1 + B.2 merged, CI green). Work on a branch `phase-p`. Push the branch when done; do not merge. Claudia reviews, then you fast-forward `main` and `staging`.

## Why

alinstra.com is about to point at this app (the production Railway environment is being created in the morning). Stripe is still in test mode, so the public site must not sell anything yet, **but it must look exactly like the finished, established company it is**. No "coming soon", no "launching", no countdown, no reserve-your-spot language anywhere. A visitor sees the complete Phase L site, can call Ava, and when they click Get started they reach a request form that says we'll call them within one business day. That is what plenty of established B2B companies do, and nobody can tell from the outside that checkout isn't open. Everything in this phase is reversible by flipping one environment variable.

The rest of the phase is code that has to exist before the production cutover anyway, plus the streaming-replies polish item left over from I.1.

Honesty rules still apply everywhere: email only (never "text"), calendar booking "once connected", follow-up calls are an add-on with "ask about pricing", no "Most popular" badge, Enterprise is contact-only, illustrations use fictional names and 555 numbers.

---

## P.1 Pre-launch mode

Add a launch-state setting read by the marketing site:

```ts
// brand.ts (next to PRODUCT_NAME / FOUNDING_OFFER)
export type LaunchState = "prelaunch" | "live";
export const LAUNCH_STATE: LaunchState =
  process.env.LAUNCH_STATE === "live" ? "live" : "prelaunch";
export const COMPANY_TAGLINE = "Empowering businesses with the power of AI";
```

Default is `prelaunch` so a fresh production environment can never accidentally sell. We flip to `live` by setting `LAUNCH_STATE=live` on Railway; marketing pages are already `force-dynamic`, so no redeploy is needed.

**When `LAUNCH_STATE === "prelaunch"`:** the site renders the full Phase L design and copy, with these differences only.

1. **Every plan CTA** (`Start Solo`, `Get started`) points to `/start?plan=<code>` instead of `/signup?plan=<code>`. Labels do not change. The founding-offer pill stays. The hero, nav, Hear Ava, and final-CTA "Get started" buttons likewise point to `/start`.

2. **`/signup`** (any method, any query) redirects 307 to `/start` with the plan preserved. Existing owners signing in at `/login` and the owner portal are unaffected.

3. **`/start` form** keeps its Phase M heading and fields (business name, your name, phone, email, industry, missed calls per week) and the plan chip from `?plan=`. Success copy stays: *"Thanks. We'll call you within one business day to walk through setup, and you'll be live within 24 hours of that call."* Save `Lead.source = "prelaunch"` (new nullable string column, idempotent migration) and the existing `planInterest`. Rate-limit: 5 submissions/hour/IP, reuse the limiter from `/signup`.

4. **Lead notification.** On every new lead, send one email via the existing Resend transport to `ADMIN_EMAIL` (subject: `New lead: <business> (<plan or "no plan">)`, body: the form fields + a link to `/admin/leads`). Use the `MemoryEmail` fake in tests.

5. **Admin.** `/admin/leads` gets a "Source" column and a filter chip for `prelaunch`. Nothing else.

**When `LAUNCH_STATE === "live"`:** the site renders exactly as Phase L shipped it (self-serve `/signup`). Add a test that renders the home page and pricing page in both states and asserts: no `/signup` link in prelaunch; `/signup` links present in live; and the strings "coming soon", "launching", "reserve", "text", and "most popular" never appear in either.

**Both states, copy changes (update `docs/marketing-copy.md` to match):**

6. **Footer.** The first line becomes **"Alinstra Technologies LLC — Empowering businesses with the power of AI."** (`COMPANY_TAGLINE`), followed by the existing "Practical AI for small businesses, starting with the phone. Morristown, Tennessee." The copyright line already says "Alinstra Technologies LLC". Add the tagline as the `<meta name="description">` fallback for `/about` and as the `og:description` on the home page.

7. **About page.** Heading becomes **"Alinstra Technologies"** with the tagline as the subline, then the existing Phase M body.

8. **How it works, step 2.** Title becomes **"Forward your calls, or get a new number."** Body: *"Keep the number you have and let your carrier send the calls you can't pick up to Ava. Or, if you're just starting out, we give you a new local number you can put on the truck and the business cards."* Mini: unchanged.

9. **Robots / sitemap.** `robots.txt` returns `Disallow: /` unless `APP_ENV === "production"`. Sitemap only lists marketing pages. Staging must never be indexed.

---

## P.2 Production startup guard

In the web and worker entry points (where env is validated today), add `assertProductionEnv()` that runs when `APP_ENV === "production"` and **refuses to start** (throws with a plain message, logged + Sentry) if any of these hold:

- `STRIPE_SECRET_KEY` starts with `sk_test_`, or `STRIPE_WEBHOOK_SECRET` is unset
- `BACKUP_PASSPHRASE` is unset (worker only)
- `ENCRYPTION_KEY` is unset, or `ENCRYPTION_ACTIVE_KEY` points at a key that isn't set
- `APP_URL` is not `https://alinstra.com` or `https://www.alinstra.com`
- `TEXT_API_KEY` is unset
- `MARKETING_PHONE` is unset

Staging and local are untouched. Unit-test the guard with a fake env.

---

## P.3 `docs/PRODUCTION-SETUP.md`

A runbook Daniel can follow top to bottom in the Railway and Cloudflare dashboards without asking anyone. Write it from the current code and from `docs/BILLING.md`, `docs/RESTORE.md`, `docs/KEY-ROTATION.md`, `docs/SECURITY.md`. Sections, in order:

1. **Create the environment.** Railway project `alinstra`, environment `production`, US East. Services: Postgres (note the major version shown in Railway; it was 18 on staging), Redis, `worker`, `web`. Both `web` and `worker` build from branch **`main`** (staging builds from `staging`) with "Wait for CI" on. Never click "Add" under Suggested Variables.
2. **Variables, per service.** A table of every variable the code reads (grep the env schema), with: which service needs it, where the value comes from (new secret / copy from staging / Stripe live dashboard / Retell / R2 / Resend / Sentry / OpenRouter), and which must be **new** for production: `ENCRYPTION_KEY`, `BACKUP_PASSPHRASE`, `BETTER_AUTH_SECRET`, `STRIPE_*` (live), `STRIPE_WEBHOOK_SECRET` (new endpoint), R2 bucket `alinstra-production`. Set `APP_ENV=production`, `LAUNCH_STATE` **unset** (defaults to prelaunch), `PG_MAJOR` matched to the Postgres version, `MARKETING_PHONE` = the toll-free line. Mark clearly which values Daniel generates offline and keeps a copy of (encryption key, backup passphrase, 2FA codes).
3. **First deploy.** Push to `main` (an empty commit is fine), wait for CI, confirm the deploy card's commit message, open a **fresh** console, run migrations if the deploy doesn't, run `db:seed` (plans + admin), confirm `assertProductionEnv` passed in the logs.
4. **Stripe live.** Repeat the dashboard settings from `docs/BILLING.md` in live mode (webhook with the 7 events → `https://alinstra.com/api/stripe/webhook`, Smart Retries, failed-payment emails, "if all retries fail → unpaid", Stripe Tax origin/registration/SaaS code/exclusive, Customer portal), then `stripe:sync` in a fresh console. Note that this step waits for the LLC bank account and the accountant's sign-off on tax registration, and that the site keeps routing to `/start` until `LAUNCH_STATE=live`.
5. **Retell.** Same workspace. Client zero's agent and number already exist; document how to point the production `publicSiteConfig()` at client zero (seed or admin step) so the site shows the real toll-free number. Auto recharge ON with a budget cap before `LAUNCH_STATE=live`.
6. **DNS cutover (Cloudflare, DNS only).** Add the Railway custom domains `alinstra.com` and `www.alinstra.com` to the production `web` service; add the records Railway shows as **DNS only** (grey cloud); **never touch MX, SPF, DKIM, DMARC, or the `staging` CNAME**; wait for the certificate; verify `https://alinstra.com` and `https://www.alinstra.com` both load and `https://alinstra.com/robots.txt` allows indexing. Then remove the Namecheap parking A record and the Gamma `www` CNAME.
7. **Backups.** Confirm the nightly job runs (03:30 ET) and the Backups card shows the first production backup; do one restore drill into a scratch database per `docs/RESTORE.md`.
8. **Smoke test.** Call the toll-free line from an outside phone (after-hours opening, "can I have Daniel's number" refused, silence timing, weekday transfer); submit `/start` and confirm the admin email arrives; sign in as admin; check Sentry has no startup errors.
9. **Going live later.** The exact three steps: Stripe live verified → `LAUNCH_STATE=live` → re-run the P.1 test checklist on the real site.

Keep it plain English, numbered, with the dashboard labels Railway and Cloudflare actually use.

---

## P.4 Streaming interview replies

`/home/business/interview` and `/admin/clients/[id]/interview`: show the assistant's confirmation sentence as it's generated instead of after the full turn. Keep the I.1 engine contract (app owns the question flow; model only extracts + confirms). Implementation: the turn route streams the model's text via a `ReadableStream` (OpenAI-compatible `stream: true`), the client appends tokens to the pending bubble, and the structured extraction result arrives as the final event. Idempotency (`clientMessageId`, `InterviewSession.version`) and the 40 s timeout stay. "Thinking…" shows until the first token. If the provider doesn't support streaming (fallback model), degrade to the current non-streaming behaviour. Tests: stream parser unit test + an engine test proving a streamed turn and a non-streamed turn produce identical session state.

---

## P.5 Message retention

Decision: owner messages follow the same retention as call content, **90 days by default**, using the client's existing retention setting. Extend the nightly purge job to delete `Message` rows past retention (and anything that references their content), log counts, and show "Messages are kept N days" on the owner's settings page next to the existing transcripts line. Update `docs/SECURITY.md` inventory. Migration only if a column is needed.

---

## Verification before you push

- `pnpm test --force` twice, typecheck, lint.
- No-database production build (`next build` with `DATABASE_URL` unset) passes — marketing pages must still fall back to `PLAN_SEEDS`.
- `pnpm audit` and gitleaks clean.
- Screenshots in `docs/screenshots/phase-p/`: home, pricing, about, and footer in **prelaunch**; home and pricing in **live**; `/start` with a plan chip; the admin leads filter; a streaming interview turn mid-stream.
- `docs/marketing-copy.md` updated for the step-2 copy, footer tagline, and about heading.
- Report: branch, SHA, CI run links, test counts, and anything you deviated from with the reason.

Do not touch: Retell provisioning, Stripe sync behaviour, plan prices, the encryption layer, or anything under `packages/providers/retell`.
