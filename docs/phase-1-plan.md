# Phase 1: Clients, Wizard, Portal Shell — Plan

**Status:** Approved — implement from this document.  
**Depends on:** Phase 0 (`main` @ `7c4e06c`)  
**Brief:** `RECEPTIONIST_DASHBOARD_BRIEF.md` §7, §14, §15, §17 Phase 1, plus the plan prices in §1 and the portal shell in §5  
**Audience:** Daniel Greene

---

## Goal

An admin can walk the 11-step Add New Client wizard during a call, leave, and come back to an autosaved draft. Submit stores the client, plan, knowledge base, and a ChangeLog entry. It does not call Retell, Stripe, Twilio, or a calendar.

A client owner can sign in and see a read-only home, team, and My Business. A client staff user sees the same business, without team management.

## Out of scope

Retell, Stripe, Twilio, calendars, demo mode, website extraction, voice audio, phone purchasing, the compliance review workflow beyond a stored flag, provisioning jobs, quick updates, change requests, calls, reports, billing, recall campaigns, and admin "view as client".

---

## 1. Data model

One new Prisma migration, `phase_1_clients_wizard`, created locally with `pnpm db:migrate`. Deploy stays `prisma migrate deploy` on the web service only. The worker does not migrate.

`Client` already exists. This migration adds columns. Existing rows stay valid: new columns are nullable or have defaults. No backfill except the plan seed.

Money is integer cents. Minutes and change allowances are integers. `null` included changes means unlimited.

### Not tenant-scoped

| Table | Why | Who can write |
| --- | --- | --- |
| `Plan` | Catalog shared by every client | `admin` only. Any signed-in user may read the plan attached to their client. |

`Plan` columns: `code` (`starter`, `professional`, `premium`, unique), `name`, `monthlyPriceCents`, `includedMinutes`, `overagePerMinuteCents`, `setupFeeCents`, `includedChangesPerMonth` (nullable), `extraChangeFeeCents`, `recallMonthlyCents`, `recallPerBookingCents`, `active`, `sortOrder`, timestamps.

Recall prices are stored so the catalog matches §1. Recall behavior is not built.

`extraChangeFeeCents` is seeded as `4900` ($49) and stays editable on `/admin/plans`.

### Tenant-scoped (`clientId` required)

| Table | Purpose |
| --- | --- |
| `Client` | Business, coverage, features, voice, phone, compliance, plan assignment, overrides |
| `WizardDraft` | One autosaved wizard per client (`clientId` unique) |
| `KnowledgeBase` | Versioned structured knowledge for one client |
| `KnowledgeDocument` | One uploaded file, its storage key, and extracted text |
| `ChangeLog` | Who/what/when for a client change. `clientId` is required on client changes. |

`ChangeLog` also allows `clientId` null for catalog edits (plan price changes). Those rows are admin-only and are not returned to client users.

### `Client` columns added in this phase

Identity and contact: `industry`, `contactName`, `contactPhone`, `contactEmail`, `addressLine1`, `addressLine2`, `city`, `region`, `postalCode`, `country`, `timezone` (IANA, default `America/New_York`), `websiteUrl`, `notes`, `portalOwnerEmail`. Street address is optional.

Industry values: `hvac`, `plumbing`, `electrical`, `veterinary`, `pet_grooming`, `dental`, `medical_office`, `salon_spa`, `auto_repair`, `pest_control`, `home_services`, `professional_services`, `other`.

`status` uses the §9 names. Phase 1 only writes `lead`. Submit sets `wizardSubmittedAt` and leaves status at `lead`. The client list shows a "Wizard submitted" badge when that timestamp is set. Discard sets `archivedAt` on an unsubmitted lead. Submitted wizards cannot be discarded here.

Plan: `planId` (nullable until step 3), and nullable overrides `overrideMonthlyPriceCents`, `overrideIncludedMinutes`, `overrideOveragePerMinuteCents`, `overrideSetupFeeCents`, `overrideIncludedChangesPerMonth`, plus `setupFeeWaived`. Effective price is override if set, otherwise the plan. A waived setup fee is `0`.

JSON columns, each validated by Zod. Shape lives in `@alinstra/db` next to the repositories:

