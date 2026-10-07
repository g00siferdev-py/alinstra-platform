# Billing runbook (Phase B)

For Daniel. Do this in **Stripe test mode** first, then repeat the same dashboard settings in **live mode** when the LLC, EIN, and bank account are ready. Switching test → live is config only (keys, webhook secret, price sync) — never a code change.

Stripe API version used by our code: `2026-09-30.endive` (`STRIPE_API_VERSION` in `packages/providers`). Webhook endpoints may still be on `2026-08-26.dahlia` until the dashboard offers endive; both shapes expose period bounds on subscription **items**.

Docs we followed for Billing Meters / meter events:
- [Billing Meters](https://docs.stripe.com/billing/subscriptions/usage-based/billing-meters)
- [Meter events](https://docs.stripe.com/api/billing/meter-event)
- [Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal)
- [Subscription item periods (basil+)](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end)

---

## 1. Stripe dashboard settings (test, then live)

### Customer Portal

Dashboard → Settings → Billing → Customer portal:

- **Allow** customers to update payment methods (cards).
- **Allow** invoice history / download.
- **Allow** cancel subscription **at period end** (not immediately).
- **Do not** allow customers to switch plans in the portal. Plan changes go through the owner `/home/billing` → admin approval flow (`PlanChangeRequest`).

Return URL for portal sessions is `/home/billing` on the app.

### Smart Retries and failed-payment emails

Dashboard → Settings → Billing → Subscriptions and emails (or Revenue recovery):

- Turn **Smart Retries** ON.
- Retries: **Smart Retries**, **8 tries within 2 weeks**.
- **If all retries for a payment fail** → **Mark the subscription as unpaid** (not cancel, not leave past-due). Cancel would end service behind our back; past-due would keep charging a paused business. Our webhook treats `status: unpaid` as pause Ava and wait for payment.
- Turn **customer emails for failed payments** ON (Stripe emails the cardholder; we also send our own plain-text owner email with a link to `/home/billing`).

### Stripe Tax

Dashboard → Settings → Tax:

- Turn **Stripe Tax** ON.
- Set the **origin address** (Alinstra’s business address).
- Add **tax registrations** only after the accountant confirms which jurisdictions to register in. Checkout already sends `automatic_tax[enabled]=true`, collects billing address, and keeps catalog prices tax-exclusive.
- Because we create the Stripe Customer before Checkout, Checkout also sends `customer_update[address]=auto` and `customer_update[name]=auto` so the address and business name collected at Checkout are saved onto the Customer (required for Tax on existing customers). We do **not** enable `tax_id_collection` (US businesses are outside Stripe’s tax-ID collection list).

### Webhook endpoint

Create an endpoint pointing at:

- Staging: `https://staging.alinstra.com/api/stripe/webhook`
- Production: your live app URL + `/api/stripe/webhook`

Subscribe to these **seven** events:

1. `checkout.session.completed`
2. `checkout.session.expired`
3. `invoice.payment_failed`
4. `invoice.paid`
5. `customer.subscription.created`
6. `customer.subscription.updated`
7. `customer.subscription.deleted`

Copy the signing secret into `STRIPE_WEBHOOK_SECRET` on the **web** Railway service only.

### Which keys go on which Railway service

| Variable | Web | Worker | Notes |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | yes | yes | `sk_test_…` until go-live; then `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | yes | no | Webhook verifier lives on web |
| `RETELL_API_KEY` | yes | yes | Voice; set with Stripe together or leave both empty for fakes |
| `APP_URL` | yes | yes | Used for Checkout return URLs and billing email links |
| `ADMIN_EMAIL` | yes | yes | Admin notices (payment failed, pause, meter failures) |
| `RESEND_API_KEY` / `EMAIL_FROM` | worker (and web if it sends) | yes | Owner billing emails go through the email queue |

Never put the publishable key in server secrets for this flow — Checkout and the Customer Portal are hosted by Stripe.

---

## 1b. Monthly owner report emails

The worker sends owner monthly report emails on a **single** schedule: **1st of each month at 09:00 America/New_York** (`MONTHLY_REPORTS_CRON` in `@alinstra/queue`). It is not staggered per client local time. Each email covers the previous **calendar month in that client's timezone**, with counts only (no caller names, numbers, or message text), and links to `/home/reports`. Internal clients are skipped; owners can turn the email off under My Business (default on).

---

## 2. How to run price sync

From the repo (with `STRIPE_SECRET_KEY` set to the mode you want):

```bash
cd packages/db
pnpm stripe:sync
# optional: also create per-client override prices
pnpm exec tsx scripts/stripe-sync.ts --with-overrides
```

What it does:

1. Ensures the `alinstra_minutes` Billing Meter (sum aggregation) and stores its id in `AppSetting` key `stripe.meter.alinstra_minutes`.
2. Creates/refreshes catalog Prices for every active plan: base monthly, setup, and graduated metered overage (first N minutes at $0, then overage cents/min).
3. Lookup keys include amounts so changing a plan amount creates a new Price instead of mutating an old one.

Run sync in **test** after deploy, and again in **live** after you switch keys.

---

## 3. Test → live checklist

1. Finish LLC / EIN / bank; activate Stripe live mode.
2. Repeat §1 dashboard settings in live (portal, retries, tax, webhook with the seven events).
3. On Railway web + worker: replace `STRIPE_SECRET_KEY` with `sk_live_…`.
4. On Railway web: replace `STRIPE_WEBHOOK_SECRET` with the live endpoint secret.
5. Redeploy web and worker.
6. Run `pnpm stripe:sync` against live.
7. Smoke: create a test live Checkout on a throwaway card if needed, confirm webhook `checkout.session.completed` marks the client `paid`.

No application code change.

---

## 4. How overage appears on invoices

- Each ended call writes a `UsageRecord` with `billableMinutes = ceil(durationSeconds / 60)`.
- The worker’s `report-usage` job (every 5 minutes) sends Stripe Billing Meter events named `alinstra_minutes` for paid, non-internal clients.
- The subscription includes a **graduated metered** price: included minutes are $0; minutes above the tier bill at the plan’s overage rate (integer cents).
- Stripe aggregates meter events into the subscription invoice at period end. The owner sees “estimated overage so far” on `/home/billing` from our `UsageRecord` ledger; the invoice is the source of truth for what Stripe charges.

---

## 5. Failed payment → pause → resume

| Day | Behavior |
| --- | --- |
| Payment fails | `invoice.payment_failed` → `billingStatus=past_due`, set `pastDueSince` if empty, admin notice + owner email with `/home/billing` link. Ava **keeps answering**. |
| Still past due after 7 days | Daily worker job `pause-past-due` at **09:00 America/New_York** → `paused`, ChangeLog, owner email, admin notice. Inbound calls get a short override (`begin_message` only + `max_call_duration_ms=12000` + `end_call_after_silence_ms=3000`) so the call ends on its own after the message; no `general_prompt` / `general_tools`. |
| Stripe ends retries (`unpaid`) | `customer.subscription.updated` with `status=unpaid` → if not already `paused`, set `paused` (keep `pastDueSince`), ChangeLog `billing.unpaid`, admin notice. Never cancel or archive. |
| Payment succeeds | `invoice.paid` (or `subscription.updated` → `active` while `past_due`/`paused`) → `paid`, clear `pastDueSince`, ChangeLog; if was paused, owner “You're all set” email. |
| Void drafts on resume | When resuming from `paused`, list the subscription’s `draft` invoices and **void** any whose `created` is after `pastDueSince`. Log voided ids on the ChangeLog `after`. Rule: no charge for months Ava was paused. |

Cancel at period end: `customer.subscription.updated` with `cancel_at_period_end=true` → `cancel_scheduled` + `serviceEndsAt`. If cancel is undone → back to `paid`, clear `serviceEndsAt`. `customer.subscription.created` stores the same period bounds as `updated`. On `checkout.session.completed`, if period bounds are still empty we `GET` the subscription once and store them so the first month has a real period. `customer.subscription.deleted` keeps the existing teardown path.

**Staging check for paused inbound:** temporarily set a test client's `billingStatus` to `paused`, call its number, confirm you hear the short “can't take your call” message and the call ends within a few seconds.

---

## 6. Meter correction choice (Part 3)

Stripe meter **adjustments** can only cancel an event within a short window; they cannot change the value. When a call’s `billableMinutes` increases after we already reported it, we send a **positive-delta** meter event:

- value = `newMinutes - previouslyReportedMinutes`
- identifier = `{usageRecordId}:corr:{newMinutes}`

Decreases are not corrected in Stripe (duration usually only grows on later Retell events). See `packages/db/src/report-usage.ts`.

---

## 7. Owner billing page and plan changes

- `/home/billing` is **owner only** (staff get 404).
- Shows plan, price, status, next bill date, this Stripe period’s minutes vs included, estimated overage, progress bar.
- **Manage billing** → Stripe Customer Portal session.
- **Change plan** → creates a `PlanChangeRequest` for the admin to-do list.
  - **Upgrade:** admin approve swaps base + metered prices immediately with proration.
  - **Downgrade:** admin approve swaps Stripe prices with `proration_behavior=none` and sets `pendingPlanId`; `planId` flips when the subscription period advances (`customer.subscription.updated`).

---

## 8. Ops commands cheatsheet

```bash
# Catalog + meter
pnpm --filter @alinstra/db stripe:sync

# Usage ledger backfill (Part 1)
pnpm --filter @alinstra/db usage:backfill -- --dry-run
```
