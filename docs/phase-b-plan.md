Phase B: self-serve signup, Stripe billing, usage metering, and reports

## 0. Start
1. `git checkout main && git pull`. Confirm `main` is at `9f5aad2` (Phase S.1) or later. If not, stop and tell me.
2. `git checkout -b phase-b-billing`
3. Commit this file (`docs/phase-b-plan.md`) as the first commit.
4. Work the parts in order, with **one commit per part** (more is fine; never fewer). Run the tests after each part. If a part turns out much bigger than described, finish the parts before it cleanly, stop, and report rather than half-finishing.

**Context.** Alinstra does not launch until this phase is done. Everything runs on Stripe **test mode** until Daniel's LLC, EIN and bank account are ready; switching to live must be config only (keys, webhook secret, price sync), never a code change.

**What already exists, so reuse it rather than rebuild:**
- `BillingPlatform` in `packages/providers` (customer, `ensurePrice`, `createCheckout`, `cancelAtPeriodEnd`, `cancelNow`).
- The provisioning steps `stripe_customer` and `stripe_checkout`.
- `StripePrice` catalog rows (`metered_overage` kind is reserved).
- `applyStripeEvent`, which handles `checkout.session.completed` / `expired`, `invoice.payment_failed` → `past_due`, and `customer.subscription.deleted`.
- `billingStatus` on Client.
- Cancel at period end.
- Owner/admin overviews computing monthly minutes from CallRecord.
- `officeOpen()` in `domain.ts`.
- `CALL_OUTCOMES`.
- Better Auth has `disableSignUp: true`; owners are created through invites and `createCredentialUser`.
- The owner AI interview at `/home/business/interview` (pre-submit) and the admin review/provisioning flow.

**Business rules (Daniel, Oct 6):**
- **Every plan** pays at checkout first, then does the AI setup chat; Daniel reviews before go-live. No scheduled call unless the customer asks.
- **Month-to-month.** Cancel anytime from the portal; service runs to the end of the paid period. No partial refunds. The setup fee isn't refunded once setup has started.
- **Failed payment:**
  - Stripe retries and emails the customer. Ava keeps answering for **7 days**.
  - If the payment is still failed after 7 days, Ava **pauses** until it's paid.
  - Payment recovered → resume automatically.
- **Stripe Tax on:** automatic tax in Checkout, billing address collected, prices tax-exclusive.
- **Founding offer:** setup fee waived on Starter, Professional and Premium for the first ten paying businesses (`FOUNDING_OFFER` in `brand.ts`). Solo pays its own setup (now $49; this plan originally said $99).
- **Internal clients** (`client.internal`, e.g. Alinstra itself) are never billed or metered.

## Ground rules
- Every Stripe call goes through `BillingPlatform` (`http.ts` real, `memory.ts` fake for tests). Tests never hit Stripe.
- **Stripe API version:** our webhook is on `2026-08-26.dahlia`. The legacy usage-records API is gone in current versions, so use **Billing Meters** (meter + meter events) for usage. Check `docs.stripe.com` for the exact request shapes on this API version and cite the pages you used in `docs/BILLING.md`.
- Webhooks stay idempotent (`StripeEvent` unique `eventId`) and transactional, with ChangeLog entries in the same transaction.
- Money is integer cents everywhere. Minutes are integers. Each call bills `ceil(durationSeconds / 60)` minutes, the same rule the portal already shows.
- No card data ever touches our servers (Checkout and the customer portal only).
- Never log emails, names or amounts together with ids in Sentry. Ids only, as in Phase S.
- New tenant-scoped tables get scoped repositories plus isolation tests.
- Migrations stay backward-compatible.

