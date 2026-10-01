# Phase 0: Foundations & Deployment — Plan

**Status:** Draft for approval (no code yet)  
**Scope:** Foundations & Deployment only — no product features beyond auth/scaffold/infra  
**Repo:** `g00siferdev-py/alinstra-platform` (`origin/main` @ `1eb215d`)  
**Brief:** `RECEPTIONIST_DASHBOARD_BRIEF.md` — **on `origin/main` @ `1eb215d`** (source of truth)  
**Audience:** Daniel Greene

---

## Brief & decision status

Brief is on GitHub `main` at commit `1eb215d` (“Add receptionist dashboard brief”). This plan was re-checked against that brief and the locked decisions below.

Stack, roles, hostnames, auth policy, email, Railway layout, package scope, and monorepo tooling are settled for Phase 0.

| Item | Status |
|---|---|
| Stack (Next.js App Router, TS strict, Tailwind + shadcn/ui, Prisma + Postgres, Redis, Zod, Better Auth, BullMQ) | **Locked** |
| Roles `admin` / `client_owner` / `client_staff` | **Locked** |
| 2FA: required for `admin` (TOTP + backup codes); optional for client users | **Locked** |
| Invite-only signup (admin → owners; owners → staff); no public signup | **Locked** |
| Hostnames: `app.alinstra.com` (prod), `staging.alinstra.com` (staging); **do not touch** apex `alinstra.com` | **Locked** |
| Cloudflare: DNS only (grey cloud) first; document safe later switch to proxied | **Locked** |
| Email: Resend; console-log emails in local dev | **Locked** |
| Bootstrap admin: `ADMIN_EMAIL` env var for seed — never hardcode | **Locked** |
| Package scope: `@alinstra/*` | **Locked** |
| Railway: US East; one project; separate staging + production environments | **Locked** |
| Prisma: **7.10.0** current stable (Prisma 8 still RC — do not wait on it) | **Locked** |
| pnpm + Turborepo | **Locked** |

---

## Phase 0 goals

Per brief §17 Phase 0:

1. Bootstrap a pnpm + Turborepo monorepo with `apps/web`, `apps/worker`, and shared `@alinstra/*` packages.
2. Wire Postgres + Prisma (**7.10.0** stable), Redis + BullMQ, Better Auth (email/password, roles, invite, admin 2FA, password reset).
3. Enforce `clientId` scoping in the data-access layer with automated tests.
4. Docker Compose for local development (Postgres + Redis + web + worker).
5. `/api/health` (DB + Redis), Sentry integration, structured logging.
6. Railway staging + production (US East, one project); `.env.example` listing every variable.
7. Seed script creating the admin user from `ADMIN_EMAIL`.
8. Docs: `/docs/DECISIONS.md`, `/docs/STATUS.md`, `/docs/DEPLOYMENT.md` (DNS records Daniel must add; grey-cloud-first Cloudflare steps; DB backup/restore notes per brief §2).
9. Ship a stack-appropriate `.gitignore` (never commit `.env*`).

**Out of scope for Phase 0:** Wizard, portal product UI, Retell/Twilio/Stripe/calendar integrations, demo mode, recall, provisioning pipeline — those are Phases 1–7. **No application code until this plan is approved.**

---

## 1. Folder structure & key libraries

### Layout

```text
alinstra-platform/
├── apps/
│   ├── web/                 # Next.js App Router (UI + API routes / server actions)
│   └── worker/              # BullMQ consumer process (same shared packages)
├── packages/
│   ├── db/                  # Prisma schema, migrations, scoped repositories
│   ├── auth/                # Better Auth server config + role helpers
│   ├── queue/               # Queue names, job payloads (zod), producers/consumers
│   ├── email/               # Resend adapter; console transport in local dev
│   ├── config/              # Shared zod env parsing
│   └── tsconfig/            # Shared TS configs
├── docs/
│   ├── DECISIONS.md
│   ├── STATUS.md
│   └── DEPLOYMENT.md        # post-approval
├── docker-compose.yml       # postgres + redis + web + worker
├── .env.example
├── .gitignore
├── package.json             # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── RECEPTIONIST_DASHBOARD_BRIEF.md   # already on main @ 1eb215d
└── README.md
```

### Tooling

