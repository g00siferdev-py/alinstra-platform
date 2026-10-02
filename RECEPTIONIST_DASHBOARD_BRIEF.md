# Project Brief: Alinstra Technologies — Receptionist Platform

> The operations platform for Alinstra Technologies, which sets up and maintains AI voice receptionists for small businesses. One web app at `app.alinstra.com` serves both the admin (Daniel) and client businesses, with role-based access. The centerpiece is an "Add New Client" wizard that provisions everything automatically.

This document is the source of truth for the project. Read it fully before writing code, and re-read the relevant section before starting each phase.

---

## 1. The Business

Alinstra Technologies sets up and maintains AI receptionists for small businesses (e.g., HVAC, repair services, veterinary clinics, salons, pest control, service offices).

**Positioning: a backup receptionist, not a replacement.** The assistant handles calls the front desk can't: calls not answered within a few rings, lunch breaks, after hours, weekends, and calls that would otherwise wait on hold. It answers questions, takes messages, books appointments, sends text confirmations and reminders, and transfers urgent calls to staff.

**Recall add-on:** the assistant texts and calls customers who are due for service (annual vaccines, seasonal HVAC tune-ups, etc.) and books appointments. Priced as a monthly fee plus a fee per booked appointment.

**Pricing (initial, editable in the dashboard):**

| | Starter | Professional | Premium |
| --- | --- | --- | --- |
| Monthly | $199 | $399 | $699 |
| Included minutes | 300 | 1,000 | 2,500 |
| Overage | $0.35/min | $0.30/min | $0.25/min |
| Setup fee | $299 | $499 | $799 |
| Included configuration changes / month | 1 | 2 | Unlimited |

Recall add-on: $25/month + $6 per booked appointment. Text confirmations and reminders are included on all plans. Extra configuration changes beyond the allowance: flat fee (configurable).

## 2. Domains & Hosting

- `alinstra.com` — public marketing site (separate from this app for now; may move later)
- `app.alinstra.com` — this application (admin + client portal)
- `staging.alinstra.com` — staging environment
- Email sent from the `alinstra.com` domain (e.g., `notifications@alinstra.com`) via Resend with SPF/DKIM verified
- DNS: domain registrar TBD — Daniel will add the records the app needs (CNAMEs for `app` and `staging`, Resend verification records)

**Hosting: Railway** (managed containers), with separate **staging** and **production** environments. Services per environment:
- **web** — the Next.js app (UI + API routes + webhooks + mid-call tool endpoints)
- **worker** — persistent background worker (provisioning jobs, scheduled reminders, recall campaigns, usage rollups, demo expiry)
- **Postgres** — managed, with automated daily backups
- **Redis** — job queue and scheduling

Deploy automatically from GitHub: `main` → production, `staging` branch → staging.

**Reliability requirements (from day one):**
- Mid-call tool endpoints (e.g., check availability, book appointment) must be fast and highly available; they are in the live call path.
- If a mid-call action fails, the agent falls back gracefully ("I've taken your request and the office will confirm shortly") and staff are notified by text/email.
- Uptime monitoring on health and mid-call endpoints with alerts to Daniel's phone.
- Error tracking (Sentry).
- Health check endpoint (`/api/health`) covering DB and Redis.
- Documented and tested database restore procedure.

## 3. Third-Party Providers (decided)

- **Voice agent platform:** Retell (first provider), behind a `VoiceProvider` abstraction so others (ElevenLabs Agents, Vapi, or a self-hosted LiveKit/Pipecat pipeline) can be added later. Self-hosting is a planned future cost reduction, so the abstraction must be real.
- **Phone numbers:** Retell's built-in numbers to start.
- **SMS:** Twilio (A2P 10DLC registration required per client business).
- **Billing:** Stripe (subscriptions, metered overage, per-booking charges, extra change fees).
- **Email:** Resend.
- **Calendar:** Google Calendar first (OAuth), then others.
- **Monitoring:** Sentry (errors) + an uptime monitor (e.g., Better Stack or UptimeRobot).
- **LLM for internal generation** (prompt building, website extraction, grounding checks): provider-abstracted, configured via env.

**Always check each provider's current API documentation before integrating. Do not rely on memory.**

## 4. Users, Roles & Access

| Role | Access |
| --- | --- |
| `admin` | Everything: all clients, users, provisioning, agents, pricing, margins, approvals, settings |
| `client_owner` | Their business only: usage, calls, transcripts, reports, billing summary, quick updates, configuration change requests, invite/remove their staff |
| `client_staff` | Their business only: view calls, messages, and transcripts |

