# Status

Phase 1 — wizard, knowledge files, plans, and the client portal shell. Committed locally. Do not push until Daniel asks. Do not start Phase 2.

## Verified locally

- `pnpm lint`, `pnpm typecheck`, and `pnpm test`: 37 tests passed
- Isolation: a client user cannot read another client's draft, knowledge, documents, or change log. A storage key is always under that client's id.
- Extraction: truncated text, a malformed or oversized DOCX fails as `ExtractionFailed`, and the timeout helper rejects
- Production env guard still rejects placeholder secrets. Staging and production also require R2 (`STORAGE_DRIVER=s3`)

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

1. Read `docs/DECISIONS.md`, `docs/phase-1-plan.md`, and this file.
2. Phase 2 starts only after review of Phase 1.
