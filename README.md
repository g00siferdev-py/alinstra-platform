# alinstra-platform

Operations platform for Alinstra Technologies (AI receptionist dashboard).

> **Phase 0 status:** plan is in-repo for review. This commit is a **minimal monorepo scaffold** only — auth, Prisma depth, BullMQ jobs, and Railway deploy are **not** implemented until the plan is approved to proceed.

## Review the Phase 0 plan

Read: [`docs/phase-0-foundations-plan.md`](./docs/phase-0-foundations-plan.md)

Source of truth for product scope: [`RECEPTIONIST_DASHBOARD_BRIEF.md`](./RECEPTIONIST_DASHBOARD_BRIEF.md)

## Prerequisites

- **Node.js** `>=20.9` (22.x LTS preferred)
- **pnpm** 10.x (`corepack enable` then `corepack prepare pnpm@10.28.2 --activate`, or install via npm)
- **Docker Desktop** (or Docker Engine + Compose) for Postgres + Redis

> On this Windows machine, Docker Desktop / WSL were not installed at scaffold time. Install Docker Desktop first if `docker compose` is unavailable.

## Local setup

```bash
# 1. Install workspace deps
pnpm install

# 2. Env file (never commit .env)
cp .env.example .env
# Edit ADMIN_EMAIL and BETTER_AUTH_SECRET before seeding (seed lands in full Phase 0)

# 3. Start Postgres + Redis
docker compose up -d

# 4. Smoke the stubs (replaced by real Next.js / worker in full Phase 0)
pnpm --filter @alinstra/web dev
pnpm --filter @alinstra/worker dev
```

Turbo shortcuts (once apps are real):

```bash
pnpm dev          # turbo run dev across apps
pnpm build
pnpm lint
pnpm test
```

## Layout (target)

```text
apps/web          # Next.js App Router (stub for now)
apps/worker       # BullMQ worker (stub for now)
packages/*        # @alinstra/* shared packages (tsconfig starter only for now)
docs/             # Decisions, status, deployment + Phase 0 plan
docker-compose.yml
```

## What this scaffold does / does not do

| Included now | Deferred until plan “go” |
|---|---|
| pnpm + Turborepo workspace | Better Auth (login, invite, 2FA, reset) |
| `apps/web` + `apps/worker` stubs | Prisma schema + migrations + scoped repos |
| `.gitignore`, `.env.example` | BullMQ jobs + email (Resend / console) |
| Compose: Postgres 16 + Redis 7 | `/api/health`, Sentry, seed script |
| Plan MD in `docs/` | Railway staging/production + `DEPLOYMENT.md` depth |

## Hostnames (locked; do not touch apex)

- Production: `app.alinstra.com`
- Staging: `staging.alinstra.com`
- Marketing apex `alinstra.com` is out of scope for this repo