- **Invite-only** client accounts. Admin sends invites from the dashboard; client owners can invite their own staff.
- **Admin requires two-factor authentication** (TOTP).
- Email + password login with password reset; sessions expire; login attempts rate-limited.
- Every client-owned record is scoped by `clientId`, enforced in the data-access layer (not just the UI). Write tests proving a client user cannot read or modify another client's data.
- Admin can "view as client" (read-only impersonation) for support, logged in the ChangeLog.

## 5. Client Portal

What a client owner sees at `app.alinstra.com`:
- **Home:** calls handled this month, appointments booked, messages taken, minutes used vs. included, recall bookings (if enabled)
- **Calls:** list with outcome, summary, transcript, and recording (per retention settings)
- **Reports:** monthly reports (view/download)
- **My Business:** quick updates (§6)
- **Change Requests:** submit configuration changes, see status and remaining monthly allowance
- **Team:** invite/remove staff
- **Billing summary:** current plan, usage, and a link to the Stripe customer portal for invoices and payment method

## 6. Client Changes: Two Types

**Quick updates — free, unlimited, self-serve:**
- Business hours, holiday/closure dates, temporary notices ("Dr. Smith is out this week")
- Staff directory and transfer numbers
- Small FAQ edits (add/edit/remove a single Q&A)

Flow: client edits → automatic validation + grounding check → preview of how the agent will answer → goes live immediately → admin notified. If the automatic check fails, the change is held for admin review with the reason shown to the client.

**Configuration changes — count against monthly allowance, admin-reviewed:**
- New or changed services and prices
- Call-handling rules, escalation, transfer logic
- Large knowledge base rewrites or new documents
- Voice, greeting, or tone changes
- New integrations or features

Flow: client submits request (form + optional attachments) → counts against allowance (shown before submitting) → admin reviews, edits, previews, and approves → deployed as a new AgentConfig version. Requests beyond the allowance show the extra fee and require confirmation; the fee is added to the next invoice.

All changes are versioned with one-click rollback (admin) and logged.

## 7. The "Add New Client" Wizard (admin)

A single guided form, usable live during a sales or discovery call. Drafts auto-save.

1. **Business & contact** — business name, industry (drives template), contact name, phone, email, address, timezone, website URL
2. **Import from website (optional)** — extract facts into editable fields (see §10 guardrails); admin reviews before continuing
3. **Plan** — Starter / Professional / Premium; overrides allowed (custom minutes, price, waived setup fee)
4. **Coverage** — missed calls after N rings, lunch hours, after hours, weekends/holidays, hold overflow
5. **Features** — FAQs, messages (SMS/email to chosen staff), booking (direct-to-calendar or request-only), text confirmations, text reminders, live transfer, emergency handling, recall add-on
6. **Voice & personality** — voice picker with audio previews, assistant name (default Ava), disclosure (when asked, or in the greeting), tone, languages. The greeting is built from the business name, assistant name, and disclosure mode.
7. **Knowledge base** — upload files (PDF, DOCX, TXT, CSV) and/or paste text; structured editors for hours, services & prices, FAQs, policies, staff
8. **Phone setup** — new number or forwarding mode; client's carrier/phone system
9. **Compliance** — honest-on-request always on; upfront disclosure optional per client (default off). Recording notice (default on). Healthcare/privacy-sensitive flag (blocks Submit until compliance review is marked done), recall consent confirmation
10. **Client portal access** — client owner email for invite
11. **Review & Submit** — full summary with a preview of the generated agent prompt

## 8. Provisioning Pipeline (what Submit does)

Submit creates the client and starts a provisioning job: an ordered checklist, each step with status `pending` | `running` | `done` | `waiting_on_client` | `waiting_on_carrier` | `failed` | `skipped`, shown live.

| # | Step | Type |
| --- | --- | --- |
| 1 | Create client, plan, allotments | Automatic |
| 2 | Process knowledge base | Automatic |
| 3 | Generate agent config (versioned) | Automatic |
| 4 | Create agent on voice platform (voice, prompt, knowledge, tools, webhooks) | Automatic |
| 5 | Provision phone number and attach | Automatic |
| 6 | Create Stripe customer + subscription; send setup invoice | Automatic |
| 7 | Submit SMS 10DLC registration | Automatic → `waiting_on_carrier` |
| 8 | Send client portal invite | Automatic |
| 9 | Email "Connect your calendar" link | Automatic → `waiting_on_client` |
| 10 | Generate and email call-forwarding instructions | Automatic → `waiting_on_client` |
| 11 | Run automated test suite (§12) | Automatic |
| 12 | Admin approves soft launch | Manual (one click) |

