# Phase 5

Status: shipped on branch `phase-5` (not yet merged to `main`). Owner self-service, own-number forwarding UI, and a greeting dead-air fix. No new env vars. No Stripe changes. Toll-free SMS verification is deferred (no SMS in this phase).

## Spec source

`docs/ROADMAP.md` § "Phase 5: owner self-service and the client's own number", plus the live-call greeting issue (Oct 4: Ava paused after the recording notice before the after-hours line).

## Decisions (this plan)

1. **Owner reuses the admin edit path.** `clientEditPayload` / `editClientStep` accept `client_owner` (scoped to their `clientId`). ChangeLog action is `owner_edit` with the same redacted diff shape as `admin_edit`. WizardForm is parameterized (`mode="edit"`, `audience="admin"|"owner"`), not forked.
2. **Plan (step 3) and Compliance (step 9) stay closed to the owner.** The My Business step list shows them read-only with "Email support@alinstra.com to change this." Call retention stays editable via a small control on My Business that calls the existing `setCallRetention` (Phase 4b).
3. **Owner holds reuse `QuickUpdate`.** Risky owner step edits create a held `QuickUpdate` (new kind `owner_edit`) instead of publishing. Admin approves/rejects from the existing home / client changes UI. Approval applies the step through `editClientStep`-equivalent apply and syncs; rejection stores a reason the owner sees. Existing QuickUpdateForms (hours, closure, staff, FAQ, transfers) keep their current path — hours etc. still publish directly unless `sensitiveHoldReason` trips.
4. **Hold triggers for owner step edits:** text trips `sensitiveHoldReason`, OR voice changes, OR transfer targets change, OR booking mode changes. Greeting / knowledge / coverage / features edits hold only when the hold rules above fire (or when those fields include voice/transfers/booking). Safe owner edits (business contact, website notes, phone setup without transfer changes, portal email is admin-only so N/A) publish and sync directly.
5. **Own-number mode is `phone.mode === "forward"`** in the wizard schema (ROADMAP said `own_number`; the code has always used `forward`). The forwarding page keys off that value. No app-side forwarding setup.
6. **Greeting becomes one opening utterance.** `buildGreeting` / prompt assembly concatenates greeting + recording notice + (when closed) after-hours line into a single spoken opening ending in "How can I help?" (or the closed-hours offer). New guardrail: never pause for the caller mid-greeting. `TEMPLATE_VERSION` → `"7"`.

## Parts

| Part | Commit theme |
|------|----------------|
| 1 | Owner edit flow on `/home/business` + `/home/business/edit/[step]` |
| 2 | Review holds for risky owner step edits |
| 3 | `/home/business/forwarding` (carrier copy, Alinstra number, test checklist) |
| 4 | Continuous greeting + template v7 |
| 5 | Recent calls card on My Business |
| 6 | DEPLOYMENT + ROADMAP docs |

## Tests required

- Owner edit writes `owner_edit` ChangeLog; staff action is refused.
- Hold triggered on voice change; direct publish on a safe hours / business edit.
- Forwarding page gated by `phone.mode`.
- Greeting snapshot for open and closed hours.
- Tenant check: owner cannot edit another client.

## Out of scope

- SMS / toll-free verification.
- Owner changing plan, Stripe, or healthcare compliance flags.
- App-side carrier forwarding setup.
