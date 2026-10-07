# Phase B.2: billing polish from the first real test

**Start this after Phase I.1 is merged.** Branch `phase-b2` off the `main` that includes I.1. Don't merge; Claudia reviews first.

## 0. Why

On Oct 6, Daniel ran the full self-serve flow on staging with Stripe test mode. What worked:
- signup → Checkout → $99 + $99 setup + Tennessee tax (Knoxville 9.25%: $18.32, total **$216.32**) → `paid` through the webhook;
- the setup chat → submit → admin review;
- all webhook deliveries returned 200.

These things need fixing:

1. **Stripe's end-of-retries setting.** Daniel set "If all retries for a payment fail" to **Mark the subscription as unpaid** (retries: Smart Retries, 8 tries within 2 weeks). We don't handle `status: "unpaid"` explicitly, and Stripe keeps creating **draft** invoices while a subscription is unpaid. BILLING.md doesn't mention this setting.
2. **Tax settings live only in the dashboard.** Our prices have no `tax_behavior` and our products have no `tax_code`, so they depend on account defaults. Daniel set those defaults by hand in test mode, and live mode would silently differ.
3. **Invoices show the person, not the business.** We create the Customer with `name = client.name` ("Test Account"). Checkout then sends `customer_update[name]=auto`, which overwrote it with the cardholder name ("Daniel Greene"). We don't collect tax IDs, so only `customer_update[address]` is needed.
4. **Checkout offers Klarna, Cash App, Amazon Pay and Link.** These come from the dashboard's dynamic payment methods. "Pay later" and wallet methods don't fit a monthly business subscription with retries and failed-payment pauses.
5. **/signup while already signed in** quietly switches the browser to the new owner's session. Daniel hit this while signed in as admin.
6. **The admin client page for a self-serve client** shows "Send portal invite" (they already have a login) and the status **lead** for a paying customer.
7. **"Start provisioning" spends real money on staging.** Retell has no test mode, so one click buys a real phone number. There's nothing to stop a test client from being provisioned by accident.

## 1. Stripe "unpaid"

- `customer.subscription.updated` with `status === "unpaid"`:
  - If the client isn't already `paused`, set `billingStatus = "paused"` (keep `pastDueSince`).
  - Write a ChangeLog entry `billing.unpaid`.
  - Send an admin notice: "Stripe stopped retrying for <client>; Ava stays paused until they pay."
  - Never cancel or archive.
- **Draft invoices while unpaid.** When `invoice.paid` resumes a client that was `paused`, list the subscription's invoices with `status=draft` and void any whose `created` is after `pastDueSince`. Log each id in the ChangeLog `after`. The rule: **no charge for months when Ava was paused.**
  - Add `listInvoices({ subscriptionId, status })` and `voidInvoice(id)` to the billing provider, plus their memory fakes.
- `customer.subscription.updated` → `active` while `paused` or `past_due` (for example after a manual dashboard fix): treat it the same as `invoice.paid` resume, without double-emailing (check the current status first).
- **BILLING.md:**
  - Add the Retries settings (Smart Retries 8 tries / 2 weeks; **If all retries fail → Mark the subscription as unpaid**) to §1, with one line saying why: cancel would end service behind our back, and past-due would keep charging a paused business.
  - Update the §5 table with the unpaid and draft-void rows.

## 2. Tax settings in code

- `stripe-sync`:
  - Create or update each catalog product with `tax_code` set to the new constant `STRIPE_PRODUCT_TAX_CODE = "txcd_10103001"` (Software as a service (SaaS) - business use).
  - Comment: `// Confirm with the accountant before live; Stripe's exact name: "Software as a service (SaaS) - business use".`
  - Create every new price with `tax_behavior: "exclusive"`.
  - For existing prices whose `tax_behavior` is `unspecified`, update them to `exclusive`. Stripe allows that once. Skip any that are already set, and log a count.
- BILLING.md §2: note that sync now owns `tax_code` and `tax_behavior`, so the dashboard defaults are only a backstop.

## 3. Checkout

- Remove `customer_update[name]=auto`. Keep `customer_update[address]=auto`.
  - Update the comment and BILLING.md: the address is what Tax needs, and the Customer name stays the business name for invoices.
- Send `payment_method_types[0]=card` and `payment_method_types[1]=link`, so cards only, with Link as a saved-card wallet.
  - Put this behind one constant, `CHECKOUT_PAYMENT_METHOD_TYPES`, so Daniel can widen it later.
- Test: the request body has no `customer_update[name]`, still has `customer_update[address]=auto`, and has the two payment method types.

## 4. /signup when signed in

- `signup/page.tsx`: if there's a session, don't render the form. Render one card instead:
  - "You're signed in as <email>."
  - For owners: a primary "Go to your dashboard" → `/home`. For admins: "Go to admin" → `/admin`.
  - A secondary "Sign out and create a new account", which signs out and returns to the same `/signup?plan=…` URL.
- `signupAction`: if a session exists, return `{ ok: false, error: "You're already signed in. Sign out first to create a new account." }` before creating anything.
- Tests for both.

## 5. Admin client page for self-serve clients

- Hide **Send portal invite** when the client has a `client_owner` user (a self-serve signup). Keep it for admin-created clients.
- **Display-only** status label, everywhere we show client status (the client page header and the `/admin/clients` list). Don't change the DB enum.
  - `status === "lead"`, `billingStatus === "paid"` and `wizardSubmittedAt` set → **"Awaiting your review"**, using the warning-soft pill.
  - `lead` and paid without a submitted wizard → **"Paid · setting up"**.
  - Everything else is unchanged.
- Sort the `/admin/clients` list so "Awaiting your review" clients come first.

## 6. Provisioning confirm step

- **Start provisioning** becomes two steps on the same button area:
  1. The first click shows an inline confirm row: "This creates a live Retell agent and **buys a real phone number** on Alinstra's Retell account (about $2/month). Continue?" with **Buy number and provision** (danger-styled) and **Cancel**.
  2. Only the second button calls the action.

  Don't use `window.confirm`.
- When `APP_ENV !== "production"`, add one more line in that row: "This is staging. Only provision a test client on purpose."
- Tests: the first click doesn't call the action; confirm does.

## 6b. Polish carried over from the Phase I.1 review
- **Transfer phone field:**
  - Show "That isn't a full US or Canada phone number" only after the field has been touched (blurred) or on submit, not on an empty new row.
  - Give the input `type="tel"` and `inputMode="tel"` so phones show the number pad.
- **Weekly hours editor on phones (390 px):** keep each day on one line as `[✓] Monday  [8:00 am] – [5:00 pm]`. Today the closing select wraps under the row. Add a visually hidden "Closes" label so screen readers name both selects.
- **Owner step 5 booking mode:** owners must not be offered "Direct to calendar" (calendar booking doesn't exist yet). For `audience="owner"`, replace the dropdown with the plain line "Appointment requests: Ava takes them and emails them to you to confirm." and keep `bookingMode = request_only`. Admins keep the dropdown.
- Tests for each.

## 7. Verify before you report

1. `pnpm typecheck`, `pnpm lint`, `pnpm test` (twice).
2. The no-DB production build.
3. Screenshots at 1280:
   - `/signup?plan=solo` while signed in;
   - the admin client page for a paid self-serve client (no invite button, "Awaiting your review");
   - the provisioning confirm row.
4. Push the branch and confirm **GitHub CI is green on all three jobs**. Include the run result.
5. Report: branch, commit, test count, CI result, screenshots, and anything you couldn't do. Daniel will re-run `stripe:sync` on staging after merge, and the report should remind him.