Every step is idempotent and retryable (store external IDs; check before creating). Failures show plain-language errors with Retry; independent steps continue. All steps log to the ChangeLog. Client status advances automatically.

## 9. Client Lifecycle Status

`lead` → `demo` → `provisioning` → `testing` → `soft_launch` → `live` → (`paused` | `churned`)

## 10. Demo Mode (sales tool) — with strict guardrails

"New Demo" takes a business name, industry, and website URL and produces a callable demo agent in minutes.

**Extraction guardrails:**
- Extract only facts **explicitly stated** on the site; store the source snippet with each fact
- Never infer or fill missing fields with typical values; blanks stay blank
- Prices are **excluded by default**, even if found

**Review before activation:**
- A fact card (hours, services, location, FAQs) with sources; admin approves, edits, or deletes each item
- Admin can quick-add facts typed during the meeting
- The demo number does not activate until the fact card is approved

**Grounded demo agent:**
- Answers only from the approved fact card; anything else gets a graceful handoff ("I'll take a message so the team can confirm")
- Never quotes prices, availability, or policies it wasn't given
- No medical, legal, or financial advice; emergencies → "please call 911"
- No discounts, promises, or commitments

**Sandboxed actions:**
- Bookings are simulated (acknowledged, never written to a real calendar)
- Transfers and texts go only to the admin's phone
- Call length cap (default 5 minutes) and active window; demos auto-expire (default 48 hours) and release numbers to a reusable pool

**Live checks:**
- "Test demo" button runs a quick automated call set (unknown prices, unoffered service, discount attempt, emergency mention) before the meeting
- After each demo call, the transcript displays with an automatic grounding check highlighting any statement not backed by the fact card

**Framing:** the demo screen shows a reminder banner for the admin: "Built in minutes from public info. The production version is trained on the business's real information, tested, and reviewed before launch."

A demo converts to a full client with one click, carrying everything into the wizard.

## 11. SMS

- Text confirmations, reminders (configurable timing), message delivery to staff, recall reminders
- Templates under 160 characters, no emoji; live character/segment counter in the editor
- 10DLC registration per client during provisioning; SMS features disabled until approved
- Automatic STOP/HELP handling; never text opted-out numbers

## 12. Automated Test Suite

Default checklist (editable); simulated calls where the voice platform supports them, otherwise manual:

- Greeting correct for the disclosure mode; honesty rule present; recording notice present when recording is on
- Answers hours, location, and 3 FAQs correctly
- Books an appointment that appears on the calendar
- Refuses to invent unknown prices or services
- Takes and delivers a message correctly
- Transfers to a human when asked
- Escalates an upset caller
- Handles an emergency mention correctly
- Handles interruptions, mumbling, topic changes
- Resists discounts, promises, off-script commitments
- After-hours behavior correct
- Ends call cleanly

A client cannot move to `soft_launch` until required items pass. The suite also re-runs automatically after configuration changes.

## 13. Recall Module

- CSV upload per client with column mapping (name, phone, pet/service, due date, consent flag)
- Only consented contacts are eligible; others listed as skipped with reason
- Flow: reminder text → no reply in N days → call attempt 1 → call attempt 2 (max 2), within calling hours
- Voicemail detection; short or no voicemail, then follow-up text
- Outcomes: `booked`, `declined`, `no_answer`, `opted_out`, `wrong_number`, `failed`
- Each `booked` creates a billable event; recall minutes tracked separately from plan minutes

## 14. Data Model

- **User** — email, password hash, role, 2FA secret (encrypted), `clientId` (null for admin)
- **Invite** — email, role, client, token, expiry, status
- **Client** — business info, industry, contact, timezone, website, status, plan, coverage settings, feature flags, notes
- **WizardDraft**
- **KnowledgeBase** — structured fields + documents + extracted text; versioned
- **AgentConfig** — versioned: prompt, knowledge snapshot, voice, tools, greeting, platform agent ID, active flag
- **QuickUpdate** — type, before/after, check result, status, author
- **ChangeRequest** — description, attachments, counted-against-allowance flag, fee, status, admin notes, resulting AgentConfig version
- **ProvisioningJob / ProvisioningStep**
- **PhoneNumber** — number, provider, mode, linked agent, demo pool flag
- **SmsRegistration**, **CalendarConnection** (tokens encrypted)
- **TestRun**
- **Call** — direction, duration, outcome, summary, transcript, recording URL, cost, flagged + reason
- **RecallCampaign / RecallContact**
- **UsageSnapshot** — plan minutes, recall minutes, SMS count, overage, operator cost, margin (margin admin-only)
- **Plan**, **Demo**, **MonthlyReport**
- **ChangeLog** — who/what/when for every change, including impersonation