## Part 1: Usage ledger, stale calls, caller display
- **New model `UsageRecord`:**
  - Fields: `id`, `clientId`, `callRecordId` (unique), `retellCallId` (unique), `startedAt`, `endedAt`, `durationSeconds`, `billableMinutes`, `costCents?` (Retell's cost), `internal` (copied from the client), `meterReportedAt?`, `meterEventId?`, `createdAt`.
  - It never stores caller data or content, and it survives the retention purge. Billing and reports read this table, not CallRecord, because purged calls must still count.
- Write or update it inside `applyRetellCall` when a call ends (idempotent on `callRecordId`). If the duration changes on a later event, update the row; if it was already reported to Stripe, record the difference (see Part 3).
- Backfill script `packages/db/scripts/usage-backfill.ts`: creates rows for existing ended calls. Idempotent, `--dry-run`, counts only.
- Switch the owner and admin overview minute counts to read UsageRecord, with the same numbers as before.
- **Stale "In progress" calls:**
  - A worker job `reconcile-calls` runs every 15 min.
  - Any CallRecord with no `endedAt` whose start (or `createdAt`) is more than 60 min old gets `GET /v2/get-call/{id}` from Retell (add `getCall` to the voice platform interface).
  - If Retell returns an ended call, apply it through the same path as the webhook (`applyRetellCall`).
  - If Retell returns not-found, or the call is still "ongoing" more than 3 h after start, mark it ended with `endReason: "no_final_report"`, `endedAt = startedAt + durationSeconds` (or the start time), and the outcome left null. The UI label is "Ended (no final report)".
  - Several Oct 4 staging calls are stuck like this, and the first run should fix them.
- **Caller number display:**
  - Lists (admin calls list, owner calls list, recent calls) always show the masked caller (`callerMasked`).
  - The full number appears only on call detail, for admin and owner. Staff see it masked unless they have the existing `canViewCalls` grant.
  - Today the newest call shows the full number in the list and older ones show it masked; make it consistent.

## Part 2: Self-serve signup and Checkout
- **Public `/signup?plan=<code>`**, for active plans only; Enterprise keeps going to `/start`.
  - **Form:** business name, your name, email, mobile phone, password (existing `MIN_PASSWORD_LENGTH`), and a required checkbox: "I agree to the Terms of Service and Privacy Policy" (links to `/legal#terms`, `/legal#privacy`; store `termsAcceptedAt` and `termsVersion` on the user or client).
  - **Plan summary card** beside the form: price, minutes, the setup line with the founding waiver if it applies, and "Billed monthly. Cancel anytime."
  - **Protection:** a honeypot; 5 signups/hour/IP and 3/day per email through `getCounter()`; email uniqueness with a friendly message ("You already have an account. Sign in.").
  - **Account creation:** keep Better Auth `disableSignUp: true`. A server action creates, in one transaction, the Client (status `lead`, `planId`, billingStatus `none`, `selfServe: true`), the owner User (role `client_owner`, via the existing credential helper), a WizardDraft, and a ChangeLog entry. Then it signs them in.
  - Send the Better Auth verification email. Checkout does not wait for verification, but **Submit for review is blocked until the email is verified** (show "Confirm your email to submit" with a resend button).
- **Checkout:** after signup, create the Stripe customer and open Checkout with one shared builder, also used by the admin `stripe_checkout` step, so both paths produce the same subscription:
  - line items: the plan's **base monthly price** + the plan's **metered minutes price** (Part 3) + the **one-time setup fee** unless the founding waiver applies;
  - `automatic_tax: { enabled: true }`, billing address required, tax ID collection optional;
  - `client_reference_id` and `metadata.client_id` set;
  - success → `/home?welcome=1`; cancel → `/signup/canceled`, which shows "Your account is saved; finish checkout anytime" plus a button that reopens Checkout.
- **Founding waiver:** applies when `FOUNDING_OFFER.active`, the plan has `foundingWaiver`, and fewer than 10 non-internal clients have `paidAt` set with a waiver plan. Count at checkout creation and record `setupFeeWaived` on the client (the column exists).
- **After payment:**
  - The owner home shows a 3-step welcome checklist: (1) Set up your receptionist (the AI chat), (2) Review and submit, (3) We review and connect your number.
  - The existing interview and wizard pages are reused. Submit puts the client in Daniel's existing review queue. Numbers are provisioned only for paid clients (already true).
  - An unpaid self-serve owner who signs in sees one card, "Finish checkout", and nothing else.
- **Admin:** clients list shows a "Self-serve" pill, and the admin to-do list gains "New self-serve signup awaiting review" once submitted.

## Part 3: Usage metering in Stripe
- **Meter:** one Stripe Billing Meter, `alinstra_minutes` (sum aggregation), created once by a sync script and stored in AppSetting.
- **Prices:** for each plan, a metered price on that meter with **graduated tiers**: the first `includedMinutes` at $0, then `overagePerMinuteCents` per minute, monthly. Store it as `StripePrice` kind `metered_overage`.
- **Price sync:** `ensurePrice` is idempotent by lookup key including amounts. Extend the existing admin "sync prices" path (or add `scripts/stripe-sync.ts`) to create or refresh the meter, base prices, setup prices and metered prices for every active plan, including Solo.
- **Reporting usage:**
  - A worker job `report-usage` runs every 5 min and sends a meter event for each UsageRecord whose client is paid, non-internal, and has `meterReportedAt` null.
  - Each event carries `stripe_customer_id`, `value = billableMinutes` and timestamp = call end, with `identifier = usageRecord.id` (idempotent).
  - Set `meterReportedAt` and `meterEventId` on success.
  - Retry with backoff; after 24 h of failures, send an admin notice.
  - If a reported duration later changes, send a correcting event (Stripe meter event adjustments, or a positive delta only; follow the docs and explain what you chose in BILLING.md).
- **Overrides:** respect per-client overrides (`overrideIncludedMinutes`, `overrideOveragePerMinuteCents`, `overrideMonthlyPriceCents`). If a client has overrides, the checkout builder uses per-client prices (lookup key includes the client id) instead of the plan prices. Document it.

## Part 4: Billing lifecycle, pause/resume, owner billing page
- **Webhooks:** add `invoice.paid` and `customer.subscription.updated`, keeping the existing four.
  - `invoice.payment_failed`: billingStatus `past_due`, set `pastDueSince` (new column) if empty, admin notice (exists), and an owner email: "Your payment didn't go through. Update your card to keep Ava answering." with a link to `/home/billing`.
  - `invoice.paid`: if past_due or paused → billingStatus `paid`, clear `pastDueSince`, resume if paused (ChangeLog + owner email "You're all set").
  - `customer.subscription.updated` with `cancel_at_period_end: true` → `cancel_scheduled` + `serviceEndsAt` (the existing logic path). If the cancel is undone → back to `paid`, clear `serviceEndsAt`.
  - Keep the existing `deleted` handling.
- **Pause:**
  - A daily worker job (09:00 ET) pauses any non-internal client whose `pastDueSince` is more than 7 days old: billingStatus `paused`, ChangeLog, an owner email and an admin notice.
  - While paused, the Retell inbound handler gives a per-call override that says: "Thanks for calling {business}. We can't take your call right now. Please try again later." Then it ends the call. No message is taken; keep it under 15 seconds.
  - The paused state is visible on admin client detail, the admin to-do list, and the owner home banner ("Ava is paused: update your card").
- **Owner `/home/billing` page** (owner only; staff can't see it):
  - Current plan, price, next bill date, status.
  - **This billing period:** minutes used vs included (from UsageRecord, over the Stripe current period start/end stored on the client from subscription events), estimated overage so far, and a progress bar.
  - A "Manage billing" button that opens a **Stripe Customer Portal** session (update card, invoices, cancel at period end).
  - A "Change plan" button: the owner picks a plan, which creates a plan-change request in the admin to-do list. Admin approves:
    - upgrades apply immediately (swap the base + metered prices, prorate the base);
    - downgrades apply at the next renewal.

    Use the existing ChangeRequest pattern if it fits; otherwise a small `PlanChangeRequest` table.
- **`docs/BILLING.md`**, a runbook for Daniel covering:
  - the exact **Stripe dashboard settings** to set in test mode and again in live mode:
    - Customer Portal configuration (allow card update, invoices, cancel at period end; no plan switching);
    - Smart Retries and failed-payment customer emails ON;
    - Stripe Tax on, origin address, and adding registrations once the accountant confirms them;
    - webhook events (the six above);
    - which keys go on which Railway service.
  - how to run price sync;
  - how to go from test to live;
  - how overage appears on invoices.

## Part 5: Reports
- **Owner monthly report:**
  - **Portal page `/home/reports`:** month picker (calendar months in the client's timezone), default last full month.
  - **Cards:**
    - calls answered;
    - after-hours calls (`officeOpen()` false at call start);
    - messages taken;
    - appointment requests (`booked` outcome + messages tagged as appointment requests if that signal exists; otherwise just `booked`, and say so in a tooltip);
    - transfers;
    - minutes used vs plan (calendar month, labeled as such; the billing page is the billing-period view);
    - average call length;
    - flagged calls.
  - **A simple bar chart of calls by weekday × hour** ("Busiest times"), built server-side as an accessible table/SVG, no heavy chart library. Follow the existing UI kit and the design-direction tokens.
  - **Email:** on the 1st of each month at 09:00 in the client's timezone (or a single 09:00 ET run, whichever is simpler; document it), owners with any calls get a short email with the headline numbers and a link to the report page.
    - Counts only: no caller names, numbers or message text in the email.
    - Owners can turn it off in their settings (default on).
    - Internal clients are skipped.
- **Admin business report `/admin/reports`** (admin + 2FA):
  - Month picker; one row per non-internal client, with totals:
    - plan;
    - monthly price (with overrides);
    - minutes used / included;
    - overage minutes and $;
    - Retell cost (sum of `UsageRecord.costCents`);
    - **gross margin $ and %** = (monthly price + overage − Retell cost) / revenue;
    - calls, messages, flagged calls;
    - billing status.
  - Revenue here is an estimate from our own data; label it "Estimated. Stripe invoices are the record."
  - Include the internal client in a separate "Internal (not billed)" row so Daniel sees Alinstra's own line costs.
  - CSV export, formula-safe like the access log export.
- **Data source:** everything is computed from UsageRecord + CallRecord metadata (outcome, flags, startedAt) + ClientMessage counts. Never decrypt content for reports.

## Part 6: Website, copy, Postgres 18, docs
- **Plan buttons:** the plan buttons on Home and `/pricing` link to `/signup?plan=<code>`. Enterprise and the general "Get started"/"Ask about pricing" links go to `/start`. The `/start` page copy becomes "Questions, Enterprise, or not sure which plan? Tell us about your business and we'll get back to you within one business day."
- **Plan-card copy** (update the PLAN_MARKETING static features and `docs/marketing-copy.md`):
  - **Solo:** replace "Set it up yourself with a guided 20-minute chat" with "Guided 20-minute setup chat".
  - **Starter:** replace "Setup done with you by our team" with "Hands-on setup review, plus a setup call if you want one".
  - **Every plan includes** keeps "A person reviews Ava before she goes live".
- **Pricing footnote:** "Billed monthly. Cancel anytime; service runs to the end of your paid month. Sales tax added where required."
- **Postgres 18 everywhere** (Railway runs 18; Daniel set `PG_MAJOR=18` on the worker):
  - Worker Dockerfile default `ARG PG_MAJOR=18`.
  - `docker-compose.yml` uses `postgres:18`, with a **new volume name** so the old 16 data directory is left alone; note this in README.
  - CI service `postgres:18`, and install `postgresql-client-18` from the PGDG apt repo instead of Ubuntu's package.
- **Docs:** `docs/SECURITY.md` data inventory gains UsageRecord (no content; kept for billing, 400 days or longer if accounting requires it, marked "confirm with accountant"). Update `STATUS.md`, `DECISIONS.md` and `docs/marketing-copy.md`.

## Verify before you report
- `pnpm typecheck`, `pnpm lint`, `pnpm turbo run test --force`. Run the tests twice, and report the total across ALL packages.
- The no-DB production build.
- Migrations applied twice locally. Usage backfill: dry run, real run, and a second run showing zero.
- **The full flow against the fake billing platform in an integration test:**
  1. signup;
  2. checkout created with 3 line items, or 2 when the waiver applies;
  3. `checkout.session.completed` → paid;
  4. the interview is reachable;
  5. submit blocked until the email is verified;
  6. a call ends → UsageRecord → meter event reported once;
  7. `invoice.payment_failed` → past_due → 7 days later paused → the inbound handler gives the paused message;
  8. `invoice.paid` → resumed;
  9. cancel at period end → cancel_scheduled.
- **The same flow once by hand against real Stripe test mode**, using test card `4242…`, a decline card, and the Stripe CLI to forward webhooks. Describe what you saw.
- **Screenshots** of `/signup?plan=solo`, the owner `/home` welcome checklist, `/home/billing`, `/home/reports`, `/admin/reports` (1280 wide) and `/signup` at 390.

Report back with:
- branch and commit list;
- total test count;
- new env vars and which Railway service gets them;
- the Stripe dashboard settings Daniel must make (point to BILLING.md);
- the price-sync command;
- anything you couldn't do in test mode.

Don't merge; Claudia reviews first.
