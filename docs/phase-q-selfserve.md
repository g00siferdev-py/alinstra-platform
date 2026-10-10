# Phase Q: self-serve go-live + Solo at $49

Please start by merging Phase P, then build this on a new branch. Thank you.

## Q.0 Merge Phase P first

`phase-p` at `020722b` (Phase P + the LAUNCH_STATE hotfix) is approved. CI is green and Claudia re-ran the suite (527 tests) and the no-database production build.

1. Fast-forward `main` and `staging` to `020722b`. Push both. Confirm CI is green on both and report the run links.
2. Create branch `phase-q` from `main`. Push it when done; do not merge.

## Why

Daniel is getting married Oct 21 and wants to launch before then. Self-serve is the main revenue path, and today every paid signup stops at "Awaiting your review" until Daniel activates the config, starts provisioning, and approves the number purchase by hand. That doesn't scale and would stall signups during the wedding. New rule: **a paid customer who finishes the setup interview goes live automatically**, unless an automated check says a human should look first. Daniel stays available to help, but he is not a gate.

Separately, the Solo plan becomes $49/month + $49 setup with 100 included minutes and 75¢ overage, as the standard price.

Honesty rules still apply everywhere: email only (never "text"), calendar booking "once connected", no "Most popular", no "coming soon"/"launching" wording, fictional names and 555 numbers in illustrations.

---

## Q.1 Solo pricing

- `PLAN_SEEDS` Solo: `monthlyPriceCents: 4900`, `setupFeeCents: 4900`, `includedMinutes: 100`, `overagePerMinuteCents: 75`. Other plans unchanged. (75¢ is deliberate: it makes upgrading to Starter worthwhile at about 300 minutes a month.) Wherever the site or portal shows Solo's overage rate, it must read 75¢.
- Make sure the **existing** Solo row in each database gets the new values (staging has it already). If `db:seed` only inserts, add an idempotent data migration that updates the `solo` row. Existing plan rows for other plans must not change.
- `stripe:sync`: lookup keys include amounts, so new Solo prices are created. Leave old prices alone (no live subscribers). Confirm sync is still idempotent on a second run.
- Marketing: anything computed from the cheapest plan updates by itself ("Plans start at $49", typical-calls line for 100 minutes). Grep for hard-coded `$99`, `99`, `150 minutes`, and "Solo keeps its $99 setup" across `apps/web` and `docs/` and fix them. Founding-offer copy: "Solo keeps its $49 setup."
- `docs/marketing-copy.md` pricing table and founding line updated.
- Tests that assert Solo amounts updated.

## Q.2 Automatic go-live

### Setting
- Add an admin setting **Auto go-live** (DB-backed, on the admin Services/Settings page, change recorded in the audit log). Default **off** in every environment; Daniel turns it on in production.
- **Test-mode guard:** never auto-provision a client whose payment came from Stripe test mode (`livemode: false` on the paid checkout/invoice) unless env `AUTO_GO_LIVE_ALLOW_TEST=1` is set. Retell has no test mode; staging must never buy numbers by accident.

### Trigger
When a **self-serve** owner submits the setup interview (`submitWizard`, owner actor) on a client whose subscription is paid, enqueue a worker job `auto-go-live` with the client id (idempotent by client id: a second enqueue or a retried job must never start a second provisioning run or buy a second number).

### Checks (all must pass; any failure → hold)
1. Auto go-live setting is on.
2. Paid: checkout completed and the subscription is active (not past due, not canceled). Live mode, per the guard above.
3. Not internal, not healthcare (the existing rule), not churned.
4. Owner email verified (already required to submit).
5. Complete: business name, timezone, hours, and at least one service or FAQ answer present. If live transfer is on, at least one valid transfer target (already validated at submit; check again).
6. **Content screen:** one call to the configured text model (same `TextPlatform` as the interview; small token budget) with the business name, description, services, and FAQ answers. It returns JSON `{ "ok": boolean, "reason": string }`. Hold when the business is: human healthcare or anything needing patient health information; debt collection or bail bonds; adult content; gambling; cannabis or firearms sales; political campaigns; telemarketing or lead resale; or when the setup asks Ava to collect card numbers, bank details, or Social Security numbers; or anything plainly illegal. **Fail closed:** model error, timeout, or unparseable output → hold with reason "content check unavailable".
7. **Daily cap:** at most `AUTO_GO_LIVE_DAILY_CAP` auto go-lives per rolling 24 h (env, default 15). Over the cap → hold with reason "daily cap reached". This guards the Retell bill against a runaway.
8. **Duplicate:** another non-churned client with the same owner email or mobile number → hold.