| Tool | Version (pin) | Role |
|---|---|---|
| Node.js | **22.x LTS** (`>=20.9` required by Next) | Runtime |
| pnpm | **10.11.5** (or current 10.x at install) | Package manager / workspaces |
| Turborepo | **2.11.5** | Task orchestration |
| TypeScript | **5.9.3** (strict) | Language |
| ESLint | **9.x** (align with Next ESLint flat config at scaffold) | Lint |
| Prettier | **3.9.9** | Format |
| Vitest | **4.1.x** (pin exact at install) | Unit/integration tests |
| tsx | **4.20.x** | Worker / scripts runner |

> Versions checked against npm on **2026-10-01**. Lock exact patches in `package.json` at implementation time.

### Application libraries

| Library | Version | Role |
|---|---|---|
| `next` | **16.3.8** | Web app (App Router) |
| `react` / `react-dom` | **19.3.0** (respect Next peer range at install) | UI |
| `tailwindcss` | **4.3.3** | Styling |
| `shadcn/ui` | scaffold at implement time | UI primitives |
| `better-auth` | **1.7.7** | Email/password, sessions, reset, 2FA, invite primitives |
| `zod` | **4.6.5** | Env + job payload validation |
| `prisma` + `@prisma/client` | **7.10.0** (current stable; Prisma 8 is RC only — do not adopt yet) | ORM / migrations |
| `bullmq` | **6.3.10** | Job queue |
| `ioredis` | **6.0.0** | Redis client for BullMQ |
| `resend` | pin current at implement | Production/staging email |
| TOTP | via Better Auth `twoFactor` plugin | Admin 2FA + backup codes |
| `@sentry/nextjs` (+ worker SDK as needed) | pin current at implement | Error tracking |

**Docker images (Compose):** `postgres:16-alpine`, `redis:7-alpine`, plus `web` and `worker` services per brief.

### Planned deliverable: `.gitignore`

After approval, add a stack `.gitignore` covering at least:
- `.env`, `.env.*`, `!.env.example`
- `node_modules/`, `.turbo/`, `.next/`, `dist/`, `coverage/`
- Prisma generated artifacts if checked out of tree; OS/editor junk (`.DS_Store`, `.idea/`, etc.)
- Railway/local override files if any

### Planned deliverable: `.env.example`

