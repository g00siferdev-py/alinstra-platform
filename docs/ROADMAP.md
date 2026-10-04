# Roadmap

Written 4 October 2026 after Phase 4. Nothing below is implemented. Each phase gets its own plan document before work starts, following the pattern of `docs/phase-3-plan.md`.

## Where things stand

- Phases 0–3 shipped the platform, the admin wizard, the receptionist prompt, provisioning on Retell and Stripe, and the owner portal.
- Phase 4 fixed what the first live call exposed: Ava only speaks public contact details, admins edit a submitted client step by step, call timing is per client, provisioning shows its state plainly and asks before buying a number, the admin has a Services page, and the voice map lives in one file.

## Phase 5: owner self-service and the client's own number

Goal: the owner can do for their own business what the admin does on the client page, with holds where a change could hurt.

- **Owner-portal edit flow.** Reuse the Phase 4 admin edit flow (`clientEditPayload` / `editClientStep`) behind the owner's `TenantContext`. The owner sees the same step list on My Business. Each step saves to the client and writes an `owner_edit` ChangeLog with the redacted diff.
- **Review holds.** Steps that change what Ava says (greeting, voice, knowledge, coverage, features) go into the existing held-update queue instead of publishing directly when the text trips `sensitiveHoldReason`, or when the owner changes the voice, transfer targets, or booking mode. The admin approves from the home page as today. Safe changes publish and enqueue a sync, the same as the admin path.
- **Plan and billing steps stay admin-only.** Owners see the plan but cannot change it; the page points them to email.
- **Client using their own number.** Surface the carrier-forwarding copy drafted in `docs/DEPLOYMENT.md` ("Client using their own number") on the owner portal, keyed off wizard step 8 `phone.mode = "own_number"`. Show the Alinstra number to forward to, with a copy button and a "test it" checklist. No app-side forwarding; the carrier does it.
- **Toll-free verification for SMS.** Only if texts ship in this phase. Buying the number for voice does not need it.
- **Owner-visible call log.** Caller (masked as today), duration, end reason, local time. Read-only.

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
- **Data needed.** `CallRecord` already stores duration and end reason; add `startedAt` indexing by client and month, and a `minutesBilled` column written when the Retell webhook closes a call. Bookings come from the booking tool once it exists; until then the report shows messages only.

## Later

- Healthcare tier (`docs/future-healthcare-tier.md`).
- Direct-calendar booking (`bookingMode = "direct_calendar"`) with a calendar provider.
- Production project on Railway (`docs/DEPLOYMENT.md`, "Production later").
