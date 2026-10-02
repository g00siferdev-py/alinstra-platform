# Status

Phase 2 is on branch `phase-2` and is not merged. Main and staging stay at the Phase 1 CI fix (`231db47`).

## Verified locally

- Phase 2 branch: `pnpm test` passed 58 tests (prompt rendering, allowance, isolation, plus the Phase 0–1 suites). `pnpm lint` and `pnpm typecheck` were run on this branch after those tests.
- Isolation: a client user cannot read another client's draft, knowledge, documents, or change log. A storage key is always under that client's id.
- Extraction: truncated text, a malformed or oversized DOCX fails as `ExtractionFailed`, and the timeout helper rejects
- Production env guard still rejects placeholder secrets. Staging and production also require R2 (`STORAGE_DRIVER=s3`)

## CI
- GitHub Actions runs install, prisma generate, migrate deploy, lint, typecheck, and test against Postgres 16 and Redis 7 service containers. Fixed 2026-10-01: Turborepo strict env mode hid DATABASE_URL from tasks, and CI had no Redis.
- Remote GitHub Actions is unverified. `gh` is not installed, so the runs on GitHub were not watched. A fresh clone of this `phase-2` branch passed the CI sequence locally against `alinstra_test` (lint, typecheck, and 58 tests).

## Phase 2 (branch `phase-2`, not merged)

- `@alinstra/agent` renders the receptionist prompt from structured data. Templates: general, HVAC, veterinary. No model or external API calls.
- Wizard step 11 shows that prompt. Submit creates AgentConfig version 1 as draft. `platformAgentId` stays null.
- Owners can quick-update hours, closures, staff and transfer numbers, and one FAQ. Sensitive wording is held. A safe change creates a new active config and queues an admin email.
- Owners can submit a text change request. Allowance is the calendar month in the client timezone. A client with no plan and no override gets 0 included requests. Past the allowance, the extra fee is stored after confirmation. Billing is still Phase 3.
- Admin client pages: Agent Config (versions, diff, preview, activate, rollback) and Change Requests. Approving a request edits the receptionist fields and publishes a new version. The request text is not copied into the prompt. Rollback forks the knowledge base from the chosen version. Admin home lists held updates and pending requests.
- Tests use the `alinstra_test` database and refuse to truncate any other database.
- Portal: My Business is editable for owners. Staff stay read-only. Owners have Change Requests.

## Shipped in Phase 1

- `Plan`, expanded `Client`, `WizardDraft`, `KnowledgeBase`, `KnowledgeDocument`, `ChangeLog`
- Scoped repositories and isolation tests for the new tenant-scoped tables
- Change log written in the same transaction as the change
- 11-step admin wizard with autosave, per-step validation, and submit that stays `lead`
- Private uploads (local disk in dev, R2 presign in staging/production) and authenticated downloads
- Worker job `extract-knowledge-text` on the `knowledge` queue (concurrency 1, killed after 60 seconds). The `email` queue stays separate
- Admin client list (Wizard submitted badge, remove for lead or demo), client detail (invite, discard, remove, users, change log), `/admin/plans`
- Portal home, team (owner only), and read-only My Business for owner and staff

## Explicitly deferred

- Retell, Stripe, Twilio, calendar, demo mode, and provisioning
- Churn for a live client (release the number, delete the agent, cancel Stripe). Remove only covers lead and demo
- Uptime monitor vendor
- Railway project creation and Cloudflare records
- First staging database restore drill

## How to run

See the root `README.md`. Admin sign-in still requires two-factor enrollment at `/account/security` before `/admin/clients` and `/admin/plans`.

## How to resume

1. Read `docs/DECISIONS.md`, `docs/phase-2-plan.md`, and this file.
2. Phase 2 is on `phase-2`. Do not merge until Daniel reviews the items under "Needs Daniel's review".
3. Phase 3 (billing, provisioning, live-client churn) has not started.