- `coverage` — unanswered after N rings, lunch hours, after hours, weekends, holidays, hold overflow
- `features` — messages (SMS/email and which staff), booking mode (`direct_calendar` or `request_only`), text confirmations, text reminders, live transfer, emergency handling, recall add-on flag
- `voice` — `voiceId`, greeting, tone, languages. `voiceId` is a placeholder string, not a Retell id
- `phone` — `mode` (`new_number` or `forward`), carrier, current number, notes
- `compliance` — `aiDisclosure` (always true), `recordingNotice` (default true), `healthcareSensitive`, `complianceReviewDone`, `complianceReviewNote`, `recallConsent`. Choosing industry `dental` or `medical_office` checks `healthcareSensitive` automatically. The admin can uncheck it afterward.

### `WizardDraft`

`clientId` unique, `currentStep` (1–11), `payload` JSON (schema version field), `updatedAt`, `createdById`.

Step 1 creates the `Client` (`status = lead`) and the draft in one transaction. Autosave updates the draft. Continue validates that step, then copies the step's fields onto `Client` or `KnowledgeBase`. Submit is the only point that freezes a knowledge version.

### `KnowledgeBase` and `KnowledgeDocument`

`KnowledgeBase`: `clientId`, `version` (starts at 1), `status` (`draft` or `submitted`), structured JSON for hours, services and prices, FAQs, policies, and staff. Unique `(clientId, version)`.

`KnowledgeDocument`: `clientId`, `knowledgeBaseId`, `storageKey`, `originalFilename`, `contentType`, `byteSize`, `extractedText`, `extractedTextTruncated`, `extractionStatus` (`pending`, `done`, `failed`), `extractionError` (short, no file body).

Submit marks the current draft version `submitted` and leaves it immutable. A later edit creates version + 1. Phase 1 only needs the wizard's draft plus that submitted version.

### `ChangeLog`

`id`, `clientId` (nullable only for plan-catalog edits), `actorUserId`, `actorRole`, `action` (for example `client.updated`, `wizard.submitted`, `plan.updated`, `knowledge.document_added`), `entityType`, `entityId`, `summary` (one line, no document body), `before` JSON, `after` JSON, `createdAt`.

Reserved for later, unused in Phase 1: `impersonating` (default false) and `impersonatedUserId`. Admin "view as client" is not built. The columns exist so those entries can be written without another migration.

Every mutating repository method writes the ChangeLog row in the same `prisma.$transaction` as the change. A failed log rolls the change back.

---

## 2. Repositories and isolation tests

Same pattern as Phase 0: a function takes `TenantContext` and never trusts a `clientId` from the request body.

New repositories, all taking `ctx`:

- `clients` — extend the Phase 0 repo for the new fields. `client_owner` and `client_staff` can read their row and cannot update it. `admin` can list, get, and update.
- `wizardDrafts` — read/update only when `ctx` matches `clientId`. Client roles get no draft access (admin tool). Tests: staff A cannot read or write client B's draft; a client owner cannot read their own draft.
- `knowledgeBases` and `knowledgeDocuments` — scoped by `clientId`. Writes check that `storageKey` starts with `clients/{clientId}/`.
- `changeLogs` — client roles see only their `clientId` and never catalog rows (`clientId` null). Admin sees all, or one client when `ctx.clientId` is set.
- `plans` — read for any signed-in user; create/update/archive for admin only. Not filtered by `clientId`.

Isolation tests in `packages/db`, same style as `repositories.test.ts`:

- Client A cannot read or update client B, B's draft, B's knowledge, B's documents, or B's changelog.
- A document insert whose storage key uses client B's id is rejected while the context is client A.
- A client owner cannot update a `Plan`.
- A changelog written for a client update is in the same transaction: if the log insert fails, the client row is unchanged (tested by forcing a bad actor id, or by inspecting the transaction helper).

The existing source-contract test stays: every exported repository function takes `ctx: TenantContext`.

---

## 3. Plans

Seed is idempotent (`upsert` on `code`) from `pnpm db:seed`, next to the admin user.

| Code | Monthly | Minutes | Overage | Setup | Changes / month |
| --- | --- | --- | --- | --- | --- |
| `starter` | $199 | 300 | $0.35 | $299 | 1 |
| `professional` | $399 | 1,000 | $0.30 | $499 | 2 |
| `premium` | $699 | 2,500 | $0.25 | $799 | unlimited (`null`) |

Also seeded from §1, not used by product code yet: recall $25/month and $6 per booked appointment, on every plan.

Admin screen `/admin/plans` edits those amounts. Saving writes a ChangeLog row with `clientId` null.

