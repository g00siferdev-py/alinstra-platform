# Status

Phase 2 is merged into `main`. Staging deploy readiness (navigation, port, worker thread, production-image rehearsal) is on `main` with it. `staging` points at `main`.

## Verified locally

- Phase 2: `pnpm test` passed 60 tests (prompt rendering, admin two-factor, allowance, isolation, plus the Phase 0–1 suites). `pnpm lint` and `pnpm typecheck` were run after the navigation and deploy-readiness changes.
- An account with two-factor enabled lands on `/login/two-factor` after the password.
- Signed-in pages show the app header. In the wizard, Save & exit stores the draft and returns to the clients list. Header links save first. A pending save asks before leaving. The clients list shows Continue setup with the step number, and that link reopens the wizard on that step. Discard draft asks for confirmation and is styled separately.
- `pnpm --filter @alinstra/web start` listens on `PORT`, falling back to 3000.
- Production rehearsal (`docker compose --profile prod-smoke`) built the web and worker Dockerfiles. Against Postgres, Redis, and RustFS (S3 stand-in; MinIO's images were not anonymously pullable), migrate, seed, `/api/health`, admin sign-in, a presigned upload, extraction in the production worker image, and download all succeeded (`PROD_SMOKE_OK`).
- Isolation: a client user cannot read another client's draft, knowledge, documents, or change log. A storage key is always under that client's id.
- Extraction: truncated text, a malformed or oversized DOCX fails as `ExtractionFailed`, and the timeout helper rejects
- Production env guard still rejects placeholder secrets. Staging and production also require R2 (`STORAGE_DRIVER=s3`)

## CI
- GitHub Actions runs install, prisma generate, migrate deploy, lint, typecheck, and test against Postgres 16 and Redis 7 service containers. Fixed 2026-10-01: Turborepo strict env mode hid DATABASE_URL from tasks, and CI had no Redis.
- Remote GitHub Actions is unverified. `gh` is not installed, so the runs on GitHub were not watched. A fresh clone of `phase-2` passed the CI sequence locally against `alinstra_test` before this deploy-readiness work. The clone for this work is recorded below once it has run.

## Phase 2

- `@alinstra/agent` renders receptionist template version 3. The greeting uses the assistant name (default Ava) and disclosure mode. Honest-on-request is always on. Upfront disclosure is optional and defaults off. The recording notice stays on by default. `{{current_time}}` is filled by the voice platform in Phase 3. Reference blocks use a random token stored on the config. No model or external API calls.
- Wizard step 11 shows that prompt. Submit creates AgentConfig version 1 as draft. `platformAgentId` stays null.
- Owners can quick-update hours, closures, staff and transfer numbers, and one FAQ. Sensitive wording is held. A safe change creates a new active config and queues an admin email.
- Owners can submit a text change request. Allowance is the calendar month in the client timezone. A client with no plan and no override gets 0 included requests. Past the allowance, the extra fee is stored after confirmation. Billing is still Phase 3.
- Admin client pages: Agent Config (versions, diff, preview, activate, rollback) and Change Requests. Approving a request edits the receptionist fields and publishes a new version. The request text is not copied into the prompt. Rollback forks the knowledge base from the chosen version. Admin home lists held updates and pending requests.
- Admins cannot turn off two-factor authentication. They replace an authenticator with a current code, and two-factor stays on. Client users can still disable optional two-factor.
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
- Railway project creation and Cloudflare records. The click-by-click list is `docs/DEPLOYMENT.md`. Daniel does the account steps.
- First staging database restore drill

## How to run

See the root `README.md`. Admin sign-in still requires two-factor enrollment at `/account/security` before `/admin/clients` and `/admin/plans`.

## How to resume

1. Read `docs/DECISIONS.md`, `docs/DEPLOYMENT.md`, `docs/phase-3-plan.md`, and this file.
2. Phase 2 is on `main`. The items under "Needs Daniel's review" in `docs/DECISIONS.md` are still open.
3. Phase 3 is planned only (`docs/phase-3-plan.md`). No provisioning, Retell, or Stripe code yet.
