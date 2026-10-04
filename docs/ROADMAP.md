# Roadmap

Written 4 October 2026 after Phase 4. Nothing below is implemented. Each phase gets its own plan document before work starts, following the pattern of `docs/phase-3-plan.md`.

## Where things stand

- Phases 0–3 shipped the platform, the admin wizard, the receptionist prompt, provisioning on Retell and Stripe, and the owner portal.
- Phase 4 fixed what the first live call exposed: Ava only speaks public contact details, admins edit a submitted client step by step, call timing is per client, provisioning shows its state plainly and asks before buying a number, the admin has a Services page, and the voice map lives in one file.
- Phase 4b stores call transcripts and recordings encrypted at rest with per-client retention, role-based access (owner grants staff), playback through our own route, and calls screens in the admin and the portal. The structured `transcriptTurns` (roles, offsets, tool invocations) are the input Phase 8 builds on.

## Phase 5: owner self-service and the client's own number

Goal: the owner can do for their own business what the admin does on the client page, with holds where a change could hurt.

- **Owner-portal edit flow.** Reuse the Phase 4 admin edit flow (`clientEditPayload` / `editClientStep`) behind the owner's `TenantContext`. The owner sees the same step list on My Business. Each step saves to the client and writes an `owner_edit` ChangeLog with the redacted diff.
- **Review holds.** Steps that change what Ava says (greeting, voice, knowledge, coverage, features) go into the existing held-update queue instead of publishing directly when the text trips `sensitiveHoldReason`, or when the owner changes the voice, transfer targets, or booking mode. The admin approves from the home page as today. Safe changes publish and enqueue a sync, the same as the admin path.
- **Plan and billing steps stay admin-only.** Owners see the plan but cannot change it; the page points them to email.
- **Client using their own number.** Surface the carrier-forwarding copy drafted in `docs/DEPLOYMENT.md` ("Client using their own number") on the owner portal, keyed off wizard step 8 `phone.mode = "own_number"`. Show the Alinstra number to forward to, with a copy button and a "test it" checklist. No app-side forwarding; the carrier does it.
- **Toll-free verification for SMS.** Only if texts ship in this phase. Buying the number for voice does not need it.
- **Owner-visible call log.** Shipped in Phase 4b as the portal Calls pages (list, detail, transcript, recording). Phase 5 only needs to surface them from My Business.

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