Wizard step 3 and the client detail page set per-client overrides. The portal shows the effective numbers, not the catalog, when an override exists.

---

## 4. Wizard

Route: `/admin/clients/new` and `/admin/clients/[id]/wizard`. Admin only, and only after 2FA, same gate as today.

Autosave: the browser debounces about 800ms after a change and also saves on step change. The server action writes `WizardDraft.payload` and `updatedAt`. A save with a stale `updatedAt` is rejected so two tabs cannot clobber each other. Autosave uses a partial Zod schema. "Continue" uses the strict schema for that step and blocks on failure.

### Steps

| Step | Phase 1 behavior |
| --- | --- |
| 1. Business & contact | Real. Required: business name, industry, contact name, contact email. Timezone defaults to `America/New_York`. Optional: phone, street address, website URL. Creates `Client` + `WizardDraft`. |
| 2. Import from website | **Stub.** Shows the website URL from step 1 and a short note that import arrives with demo mode (Phase 4). No HTTP request to that URL. No fact cards. Optional textarea `websiteNotes` is stored on the draft and nowhere else. The Import button is not rendered. |
| 3. Plan | Real. Pick one active plan. Optional overrides and "waive setup fee". |
| 4. Coverage | Real. The coverage fields in §7. Stored in `coverage`. No call routing. |
| 5. Features | Real capture only. Toggles and booking mode are stored in `features`. No SMS, calendar, or transfer setup. |
| 6. Voice & personality | **Stub for audio.** Greeting, tone, and languages are real text fields. Voice is a fixed list of labels (`voice_1` … `voice_4`) with no audio element and no Retell call. Copy on the page says previews arrive with the voice provider. |
| 7. Knowledge base | Real uploads and structured editors (hours, services and prices, FAQs, policies, staff). Extraction is the worker job below. Nothing is sent to a voice provider. |
| 8. Phone setup | **Stub.** Stores mode, carrier, current number, and notes. No number search, purchase, or forwarding test. |
| 9. Compliance | Real fields, no review queue. AI disclosure is forced on. Recording notice defaults on. `dental` and `medical_office` auto-check `healthcareSensitive` (editable). If that flag is on, Submit requires `complianceReviewDone` and a short `complianceReviewNote`. Recall consent is stored and not acted on. |
| 10. Client portal access | Real. Required email, stored on the client as `portalOwnerEmail`. Submit does not send the invite. |
| 11. Review & Submit | Real summary of stored fields. The "agent prompt" block is a **stub**: static text that the prompt is generated in Phase 2, not a generated prompt. Submit does the writes below. |

Submit, in one transaction:

1. Strict-validate the full draft.
2. Copy fields onto `Client`, set `wizardSubmittedAt`, keep `status = lead`.
3. Mark the knowledge version `submitted`.
4. Insert `ChangeLog` `wizard.submitted`.

Submit does not send the portal invite, and it does not create a provisioning job, a Stripe customer, a phone number, or an agent. The admin client detail page has a "Send portal invite" button that calls the existing `createInvite` flow for `client_owner` using `portalOwnerEmail`.

Discard (unsubmitted drafts only) archives the lead client and draft, deletes uploaded objects, and writes `ChangeLog` `wizard.discarded` in that same transaction as the archive. Object deletes run after the transaction commits so a failed log does not leave the client archived without a record. If an object delete fails, the archive still stands and the error is logged without the file body.

---

## 5. Knowledge base files

### Where

Local dev: directory `.data/uploads`, gitignored. The app and worker both mount or share that path via `UPLOAD_DIR`.

Staging and production: **Cloudflare R2**, one private bucket per environment (`alinstra-staging`, `alinstra-production`). The bucket is never public.