Document every required variable (no secrets). Keys include at least:
- `DATABASE_URL`, `REDIS_URL`
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` / `APP_URL`
- `ADMIN_EMAIL` (seed bootstrap — never hardcode the address in source)
- `RESEND_API_KEY` (unused in local console-email mode)
- `EMAIL_FROM` (e.g. `notifications@alinstra.com`)
- `SENTRY_DSN` (optional locally)
- `NODE_ENV`, Railway environment identifiers as needed

---

## 2. How web and worker share code

**Pattern:** pnpm workspace + Turborepo. Both processes import the same packages; neither duplicates domain logic.

| Concern | Package | Used by |
|---|---|---|
| Schema, migrations, scoped repos | `@alinstra/db` | web, worker |
| Auth config / session helpers | `@alinstra/auth` | web (primary); worker only if jobs need identity metadata |
| Queue definitions + typed jobs | `@alinstra/queue` | web (enqueue), worker (process) |
| Email templates/adapters | `@alinstra/email` | worker (prefer queue); console logger in local dev |
| Env schema | `@alinstra/config` | web, worker |

**Process split:**
- **`apps/web`** — HTTP, UI, session cookies, enqueues jobs (`sendInviteEmail`, `sendPasswordReset`, …), `/api/health`.
- **`apps/worker`** — long-running BullMQ workers; no public HTTP (health check optional on Railway).

**Rules:**
- Shared packages export typed APIs only; no Next.js imports inside `packages/*`.
- Job payloads validated with zod in `@alinstra/queue` so producers/consumers stay in sync.
- One Prisma schema; migrations run once per environment (web release or dedicated migrate step).

---

## 3. Auth approach

**Library:** Better Auth (locked) with email/password enabled. **Not Auth.js.**

### Email / password
- Credential sign-in only for Phase 0 (no OAuth — Google Calendar OAuth is Phase 5).
- Password hashing/session cookies handled by Better Auth.
- Password reset: tokenized email link → set new password; enqueue email via BullMQ.
- Sessions expire; login attempts rate-limited (exact TTL/limits — see Remaining questions).

### Roles (locked — brief §4)

| Role | Intent |
|---|---|
| `admin` | Alinstra operator (Daniel); everything cross-client; **2FA required** |
| `client_owner` | Manages one client (`clientId`); can invite/remove staff |
| `client_staff` | Read-oriented access for one `clientId` (calls/messages/transcripts) |

`clientId` is null for `admin`; required for client roles.

### Invite flow (invite-only — locked)
1. `admin` invites a `client_owner` (`email`, `role`, `clientId`).
2. `client_owner` invites `client_staff` for their own `clientId`.
3. Persist invite token (expiry + single use).
4. Enqueue `send-invite-email` job.
5. Recipient opens link → set password → accept invite → session with role + `clientId`.
6. Prefer Better Auth organization/invitation plugins where they fit; otherwise thin custom tables in `@alinstra/db` with the same UX.
7. **No public signup.**

### Admin 2FA (locked)
- **Method:** TOTP (authenticator app) via Better Auth `twoFactor` plugin + **backup codes**.
- **Policy:** Required for `admin` before accessing admin routes; **optional** for `client_owner` / `client_staff`.
- Backup codes issued at enrollment; store hashed.
- Enforcement in server-side session guards (not only UI).
- 2FA secrets encrypted at rest (brief §16).

### Password reset
1. Request reset by email (always generic response).
2. Enqueue `send-password-reset-email`.
3. Single-use, short-TTL token; invalidate sessions on success (default yes unless Decisions.md says otherwise).

### Email delivery
- **Resend** in staging/production (`notifications@alinstra.com` domain per brief).
- **Local dev:** console-log email content (no real sends); no Mailpit required.

### Bootstrap admin
- Seed script reads **`ADMIN_EMAIL`** from env and creates/ensures the `admin` user.
- Never hardcode Daniel’s email (or any address) in source.

### Phase 0 auth deliverables (implementation later)
- Login, logout, invite accept, password reset, admin 2FA enroll/verify pages (minimal UI + shadcn/ui).
- Seed script via `ADMIN_EMAIL`.

---

## 4. `clientId` scoping (data-access) & tests

### Model
- Most business rows carry non-null `clientId` (UUID/cuid).
- Session carries `userId`, `role`, and `clientId` (null only for `admin`).

### Enforcement (data-access layer — not ad hoc in UI)
In `@alinstra/db`, expose **scoped repositories** / query helpers that require a `TenantContext`:

```ts
type TenantContext =
  | { role: "admin"; clientId?: string } // optional filter / view-as later
  | { role: "client_owner" | "client_staff"; clientId: string };
```

Rules:
- Non-admin queries **always** `WHERE clientId = ctx.clientId`.
- No raw unbounded `findMany` on tenant tables from apps — only through scoped APIs.
- Cross-tenant access only via explicit `admin` APIs (read-only “view as client” is brief §4 — can stub context shape in Phase 0; full UI later).
- IDs alone are insufficient: fetch-by-id still applies `clientId` predicate (prevents IDOR).

Optional defense-in-depth (post–Phase 0 if desired): Postgres Row Level Security. Phase 0 relies on the repository contract + tests.

### Testing
- Vitest integration tests against Compose Postgres.
- Fixtures: Client A / Client B, users in each role.
- Cases:
  - `client_staff` A cannot read Client B rows (empty/404, never leak).
  - `client_owner` scoped to own `clientId`.
  - `admin` can read with explicit `clientId` filter.
  - Invite acceptance cannot attach user to a different `clientId` than the invite.
- Fail the suite if a Phase 0 repository method exists without accepting `TenantContext`.

### Phase 0 Prisma baseline (auth + tenancy only)
Tables needed for foundations (full model in brief §14 lands across later phases): User, Session / auth tables, Invite, Client (minimal), plus whatever Better Auth requires. Do not build wizard/provisioning/call tables in Phase 0.

---

## 5. Job queue + example job

### Setup
- **Redis** (Compose locally; Railway Redis plugin in cloud).
- **BullMQ** in `@alinstra/queue`.
- Queues: start with `email` (provisioning/recall queues come later).
- Worker concurrency: low default (e.g. 5); retries with exponential backoff; failed-job visibility in logs.

### Example job: `send-invite-email`

**Payload (zod):** `{ inviteId: string }`  
**Producer:** web, after invite row created.  
**Consumer:** worker loads invite → `@alinstra/email` → Resend (or console in local) → mark invite `emailSentAt`.  
**Failure:** retry; do not expose internal errors to the inviter beyond “email queued/failed”.

Related Phase 0 jobs (same pattern): `send-password-reset-email`.

---

## 6. Local development (Docker Compose)

### Services
| Service | Image / build | Ports |
|---|---|---|
| `postgres` | `postgres:16-alpine` | `5432` |
| `redis` | `redis:7-alpine` | `6379` |
| `web` | local Dockerfile / compose build | app port (e.g. `3000`) |
| `worker` | same image family; worker start command | none public |

Brief requires Compose to run Postgres + Redis + web + worker. DX may still allow host `pnpm --filter web/worker dev` against Compose Postgres/Redis as an alternate path documented in README.

### Developer loop
```bash
pnpm install
docker compose up -d
cp .env.example .env   # never commit .env; set ADMIN_EMAIL
pnpm db:migrate
pnpm db:seed           # creates admin from ADMIN_EMAIL
pnpm --filter web dev
pnpm --filter worker dev
```

Turborepo scripts: `dev`, `build`, `lint`, `test`, `db:migrate`, `db:studio`.

Local emails: console output only (no Resend calls unless explicitly enabled).

---

## 7. Railway — staging & production

### Project layout (locked)
- **One Railway project**, region **US East**.
- Environments: **staging** and **production** (separate).

| Environment | Purpose | Git deploy (brief) |
|---|---|---|
| **staging** | Pre-prod validation | `staging` branch |
| **production** | Live | `main` |

### Services per environment
| Service | Notes |
|---|---|
| `web` | Next.js build; public domain |
| `worker` | Same image/repo; start command `pnpm --filter worker start`; no public domain required |
| `Postgres` | Railway plugin; separate DB per environment; daily backups (brief §2) |
| `Redis` | Railway plugin; separate instance per environment |

### Config
- Env vars from `.env.example`; secrets only in Railway (never git).
- `APP_URL` / `BETTER_AUTH_URL` = canonical public HTTPS URL for that environment.
- `ADMIN_EMAIL` set per environment as needed for seed/bootstrap.
- Migrations: release command or one-off `prisma migrate deploy` before/at web deploy.
- Staging and production **must not** share Postgres or Redis.
- Provider sandbox/test modes in staging (brief §16 / §19).

### Hostnames (locked)
| Env | Hostname |
|---|---|
| Production | `app.alinstra.com` |
| Staging | `staging.alinstra.com` |

**Apex `alinstra.com`:** marketing site (separate); **do not touch** in this project’s DNS/deploy work.

### Health & observability (Phase 0)
- Web: `/api/health` covering DB and Redis.
- Sentry on web (and worker as practical).
- Structured logging.
- Worker: process heartbeat / Redis connectivity log; optional private health port.
- Document Railway Postgres backup + restore steps in `DEPLOYMENT.md` (brief §2 day-one reliability). Full restore drill can land with first staging DB.

---

## Cloudflare DNS & Railway proxy (for review → `DEPLOYMENT.md` later)

DNS for **alinstra.com** is in **Cloudflare**. After approval, `DEPLOYMENT.md` will include these steps. Apex marketing site records are **out of scope** — only add what this app needs for `app` and `staging` (plus Resend verification records when email is wired).

### Per custom domain (staging and production)

1. In Railway → service `web` → **Custom Domain** → add hostname (`app.alinstra.com` or `staging.alinstra.com`).
2. Railway shows a **CNAME** target (`*.up.railway.app`) and a **TXT** ownership record — **both required**.
3. In Cloudflare → **DNS** → **Records**:
   - **CNAME** — Name: `app` (or `staging`); Target: Railway CNAME value.
   - **TXT** — Name/value exactly as Railway shows (verification).
4. Wait for Railway domain verification + certificate. If stuck on “Validating”, use the toggle trick below.
5. Repeat for each hostname. **Do not modify apex `alinstra.com` records** for this app.

### Proxy / SSL settings (locked: grey-cloud first)

| Setting | Recommendation | Why |
|---|---|---|
| App hostname CNAME proxy | **DNS only (grey cloud)** for first bring-up | Avoids Cloudflare↔Railway double-proxy issues (e.g. Error 1000) and eases cert issuance |
| After cert is green | Optionally enable **Proxied (orange cloud)** if you want Cloudflare WAF/CDN | Safe later switch documented below |
| SSL/TLS encryption mode | **Full** (not **Full (Strict)**) when proxied | Railway docs: Strict breaks during cert renewal / origin mismatch |
| Universal SSL | Enabled | Needed for Cloudflare edge certs when proxied |
| `_acme-challenge` (if present) | **DNS only (grey cloud)** | Must not be proxied or Railway/Let’s Encrypt validation fails |
| Nested subdomains (`a.b.alinstra.com`) | Prefer DNS only unless Advanced Certificate Manager | Railway/Cloudflare limitation on deep proxied names |

**Certificate toggle trick:** If Railway cert stays on “Validating Challenges”, set the hostname to **DNS only**, wait for Railway green check, then re-enable orange cloud if desired.

### Safe later switch: grey cloud → proxied

1. Confirm Railway custom domain shows certificate **Issued** / green while DNS-only.
2. In Cloudflare SSL/TLS, set mode to **Full** (not Strict).
3. Flip the `app` / `staging` CNAME to **Proxied (orange cloud)**.
4. Verify HTTPS loads, Railway domain still healthy, and `/api/health` OK.
5. If Error 1000 or cert issues appear, flip back to **DNS only**, fix, then retry.

Resend: add SPF/DKIM (and any Resend verification) DNS records at Cloudflare when email goes live; document exact records in `DEPLOYMENT.md`.

---

## Planned Phase 0 checklist (post-approval)

- [ ] Scaffold monorepo (pnpm/turbo/apps/packages, `@alinstra/*`)
- [ ] Add `.gitignore` + `.env.example` (incl. `ADMIN_EMAIL`; never commit secrets)
- [ ] Docker Compose (Postgres 16, Redis 7, web, worker)
- [ ] Prisma **7.10.0** schema baseline: User, auth tables, Invite, Client (minimal), scoped repos
- [ ] Better Auth: password, invite-only, reset, admin 2FA (TOTP + backup codes)
- [ ] `@alinstra/email`: Resend + local console transport
- [ ] BullMQ worker + `send-invite-email` example
- [ ] Vitest `clientId` isolation suite
- [ ] `/api/health`, Sentry, structured logging
- [ ] Seed admin from `ADMIN_EMAIL`
- [ ] Railway: one US East project, staging + production environments
- [ ] Write `/docs/DEPLOYMENT.md` (Cloudflare grey-cloud-first + proxied switch; leave apex alone; Postgres backup/restore notes)
- [ ] Write `/docs/DECISIONS.md` + `/docs/STATUS.md`
- [ ] README: local setup + short architecture notes

---

## Decisions (Daniel Greene)

### Locked

1. **Stack:** Next.js App Router + TypeScript strict, Tailwind + shadcn/ui, Prisma + Postgres, Redis, Zod; **Better Auth** (not Auth.js); **BullMQ** for jobs — per brief + approval.
2. **Roles:** exactly `admin`, `client_owner`, `client_staff`.
3. **2FA:** required for `admin` (TOTP + backup codes); optional for client users.
4. **Signup:** invite-only. Admin invites client owners; client owners invite staff. No public signup.
5. **Hostnames:** `app.alinstra.com` = prod, `staging.alinstra.com` = staging. Do not touch apex `alinstra.com`.
6. **Cloudflare:** DNS only (grey cloud) first; document safe later switch to proxied.
7. **Email:** Resend; console-log emails in local dev.
8. **Bootstrap admin:** `ADMIN_EMAIL` env var for seed — never hardcode.
9. **Package scope:** `@alinstra/*`.
10. **Railway:** US East; one project; separate staging + production environments.
11. **Prisma:** current stable **7.10.0** — don’t wait for Prisma 8 (still RC).
12. **pnpm + Turborepo:** approved.

### Remaining Phase 0 questions (brief gaps only)

1. **Session TTL & login rate limits:** brief requires expiring sessions and rate-limited login, but does not specify durations/thresholds. Propose defaults at implement time in `DECISIONS.md` (e.g. session ~7 days sliding; login lockout after N failures) unless you prefer specific numbers now.
2. **Uptime monitor vendor:** brief wants uptime monitoring + phone alerts “from day one” and lists Better Stack or UptimeRobot as examples. Pick one before or during Phase 0 deploy, or defer vendor choice to first production cutover while still shipping `/api/health` + Sentry in Phase 0.

---

## Approval gate

No application code, `.gitignore`, `.env.example`, or deployment docs will be written until you approve this plan. Reply with approval (and optional answers to the two remaining questions). Brief is already on `origin/main` @ `1eb215d` — no separate brief-commit step needed.