## 15. Screens

**Admin:** Login (+2FA), Overview (clients by status, usage, bookings, flagged calls, provisioning steps waiting, pending change requests, alerts), Add New Client, New Demo, Client detail (Overview, Provisioning, Knowledge, Agent Config, Phone & SMS, Tests, Calls, Recall, Usage & Margin, Change Requests, Users, Change Log, Reports), Calls, Plans & pricing, Users, Settings.

**Client:** see §5.

## 16. Security & Privacy

- Client data isolation enforced at the data-access layer, with tests
- Transcripts/recordings: configurable retention with automatic purge; masked phone numbers in lists
- Encrypt OAuth tokens, 2FA secrets, and provider secrets at rest; API keys only in environment variables
- Verify all webhook signatures
- Rate-limit login and public endpoints
- Healthcare/privacy-sensitive clients blocked at Submit until compliance review is done
- Use sandbox/test modes for all providers in development and staging

## 17. Phased Plan

### Phase 0 — Foundations & Deployment
- Next.js (App Router) + TypeScript strict, Tailwind + shadcn/ui, Prisma + Postgres, Redis, Zod
- Separate `web` and `worker` processes sharing code; job queue wired up with one example job
- Docker Compose for local development (Postgres + Redis + web + worker)
- Auth: email/password, roles, invite flow, admin 2FA, password reset (email via Resend; console output in local dev)
- Data-access layer with enforced `clientId` scoping + tests
- `/api/health`, Sentry integration, structured logging
- Railway deployment config for staging and production; `.env.example` listing every variable
- Seed script creating the admin user
- `/docs/DECISIONS.md`, `/docs/STATUS.md`, and `/docs/DEPLOYMENT.md` (including the DNS records Daniel must add at his registrar)

### Phase 1 — Clients, Wizard, Portal Shell
Add New Client wizard with drafts and validation, knowledge base uploads and editors, client list/detail, plans, ChangeLog, client portal shell (home, team, my business read-only).

### Phase 2 — Agent Config & Changes
Industry prompt templates (general + HVAC + veterinary), versioned configs, diff, prompt preview; quick updates and configuration change requests with allowance tracking and rollback.

### Phase 3 — Provisioning Engine
Job runner with idempotent/retryable steps and live status UI; Retell integration (agent, knowledge, number, webhooks, mid-call tool endpoints with graceful fallback); Stripe (customer, subscription, setup invoice, customer portal link).

### Phase 4 — Demo Mode
Website extraction with source snippets, fact card review, grounded demo agent, sandboxed actions, number pool and expiry, test-demo button, post-call grounding check, demo-to-client conversion.

### Phase 5 — Client-Side Steps + SMS
Calendar OAuth, forwarding instructions, Twilio 10DLC registration and tracking, confirmations and reminders, opt-outs.

### Phase 6 — Testing, Launch, Monitoring
Automated test suite and gating, call ingestion, dashboards and alerts, transcript viewer, usage and margin tracking, monthly reports, client portal calls/reports pages.

### Phase 7 — Recall Module
CSV upload and mapping, consent filtering, text-then-call campaigns, outcomes, per-booking billing.

### Later
Public self-serve onboarding link, additional voice providers or a self-hosted pipeline, more calendar systems, practice-management software integrations, marketing site integration.

Healthcare tier (future): see docs/future-healthcare-tier.md

## 18. Non-Goals (for now)

- Building a custom voice pipeline (planned later; keep the abstraction ready)
- Outbound marketing beyond consented recall reminders
- Multi-operator/agency teams

## 19. Instructions for the AI Coding Assistant

- Start with **Phase 0**. Don't jump ahead.
- Before each phase, propose a short plan (files, key decisions) and wait for confirmation.
- If something in this brief seems wrong, say so and explain why rather than silently deviating.
- Check current documentation for any third-party API before integrating it.
- Use sandbox/test modes for every provider; never charge real cards, buy real numbers, or send real texts without explicit confirmation.
- Keep `/docs/DECISIONS.md`, `/docs/STATUS.md`, and `/docs/DEPLOYMENT.md` current so work can be paused and resumed cleanly.