Access keys live in env (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`). They are not stored on the document row. Dev sets `STORAGE_DRIVER=local`. Production refuses `local`.

### Limits (approved)

- Types: PDF, DOCX, TXT, CSV. Checked by extension and by sniffed type, not the browser's `Content-Type` alone.
- 10 MB per file. 50 MB total per client. 25 documents per knowledge version.
- Enforced on the server for both the local driver and R2. The browser cannot raise them.
- Filename stored for display. The object key is generated: `clients/{clientId}/knowledge/{documentId}`. No user-supplied path segments.

Next.js server actions cap bodies around 1 MB, so the file bytes do not go through a server action. The browser asks for an upload slot (JSON). Local dev returns an app `PUT` route. R2 returns a presigned `PUT` (short-lived). A confirm request then checks the stored size and type again before enqueueing extraction.

Downloads never use a public object URL. An authenticated route checks the repository (`clientId`) and then either streams the bytes or redirects to a presigned GET that expires in 5 minutes or less. An isolation test proves client A cannot read client B's document.

### Extraction

Upload writes the object, then inserts `KnowledgeDocument` (`extractionStatus = pending`) and enqueues `extract-knowledge-text`.

The worker reads the object, extracts text, and saves `extractedText`:

- PDF: `unpdf` (pdf.js, no native binaries, works on Railway's image)
- DOCX: `mammoth` (plain text)
- TXT: UTF-8. Reject if the bytes are not valid text.
- CSV: UTF-8 text kept as text, plus a row count in `extractionError` left null on success. No formula evaluation.

Each job has a 60 second timeout. Extracted text is capped at 200,000 characters; the rest is dropped and `extractedTextTruncated` is set. A malformed or oversized DOCX (it is a zip) fails that document's extraction. It does not crash the worker. Failure sets `extractionStatus = failed` and a short message. The wizard can continue. Extracted text is not sent to Sentry.

Delete removes the DB row and the object. A client user cannot delete another client's object because the repository checks `clientId` before the storage call.

---

## 6. Screens

Admin, behind the existing 2FA gate:

- `/admin/clients` — name, industry, status, plan name, wizard step, a "Wizard submitted" badge when `wizardSubmittedAt` is set, link to continue or open. Archived leads are hidden.
- `/admin/clients/[id]` — Overview (business, plan and overrides, coverage, features, compliance), Knowledge (read-only after submit), Users, Change log, "Send portal invite", and "Discard draft" while the wizard is unsubmitted. No Provisioning, Agent, Phone, Calls, or Usage tabs.
- `/admin/plans` — edit the catalog

Client portal, using `requireUser` and the role already on the session:

- Home — for `client_owner` and `client_staff`: business name, plan name, minutes included (effective), and zeros for calls, appointments, and messages, labeled as not connected yet. Admin home stays the Phase 0 tools.
- Team — `client_owner` only: existing staff invite for their own `clientId`. Staff do not see it.
- My Business — `client_owner` and `client_staff`, read-only: contact, hours, services, FAQs, policies, staff directory. No edit controls. Quick updates are Phase 2.

`client_staff` cannot open admin routes. `client_owner` cannot open another client's id even by typing the URL (repository returns null, page 404s).

---

## 7. Worker

One new job, `extract-knowledge-text`, payload `{ documentId }` validated by Zod in `@alinstra/queue`.

Move each job into its own file:

- `apps/worker/src/jobs/send-invite-email.ts`
- `apps/worker/src/jobs/send-password-reset-email.ts`
- `apps/worker/src/jobs/extract-knowledge-text.ts`

`apps/worker/src/index.ts` only starts the worker and dispatches by job name. It does not import `prisma`.

Narrow the ESLint `no-restricted-imports` exception from `apps/worker/src/index.ts` to those three job files. The health route exception stays. Each job file keeps the comment pointing at `docs/DECISIONS.md`.

---

## 8. Env and docs when this is implemented

`.env.example`: `STORAGE_DRIVER`, `UPLOAD_DIR`, and the `S3_*` variables. `docs/DECISIONS.md` records R2 (or whichever bucket you pick), the file limits, and that wizard submit does not provision. `docs/STATUS.md` gets a Phase 1 section only after the work lands.

---

## Decided

1. Cloudflare R2, one private bucket per environment.
2. File limits: 10 MB per file, 50 MB per client, 25 files per version.
3. Extra configuration-change fee seeds at $49, editable on `/admin/plans`.
4. Healthcare blocks Submit until `complianceReviewDone` is checked and `complianceReviewNote` is filled. `dental` and `medical_office` auto-check `healthcareSensitive`; the admin can change it.
5. Industry enum is the list in the data-model section above.
6. Submit stores `portalOwnerEmail` and does not send the invite. Client detail has "Send portal invite".
7. Status stays `lead`. The list shows "Wizard submitted" when `wizardSubmittedAt` is set.
8. Street address is optional.
9. Default timezone is `America/New_York`.
10. `client_staff` can see My Business, read-only.
11. Uploads bypass the server-action body cap. Downloads are authenticated. Extraction is time-boxed, length-capped, and fails closed on a bad DOCX. Unsubmitted drafts can be discarded.
