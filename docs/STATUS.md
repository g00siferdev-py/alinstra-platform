# Status

Phase 1 — wizard, knowledge files, plans, and the client portal shell. Committed locally. Do not push until Daniel asks. Do not start Phase 2.

## Verified locally

- `pnpm lint`, `pnpm typecheck`, and `pnpm test`: 31 tests passed
- Isolation: a client user cannot read another client's draft, knowledge, documents, or change log. A storage key is always under that client's id.
- Extraction: truncated text, a malformed or oversized DOCX fails as `ExtractionFailed`, and the timeout helper rejects
- Production env guard still rejects placeholder secrets. Staging and production also require R2 (`STORAGE_DRIVER=s3`)

## Shipped in Phase 1

- `Plan`, expanded `Client`, `WizardDraft`, `KnowledgeBase`, `KnowledgeDocument`, `ChangeLog`
- Scoped repositories and isolation tests for the new tenant-scoped tables
- Change log written in the same transaction as the change
- 11-step admin wizard with autosave, per-step validation, and submit that stays `lead`
- Private uploads (local disk in dev, R2 presign in staging/production) and authenticated downloads
- Worker job `extract-knowledge-text` (60s timeout, 200,000 character cap)
- Admin client list (Wizard submitted badge, remove), client detail (invite, discard, remove, users, change log), `/admin/plans`
- Portal home, team (owner only), and read-only My Business for owner and staff

## Explicitly deferred

- Retell, Stripe, Twilio, calendar, demo mode, and provisioning
- Uptime monitor vendor
- Railway project creation and Cloudflare records
- First staging database restore drill

## How to run

See the root `README.md`. Admin sign-in still requires two-factor enrollment at `/account/security` before `/admin/clients` and `/admin/plans`.

## How to resume

1. Read `docs/DECISIONS.md`, `docs/phase-1-plan.md`, and this file.
2. Phase 2 starts only after review of Phase 1.
