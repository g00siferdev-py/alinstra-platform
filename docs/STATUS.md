# Status

Phase 0 — foundations and deployment. Implementation is complete and ready for review. Do not start Phase 1 until Daniel signs off.

## Verified locally

- `pnpm lint`, `pnpm typecheck`, and `pnpm test` (cache bypassed): 14 tests passed, including clientId isolation and invite binding
- `GET /api/health` returns `{"ok":true,"db":"up","redis":"up"}`
- Login, forgot-password, and invite pages render
- Seeded admin sign-in succeeds; a wrong password returns 401
- `/home` shows the two-factor gate and hides invite tools until enrollment
- `/account/security` renders the authenticator setup form for an admin without 2FA

## Shipped in Phase 0

- pnpm 10.28.2 + Turborepo monorepo, `@alinstra/*` packages
- Prisma 7.10.0 schema: Better Auth tables, minimal `Client`, custom `Invite`
- Scoped repositories and Vitest isolation tests
- Better Auth email/password, invite-only signup, password reset, admin TOTP
- Session caps and login / reset rate limits (`docs/DECISIONS.md`)
- BullMQ email worker (`send-invite-email`, `send-password-reset-email`)
- `GET /api/health`, Sentry with `sendDefaultPii: false` and body scrubbing
- Seed from `ADMIN_EMAIL`
- GitHub Actions CI (lint, typecheck, tests, Postgres)
- Railway config: migrate on the web service only
- `docs/DECISIONS.md`, `docs/DEPLOYMENT.md`, this file

## Explicitly deferred

- Uptime monitor vendor (placeholder in `docs/DEPLOYMENT.md`)
- Railway project creation and Cloudflare records (Daniel, using `docs/DEPLOYMENT.md`)
- First staging database restore drill
- Phase 1 wizard, portal, and integrations

## How to run

See the root `README.md`. Admin sign-in requires two-factor enrollment at `/account/security` before client and invite tools are available.

## How to resume

1. Read `docs/DECISIONS.md` and this file.
2. Phase 1 starts only after review of Phase 0.