### Pass
As a system admin actor (`system:auto-go-live`, shown in the audit log): activate the draft receptionist config, start provisioning with `numberApproved: true`, and advance provisioning in the job. Retry failed steps with backoff (3 attempts). On success:
- Client status → live.
- **Owner welcome email** (Q.3 content).
- **Daniel notification email** to `ADMIN_EMAIL`: "<Business> went live automatically", plan, number, link to the client page, and the check results.

On a provisioning failure after retries, keep the existing failure email to Daniel, and show the owner the held message below.

### Hold
- Client gets a new status `held_for_review` with the reason(s) stored.
- **Owner sees** (portal home + one email): "We're doing a quick check on your setup before Ava starts answering. You'll hear from us within one business day. Questions? Reply to this email." No reason shown to the owner.
- **Daniel gets** an email with the reason(s) and a link.
- Admin client page: **Approve and go live** runs the same pass path (skipping only the check that held it, and the cap), and **Decline** keeps the current admin flow for refunds/cancel. Both recorded in the audit log.
- The old manual path (activate → provision → approve number) stays available to admins.

### Admin views
- Clients list: filter chips **Held for review** and **Auto go-live (last 7 days)**. The B.2 "Awaiting your review" view becomes "Held for review".
- Client page: a small card listing each check with pass/hold and the reason.
- **Pause Ava / Resume** button for admins on any live client (reuse the non-payment pause mechanism; reason "paused by admin"). Recorded in the audit log.

## Q.3 Owner first run

When a client goes live, the owner portal home shows an **"Ava is live"** card, and the welcome email carries the same content:
- Ava's phone number, large, with a **Call Ava now** (`tel:`) button so they hear her first.
- **Two ways to use her**:
  - *Keep your number:* set up conditional call forwarding with your carrier so unanswered or busy calls go to Ava's number. Use generic steps plus links to the forwarding help pages of AT&T, Verizon, T-Mobile, and Google Voice. **Do not invent star codes**; only include a code if it is quoted from the carrier's own page, with the link.
  - *Use Ava's number as your business line:* put it on the truck, the cards, Google Business Profile.
- "Need a hand? Reply to this email or call (toll-free number)." (from `publicSiteConfig`)
- Rename the interview's final button from "Submit" to **"Launch Ava"**. Under it: "Ava starts answering within a few minutes. You can change anything later from your dashboard." Keep the existing disclaimer under the interview.

## Q.4 Docs

- `docs/PRODUCTION-SETUP.md`: new step after the smoke test: "Turn on Auto go-live in Admin → Settings once Stripe is live." Mention `AUTO_GO_LIVE_DAILY_CAP` in the variables table (optional, default 15) and that `AUTO_GO_LIVE_ALLOW_TEST` must never be set in production.
- `docs/BILLING.md` / `docs/SECURITY.md`: one paragraph each on the automatic path, the content screen (what the model sees, that it fails closed), and the audit actor.

## Tests

Fake text model, `MemoryBilling`, fake Retell:
- Pass path: paid live-mode client → one provisioning run, one number, status live, two emails.
- Idempotency: job enqueued twice / retried → still one run, one number.
- Holds: setting off; test-mode payment without the env flag; healthcare; unverified email; incomplete; content model says not ok; content model throws (fail closed); cap reached; duplicate owner.
- Approve-from-hold → live; Decline → no provisioning.
- Admin pause/resume.
- Solo seed values, Stripe sync idempotency with the new amounts, marketing pages show $49.
- The launch-state banned-phrase test still passes.

## Verify before you push

`pnpm test --force` twice, typecheck, lint, the no-database production build, `pnpm audit`, gitleaks. Screenshots in `docs/screenshots/phase-q/`: pricing (Solo $49), interview final step ("Launch Ava"), owner "Ava is live" card, owner held message, admin Held-for-review list, admin client check card. Report branch, SHA, CI links, test counts, and any deviations with reasons.

Do not touch: the encryption layer, retention, `packages/providers/retell` internals (call them, don't change them), or other plans' prices.
