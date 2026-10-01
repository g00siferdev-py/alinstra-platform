# alinstra-platform

Operations platform for Alinstra Technologies (AI receptionist dashboard).

Phase 0 (foundations) is implemented on this branch. Product features start at Phase 1. Decisions: [`docs/DECISIONS.md`](./docs/DECISIONS.md). Current state: [`docs/STATUS.md`](./docs/STATUS.md). Deploy steps: [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

Source of truth for product scope: [`RECEPTIONIST_DASHBOARD_BRIEF.md`](./RECEPTIONIST_DASHBOARD_BRIEF.md).

## Prerequisites

- **Node.js** 22.x LTS (`>=20.9` required)
- **pnpm** 10.28.2 (`corepack enable` then `corepack prepare pnpm@10.28.2 --activate`)
- **Docker Desktop** with the WSL 2 backend, for Postgres and Redis

## Local setup

```bash
pnpm install
cp .env.example .env
```

Edit `.env` before seeding:

- `BETTER_AUTH_SECRET` — `openssl rand -base64 32`
- `ENCRYPTION_KEY` — `openssl rand -base64 32` (32 bytes; see `docs/DECISIONS.md`)
- `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD` (12+ characters)

```bash
docker compose up -d postgres redis
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev:web
pnpm dev:worker
```

Web: http://localhost:3000. Health: http://localhost:3000/api/health.

`pnpm dev` runs both through Turborepo. Email in local development is printed to the worker log (`EMAIL_TRANSPORT=console`).

`docker compose up -d --build` also builds web and worker containers. Apply migrations from the host first. The worker never migrates.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Web and worker |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest, including `clientId` isolation |
| `pnpm db:migrate` | `prisma migrate dev` |
| `pnpm db:migrate:deploy` | `prisma migrate deploy` (Railway web pre-deploy) |
| `pnpm db:seed` | Create the admin from `ADMIN_EMAIL` |

## Layout

```text
apps/web          Next.js App Router
apps/worker       BullMQ consumer (email jobs)
packages/config   Env, logs, Sentry scrubbing
packages/crypto   AES-256-GCM for app-owned secrets
packages/db       Prisma schema, migrations, scoped repositories
packages/auth     Better Auth, invites, lockout
packages/email    Resend or console
packages/queue    BullMQ queue and payload schemas
```

## Hostnames

- Production: `app.alinstra.com` (`main`)
- Staging: `staging.alinstra.com` (`staging`)
- Marketing apex `alinstra.com` is out of scope
