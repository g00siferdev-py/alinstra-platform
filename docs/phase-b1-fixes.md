Phase B.1: review fixes before merge

Work on the existing `phase-b-billing` branch. Add new commits on top of `574ae1d`; don't rebase or squash. Commit this file (`docs/phase-b1-fixes.md`) with them.

Claudia's review of `574ae1d`:
- 463 tests pass across all packages, twice. Typecheck and lint are clean.
- She ran the signup flow in a browser against the fake billing platform and checked the owner home, billing and reports pages.
- The structure is solid: the UsageRecord ledger, meter reporting with idempotent identifiers, the graduated metered prices, the webhook lifecycle, pause/resume, the reports and the access control. Don't restructure them.

Fix the items below.

## 1. Signup doesn't actually sign the user in (confirmed in a browser)
After `/signup` succeeds there's **no session cookie**. `auth.api.signInEmail` in a server action can't set cookies without Better Auth's Next.js cookie plugin, so Stripe's success URL `/home?welcome=1` bounces the new customer to `/login`.
- Add `nextCookies()` from `better-auth/next-js` as the **last** entry in the `plugins` array in `packages/auth/src/auth.ts`. Check the installed better-auth 1.7.x docs in `node_modules` for the exact import.
- Check it doesn't break the existing login, 2FA or invite flows (their tests must pass).
- Add a test (or a Playwright-free integration check) showing the signup action sets the session cookie. Then confirm by hand: sign up locally → land on the checkout URL → open `/home` without logging in.

## 2. Checkout parameters for Stripe Tax with an existing customer
We create the Customer before Checkout, so per Stripe's docs (`docs.stripe.com/tax/checkout/page`, "Calculate tax for existing customers", and `docs.stripe.com/tax/checkout/tax-ids`):
- Add `customer_update[address]=auto`. Checkout then saves the billing address it collects onto the Customer and Stripe Tax uses it. Without it, Checkout uses the Customer's saved address, and ours have none.
- Add `customer_update[name]=auto`, so invoices carry the business name the customer enters.
- **Remove** `tax_id_collection`. Our customers are US businesses, and the US isn't in Stripe's tax-ID collection list, so it adds nothing.
- Update the fake billing platform and tests to assert these fields. Note them in `docs/BILLING.md`.

## 3. The paused-call override uses fields Retell doesn't accept
Retell's inbound webhook `agent_override.retell_llm` supports keys like `begin_message`, `model`, `start_speaker`, `begin_after_user_silence_ms`, `knowledge_base_ids`. It does **not** support `general_prompt` or `general_tools`. `agent` supports `max_call_duration_ms`, `end_call_after_silence_ms` and the voice settings (`docs.retellai.com/features/inbound-call-webhook`).
- For paused clients, send only:
  - `retell_llm.begin_message` (same text);
  - `agent.max_call_duration_ms: 12000`;
  - `agent.end_call_after_silence_ms: 3000`.

  The call ends on its own a few seconds after the message. Drop `general_prompt` and `general_tools`.
- Update the tests. In `docs/BILLING.md`, add a note on how to test this on staging: temporarily set a test client to paused and call its number.

## 4. Old usage blocks the meter queue
Stripe rejects meter events whose timestamp is more than 35 days old. `reportUsageToStripe` takes the 400 oldest unreported rows first, so any row Stripe rejects for age (from the backfill, or a long-paused client) would fail every 5 minutes forever and **starve every newer row behind it**.
- Add `meterSkippedAt` and `meterSkipReason` to UsageRecord (one migration). Before reporting, mark these rows skipped and exclude them from both queries:
  - `endedAt` older than 34 days → reason `too_old`;
  - `endedAt` before the client's `paidAt` → reason `before_paid` (Stripe wouldn't bill it anyway).
- Rows that fail for other reasons must not block later rows. Make sure ordering and `take` can't starve (e.g. skip rows whose `meterReportFailedAt` is under 15 minutes old, so others get a turn).
- Tests: a too-old row is skipped and a newer row still reports; a repeatedly failing row doesn't block the next one.

## 5. Billing period is unknown until the first renewal
`checkout.session.completed` doesn't record `stripeCurrentPeriodStart` / `stripeCurrentPeriodEnd`, and `customer.subscription.created` isn't handled. So the owner Billing page and plan-change timing have no real period during the first month (the page falls back to the calendar month).
- Handle `customer.subscription.created` with the same period/status logic as `updated`. Add it to the webhook events list in `BILLING.md` (seven events now).
- On `checkout.session.completed`, if the period is still empty, fetch the subscription once (`GET /v1/subscriptions/{id}`) through `BillingPlatform` and store the bounds. Add the method to the fake platform.

## 6. Owner portal polish
- An **unpaid** self-serve owner sees only Home with the "Finish checkout" card (as the plan said). Hide the other nav tabs until the client is paid, and redirect direct visits to those pages back to `/home`.
- The "Your receptionist" card shows a green **Ready** pill before anything is set up. Until the client is live, show the real state: "Not set up yet" (draft not submitted), "In review" (submitted, waiting for Daniel) or "Connecting your number" (approved, provisioning). Show "Live" only when live.
- If the owner's email isn't verified, show a slim banner on `/home`: "Confirm your email to submit your setup" with the resend button. Today it's only on the review step.

## 7. Don't show raw errors to visitors
`signupAction` returns `error.message` for unexpected errors, which can expose Stripe or database text. Keep the friendly validation messages, but for anything unexpected return "Something went wrong creating your account. Try again, or email hello@alinstra.com." and log the error name with the client id (no email).

## Verify
- `pnpm typecheck`, `pnpm lint`, `pnpm turbo run test --force`. Run the tests twice, and report the total across all packages.
- The no-DB production build.
- **By hand, locally (fake billing):**
  1. sign up;
  2. checkout URL;
  3. `/home` loads without logging in and shows only Home + Finish checkout;
  4. mark the client paid in the DB;
  5. `/home` shows the welcome checklist, the email-confirm banner and the correct receptionist state.

Report: commit hashes and total test count. Push the branch. Don't merge; Claudia gives the go-ahead.
