# Roadmap

Updated 4 October 2026 after Phase 5b-i. Phases below Phase 6 are not yet implemented. Each phase gets its own plan document before work starts, following the pattern of `docs/phase-3-plan.md`.

## Where things stand

- Phases 0–3 shipped the platform, the admin wizard, the receptionist prompt, provisioning on Retell and Stripe, and the owner portal.
- Phase 4 fixed what the first live call exposed: Ava only speaks public contact details, admins edit a submitted client step by step, call timing is per client, provisioning shows its state plainly and asks before buying a number, the admin has a Services page, and the voice map lives in one file.
- Phase 4b stores call transcripts and recordings encrypted at rest with per-client retention, role-based access (owner grants staff), playback through our own route, and calls screens in the admin and the portal. The structured `transcriptTurns` (roles, offsets, tool invocations) are the input Phase 8 builds on.
- Phase 4c hardens recording-job enqueue (rollback + stale-pending sweep) and strengthens Ava's `end_call` prompt so she hangs up after goodbye instead of waiting on the caller.
- **Phase 5 shipped** (branch `phase-5`, plan `docs/phase-5-plan.md`): owner edit flow on My Business with `owner_edit` ChangeLog; held `owner_step` QuickUpdates for voice / transfer / booking / sensitive text; own-number forwarding page (`phone.mode = "forward"`); continuous greeting opening (template v7) with inbound `begin_message` override; recent calls card on My Business. **Toll-free SMS verification is deferred** to a later phase (no SMS in Phase 5).
- **Phase M shipped** (branch `phase-m`, plan `docs/phase-m-plan.md`): public marketing site at `/` from `docs/marketing-copy.md`, live pricing from `publicPlans()`, lead form + `Lead` model + `/admin/leads`, `publicSiteConfig` / optional `MARKETING_PHONE`, SEO sitemap/robots, apex DNS cutover notes.
- **Phase 5b-i shipped** (branch `phase-5b-interview`, plan `docs/phase-5b-interview-plan.md`): chat-style AI onboarding interview that fills `WizardDraft` via an OpenAI-compatible text provider; industry banks (general / HVAC / vet); admin settings + sessions. A voice-call version of the interview is a later idea, not in this phase.

## Phase M: marketing site (shipped)

Shipped. Details in `docs/phase-m-plan.md` and `docs/DEPLOYMENT.md` ("Shipped in Phase M"). Summary:

- Marketing route group with Home, Pricing, Industries, About, Start, Legal; portal layouts keep `AppHeader`.
- Pricing table from the Plan catalog; founding-offer and add-on copy verbatim.
- `/start` lead capture (honeypot + rate limit); admin notice only; no auto-reply.
- Quiet modern design, Waveform A mark, ISR for static pages, canonical `https://alinstra.com`.

## Phase 5: owner self-service and the client's own number (shipped)

Shipped. Details in `docs/phase-5-plan.md` and `docs/DEPLOYMENT.md` ("Shipped in Phase 5"). Summary of what landed:

- **Owner-portal edit flow.** Reuses `clientEditPayload` / `editClientStep` behind the owner's `TenantContext`. Step list on My Business; Plan and Compliance are read-only (email support). Retention stays editable separately.
- **Review holds.** Risky owner step edits create held `owner_step` QuickUpdates; admin approves/rejects from home; rejection reason is visible to the owner. QuickUpdateForms (hours, notices, staff, FAQ) still publish directly.
- **Own-number forwarding.** `/home/business/forwarding` when `phone.mode = "forward"` (schema name; ROADMAP historically said `own_number`).
- **Greeting dead-air fix.** Template version 7; one continuous opening; inbound webhook overrides `begin_message` for open vs closed.
- **Recent calls** card on My Business for owner and granted staff.

## Phase 5b-i: interview wizard (shipped)

Shipped. Details in `docs/phase-5b-interview-plan.md` and `docs/DEPLOYMENT.md` ("Shipped in Phase 5b-i"). Summary:

- Server-side `TextPlatform` (`httpText`) against any OpenAI-compatible chat API; feature off without `TEXT_API_KEY`.
- Pure interview engine + question banks as data; merge into existing wizard payload; admin/owner chat UI; `/admin/interview` settings.
- **Later idea (not shipped):** a voice-call version of the same interview.

## Phase 6: admin dashboard and client reports

Goal: the admin answers "how is each client doing" without opening Stripe or Retell.

- **Admin dashboard** at `/admin`: all live clients, each with last payment date and amount, calls and minutes this month, minutes left on the plan, sync state, and any failed provisioning run.
- **Per-client report** on the client page:
  - last payment (date, amount, Stripe invoice link)
  - total calls and minutes since live; calls and minutes this calendar month in the client's timezone
  - average call length
  - voice in use (display name from the voice map)
  - bookings taken and messages taken, by month
  - overage minutes and the amount billed
- **CSV export** of the per-client call and message rows for a date range. Server-side generation, downloaded through an authenticated route, never a public URL.
- **Client-facing monthly summary email** to the owner on the first of the month: calls, minutes used of included, messages, bookings, and a link to the portal. Sent from the worker on a schedule; rendered from the same numbers as the admin report so the two never disagree.
- **Data needed.** `CallRecord` stores duration, end reason, outcome, sentiment, and cost, indexed by `(clientId, startedAt)` since Phase 4b; add a `minutesBilled` column written when the Retell webhook closes a call. Bookings come from the booking tool once it exists; until then the report shows messages only.

## Phase 8: nightly call review agent

(Phase 7 is not planned here yet; the number is reserved so later documents can refer to this one.)

Goal: find bad calls before the client does.

- A worker job runs nightly per live client, reads the structured `CallRecord.transcriptTurns` (roles, offsets, tool invocations and results) plus outcome and sentiment for the previous day, and flags calls where Ava stalled, mis-transferred, failed to take a message, or contradicted the knowledge base.
- For each flag it proposes a concrete change: a prompt line, a knowledge edit, or a transfer-target fix, written into the held-update queue for the admin to approve. Nothing publishes on its own.
- Keep `transcriptTurns` structured (never collapse to plain text) so the reviewer can reason about tool calls and timing, not just words. Reads happen through the same decrypt-at-read path as the call page and respect each client's retention: purged calls are never reviewed.

## Later

- Healthcare tier (`docs/future-healthcare-tier.md`).
- Direct-calendar booking (`bookingMode = "direct_calendar"`) with a calendar provider.
- Production project on Railway (`docs/DEPLOYMENT.md`, "Production later").
