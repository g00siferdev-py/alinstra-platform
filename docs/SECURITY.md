# Security

How Alinstra handles customer data, who can see it, who else touches it, and what to do if it leaks. Written from the code as of Phase S (branch `phase-s-security`). When the code changes, change this file in the same pull request.

This is an engineering document, not legal advice. Items marked **confirm with counsel** need a lawyer's answer before we state them to a client as fact.

Related runbooks: [KEY-ROTATION.md](./KEY-ROTATION.md), [RESTORE.md](./RESTORE.md), [DEPLOYMENT.md](./DEPLOYMENT.md). Contract outline: [DPA-outline.md](./DPA-outline.md).

## 1. What we protect

Alinstra answers a client's phone calls with an AI receptionist. The sensitive material is what callers say and who they are: transcripts, summaries, recordings, caller phone numbers, and messages left for the business. We also hold the staff cell numbers calls get transferred to, and the account details of the people who sign in.

"Encrypted" below means application-level AES-256-GCM through `@alinstra/crypto`, with keys held only in environment variables (`ENCRYPTION_KEY` = k1, `ENCRYPTION_KEY_V<N>` for later keys). "Provider-managed" means the vendor's own disk or transport encryption, which we rely on but do not control.

## 2. Data inventory

### 2.1 Postgres (Railway)

| Data | Table / column | Encrypted? | Retention | Who can see it |
| --- | --- | --- | --- | --- |
| Call transcript | `call_record.transcriptCipher` | Yes, app-level | Client's `callRetentionDays` (default 90, range 7 to 365), then nulled by the nightly `purge-calls` job. Archived clients: everything is purged 30 days after service ends | Admin; client owner; staff only if `canViewCalls` is set |
| Call summary | `call_record.summaryCipher` | Yes | Same as transcript | Same |
| Caller phone number (full) | `call_record.callerE164Cipher` | Yes | Same as transcript | Admin; owner; staff with `canViewCalls` (staff otherwise see the masked form) |
| Raw webhook events | `call_record.rawEventsCipher` | Yes | Same as transcript | Admin only (raw view) |
| Caller number (masked), duration, outcome, sentiment, cost, flags, recording status | `call_record.*` (plain) | No, by design (no full number, no content) | Duration, outcome, sentiment and cost are kept after the purge for reporting. Flags are cleared by the purge | Admin; owner; staff |
| Messages left for the business: caller name, callback number, body | `client_message.callerNameCipher`, `callbackNumberCipher`, `bodyCipher` | Yes | Client's `callRetentionDays` (default 90, range 7 to 365). The nightly `purge-calls` job deletes the row. Same 30-day archived-client rule as call content | Admin; owner; staff |
| Callback number (masked, e.g. `(423) ***-0198`) | `client_message.callbackMasked` | No, by design | Same as the message | Admin; owner; staff |
| Legacy plaintext message columns (`callerName`, `callbackNumber`, `body`) | `client_message` | **No.** Null for new rows; older rows stay plaintext until the encrypt backfill has run on that environment | Same as the message | Same |
| Staff transfer numbers | `transfer_target.e164Cipher` (+ `e164Masked` for lists) | Yes (legacy `e164` is plaintext until the backfill runs) | Until the owner or admin removes it | Admin; owner (masked in lists); decrypted only to sync the agent and to place a transfer |
| Staff notes | `knowledge_base.staffCipher` (legacy `staff` JSON until the backfill runs) | Yes | Per knowledge version, until the client is deleted | Admin; owner; staff (read-only) |
| Uploaded document text | `knowledge_document.extractedTextCipher` (legacy `extractedText` until backfilled) | Yes | Until the document or client is deleted | Admin; owner; the text is also placed in the receptionist's prompt |
| Business hours, services, FAQs, policies, notices | `knowledge_base.*` JSON | No. This is what Ava tells callers, so it is public to callers anyway | Until the client is deleted | Admin; owner; staff (read-only) |
| Invite tokens | `invite.tokenCipher` (+ `tokenHash`) | Yes | Until the invite row is deleted with its client | Admin (to resend); never shown in lists |
| Client profile and contacts (business name, contact name, phone, email, address, owner email, notes) | `client.*` | No | Until the client is deleted | Admin; owner (own client) |
| Billing identifiers and status | `client.stripeCustomerId`, `stripeSubscriptionId`, plan and price fields | No | Until the client is deleted | Admin; owner |
| User accounts (name, email, role) | `user` | No | Until the user is deleted | Admin; owner (own team) |
| Password hashes | `account.password` | Hashed by Better Auth (not reversible); not our cipher | With the account | Nobody (not displayed) |
| Two-factor secret and backup codes | `twoFactor.secret`, `backupCodes` | Encrypted by Better Auth with `BETTER_AUTH_SECRET` | With the account | Nobody (not displayed) |
| Sessions (token, IP, user agent) | `session` | No | Until expiry or sign-out | Nobody in the UI |
| Access audit trail (who read what) | `access_log` | No. Ids, role, IP, user agent (200 chars) and list counts only, never call or message text | **400 days**, nightly purge | Admin (`/admin/access`, per-client history); owner sees own client's rows ("Who viewed your calls") with staff by name and Alinstra admins as "Alinstra support" |
| Sign-in attempts | `login_event` | No. Normalized email, IP, `/24` (IPv4) or `/48` (IPv6) prefix, user agent (200 chars), success flag; never a password | **180 days**, nightly purge | Admin (database level; there is no UI page today) |
| Change history | `change_log` | No, but phone numbers are masked before they are written | Until the client is deleted | Admin; owner (own client) |
| Owner quick updates and change requests | `quick_update.payload`, `change_request.description` | No; phone numbers masked in `payload`. `description` is free text the owner typed | Until the client is deleted | Admin; owner |
| Agent configuration and prompt text | `agent_config` | No. The prompt is what the receptionist is told | Versions kept until the client is deleted | Admin; owner (summary) |
| Onboarding interview | `interview_session.state` | No. Admin-run; business details, not caller data | Until the client is deleted | Admin only |
| Billable call minutes (ledger for Stripe meter and reports) | `usage_record` | No. Ids, timestamps, duration, billable minutes, cost cents, meter report state — **no transcript or caller content** | **400 days**, or longer if accounting requires it (**confirm with accountant**). Nightly purge not wired yet | Admin; owner (aggregated on billing/reports); never decrypted content |
| Sales leads | `lead` (business, name, phone, email, notes) | No | **No automatic purge** (see section 8) | Admin only |
| Stripe webhook ids | `stripe_event` | No | Indefinite; ids only | Admin (database level) |
| Settings, backup status | `app_setting` | No; no secrets | Indefinite | Admin |

### 2.2 R2 (Cloudflare object storage, private bucket)

| Data | Where | Encrypted? | Retention | Who can see it |
| --- | --- | --- | --- | --- |
| Call recordings | `clients/<clientId>/calls/...` | Provider-managed at rest only. **Not app-encrypted** | Deleted by the same nightly purge as the transcript | Authenticated playback through `/api/calls/[id]/recording` (admin, owner, staff with `canViewCalls`); rate-limited and written to `access_log`. The bucket has no public access |
| Uploaded knowledge documents (PDF, DOCX, and similar) | `clients/<clientId>/...` | Provider-managed at rest only | Until the document or client is deleted | Authenticated download through `/api/knowledge/documents/[id]` (access-logged, rate-limited) |
| Database backups | `backups/<APP_ENV>/YYYY/MM/DD/*.dump.enc` | Yes: AES-256-GCM, key from `BACKUP_PASSPHRASE` (scrypt, salt per file). Independent of the app keys | **30 days**, deleted after each successful backup | Anyone with the R2 credentials can download the file but cannot read it without the passphrase (worker env and offline copy) |

### 2.3 Redis (Railway)

| Data | Encrypted? | Retention | Who can see it |
| --- | --- | --- | --- |
| BullMQ job payloads (invite and reset emails, admin notices, sign-in notices, recording ids, **message emails**) | No | Message, invite, password-reset and sign-in-notice jobs are removed on completion (`removeOnComplete: true`); failed copies are kept for 24 hours. Admin notices and other jobs keep the last 100 completed and failed. Message email payloads hold **ids and recipient addresses only** — the worker loads and decrypts the message body | Anyone with Redis access (engineering only) |
| Rate-limit and alert counters, lockout counters, recording-dedupe keys | No. Keys can contain an email address or IP address | Seconds to hours (TTL on every key) | Engineering only |

Message email jobs no longer carry caller name or body through Redis. The worker loads the row by `messageId` and decrypts it with the app keyring before sending.

### 2.4 Third-party systems

| Vendor | What it receives | Encrypted? | Retention | Who can see it |
| --- | --- | --- | --- | --- |
| Retell AI (voice) | Live call audio; transcripts, recordings and analysis it generates; the agent prompt and knowledge text; staff transfer numbers (decrypted to sync the agent); the caller's number | In transit (TLS); at rest is Retell's own | **Confirm Retell's retention and deletion settings and sign their DPA.** Our nightly purge deletes our copy; it does not delete Retell's | Retell staff per their policy; Alinstra admins through Retell's dashboard |
| Resend (email) | Recipient addresses and email content: invites, password resets, sign-in notices, admin notices, **message emails (caller name and message body)** | TLS in transit; Resend's own at rest | Per Resend's log retention (**confirm**) | Resend; the recipient's mailbox |
| Sentry (errors) | Error reports with ids, counts and stack traces. `sendDefaultPii` is off; `scrubSentryEvent` strips request bodies and known sensitive fields | TLS | Per Sentry project settings (**confirm**) | Engineering |
| Stripe (billing) | Client business name, contact email, plan and usage; never call content | TLS | Per Stripe | Engineering and Stripe |
| OpenRouter (AI text, admin interview feature) | The admin's onboarding interview text about a business. Off when `TEXT_API_KEY` is unset. No caller data by design | TLS | Per OpenRouter and the model provider (**confirm**) | Engineering and the provider |
| Railway (hosting, Postgres, Redis, workers) | Everything above except R2 objects | Provider-managed disk encryption (**confirm**) | While the service exists | Engineering |
| Cloudflare (DNS and R2) | DNS records (DNS-only, so web traffic does not pass through Cloudflare); R2 objects above | TLS; R2 encrypts at rest | While stored | Engineering |
| GitHub (source, CI) | Source code and CI logs. No customer data; tests use fake secrets and data | TLS | n/a | Engineering |

### 2.5 What never leaves the system

Full caller numbers, transcripts, message text and transfer numbers are not written to application logs, Sentry events, or `ChangeLog`/`QuickUpdate` JSON (numbers are masked there). Logs and Sentry carry ids and counts. Message email content is decrypted only in the worker at send time and is not stored in Redis job history.

## 3. Access controls

**Roles.** `admin` (Alinstra staff, no client), `client_owner`, `client_staff`. Every tenant-scoped repository takes the caller's client from the session, and each has an isolation test (client A cannot read client B).

**Sign-in.**
- Passwords are hashed by Better Auth. Login lockout and per-IP/per-email limits apply, plus password-reset limits (5 per hour per email, 20 per hour per IP).
- Admin accounts must enroll two-factor at first login and cannot turn it off. Services, Access and the other sensitive admin pages require a verified two-factor session.
- Archived clients cannot sign in.

**Call content.**
- Owners and admins can open transcripts and recordings. Staff only if the owner grants `canViewCalls`.
- Raw webhook events are admin only.
- Recording playback is authenticated, rate-limited (120 requests per 10 minutes per user) and never exposes a storage or provider URL. Document download is limited to 60 per 10 minutes per user.

**Audit.** Every transcript view, recording stream, raw view, message list and view, and document download writes an `access_log` row (400 days). Owners can see who viewed their client's calls. Bulk reading (more than 50 transcript or recording rows by one actor in 10 minutes) sends an admin notice and a Sentry warning, once per actor per hour.

**Sign-in alerts.** `login_event` records every attempt (180 days). A successful sign-in from a network not seen in 90 days emails the admins, and emails client owners a "New sign-in" notice. A locked-out admin account sends an admin notice.

**Machine-to-machine.** Retell routes verify `x-retell-signature` over the raw body and are limited to 300 requests per minute per IP. Stripe webhooks verify the Stripe signature.

**Secrets.** Provider keys, `ENCRYPTION_KEY*`, `BETTER_AUTH_SECRET` and `BACKUP_PASSPHRASE` live only in Railway variables and an offline copy. `BACKUP_PASSPHRASE` is on the worker only. Production startup refuses placeholder or malformed keys. Staging and production use separate keys and separate projects.

**Engineering access.** Anyone who can open the Railway project, the R2 bucket, Redis, or the database can reach data above the application's role checks. Keep that group small, use individual accounts with two-factor on every vendor, and review it in the quarterly checklist (`docs/SECURITY-CHECKLIST.md`, when Part 6 lands).

**Impersonation.** Admin impersonation is flagged on `ChangeLog` and `access_log` rows (`impersonating`).

## 4. Backups and recovery

Encrypted nightly dumps, 30 days, in R2 (section 2.2). Restore steps and drill: [RESTORE.md](./RESTORE.md). The Services page shows the last successful backup and turns red after 36 hours. Backups hold ciphertext columns as ciphertext; restoring needs the same `ENCRYPTION_KEY*` values as the app that wrote them.

## 5. Breach runbook

A breach means personal data was, or may have been, accessed, copied, altered or lost by someone who should not have it: a leaked key or credential, a compromised admin or client account, a misdelivered email, a vendor incident, a stolen laptop, a bug that showed one client another's data.

Write down times as you go (UTC, to the minute). Put no plaintext customer data in the incident notes, chat, or tickets. Use ids.

### 5.1 Contain (first hour)

1. Name an incident lead. Start a private incident log (who, what, when).
2. Stop the access:
   - Compromised user: delete their sessions (`session` rows for that `userId`) and reset the password. For an admin, treat as the highest severity.
   - Leaked vendor key (Retell, Stripe, Resend, R2, OpenRouter, Sentry): rotate it at the vendor and update Railway.
   - Leaked app secret (`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY*`, `BACKUP_PASSPHRASE`): go to 5.2.
   - Code bug leaking data: disable the route or roll back the deploy first, then fix.
   - Compromised Railway or Cloudflare account: change the password, revoke tokens, and review the audit log of that vendor.
3. Preserve evidence: do not delete `access_log`, `login_event`, `change_log`, Railway logs, or Sentry events. Take a copy of the relevant rows (ids and times only) into the incident log.

### 5.2 Rotate keys

- **App encryption keys** (`ENCRYPTION_KEY*`): follow [KEY-ROTATION.md](./KEY-ROTATION.md). If k1 itself was exposed, rotating is not enough on its own: anyone who has a copy of the database or a backup and the old key can still read data encrypted under it. Treat the data in those copies as exposed.
- **`BACKUP_PASSPHRASE`:** set a new one on the worker. New backups use it; old backups stay under the old passphrase for up to 30 days. If the old passphrase and a backup file were both exposed, treat that backup's data as exposed.
- **`BETTER_AUTH_SECRET`:** rotating it signs everyone out and invalidates stored two-factor secrets (they are encrypted with it). Admins will need to re-enroll. Plan for this before you do it.
- **Vendor keys:** rotate at the vendor, then in Railway. Retell: also check the webhook signing key. Stripe: roll the secret and webhook secret.

### 5.3 Assess scope

Answer: which clients, which data types, which time window, and was it read or only reachable?

- `access_log` (`/admin/access`, filter by actor, client, action, date range; CSV export): what an application user read, with IP and user agent. Retained 400 days.
- `login_event`: sign-in attempts by email and network prefix, successes and failures, 180 days. Look for unfamiliar `ipPrefix` values and bursts of failures before a success.
- `change_log`: edits, including by admins and impersonation.
- Railway, Cloudflare R2 and Resend logs for activity outside the app (direct database, bucket, or email access).
- Remember what `access_log` cannot show: reads straight from the database, Redis, R2, a backup file, or a vendor dashboard do not appear in it. If those were reachable, scope by what was reachable, not by what was logged.
- Use the data inventory (section 2) to decide what an attacker would have seen in plaintext versus ciphertext. Encrypted columns are not exposed if the keys were not.

Record the result: confirmed breach / no breach / cannot rule out. If you cannot rule out unauthorized access to personal data, treat it as a breach for notification.

### 5.4 Notify affected clients

- **Within 72 hours of confirming a breach**, tell each affected client (the controller). Do not wait to finish the investigation: send what you know, then follow up.
- Send it from a person, by email to the client's owner and a phone call for anything involving caller content. Keep a copy.
- Say plainly: what happened, which of their data types and which time window, what we have done, what they should do, who to contact, and when the next update comes. Do not include plaintext customer data in the message.
- The DPA ([DPA-outline.md](./DPA-outline.md)) fixes the contractual notice period and content. Until a signed DPA says otherwise, 72 hours is our commitment.
- Clients, as controllers, normally decide whether to notify their own callers and regulators. Offer the evidence they need (the `access_log` CSV for their `clientId`, the time window).

### 5.5 State and other legal deadlines

Breach-notification duties differ by state and by the type of data (phone numbers alone may be treated differently from transcripts that include health or financial details, and clients in regulated sectors may have their own rules). Some states put duties on the data owner and others on the service provider, and some set short fixed deadlines.

**Confirm current Tennessee and other state requirements with counsel.** Do not quote a statute or a number of days to a client from memory. Before any incident, have counsel give us a one-page table of: states we have clients in, who must notify whom, what triggers it, the deadline, and whether a regulator (for example a state attorney general) must be told. Put that table here once we have it.

Healthcare clients (dental, medical offices) may be subject to rules we do not currently serve under; see [future-healthcare-tier.md](./future-healthcare-tier.md). Ask counsel about any breach that touches those clients before replying.

### 5.6 Recover

- Close the hole, redeploy, and rotate anything that was exposed.
- If data was altered or lost, restore from backup ([RESTORE.md](./RESTORE.md)) into a new database and compare before repointing.
- Watch `/admin/access` and `login_event` closely for 30 days.

### 5.7 Post-incident review

Within 7 days of closing the incident, write a short review in this repo (`docs/incidents/YYYY-MM-DD-title.md`, ids only, no customer text):

1. Timeline (detection, containment, confirmation, notification, recovery).
2. Root cause and what was exposed (use the inventory).
3. What worked and what did not (did `access_log` and `login_event` answer the questions? did alerts fire?).
4. Corrective actions with owners and dates.
5. Updates needed to this file, the runbooks, and the checklist.

## 6. Reporting a problem

Anyone who suspects a leak or sees data they should not: tell Daniel immediately, by phone if possible. Do not investigate by opening more customer data than you need. Add a public security contact address to the website once one exists.

## 7. Verification

The controls above are covered by tests in the repo: tenant isolation (`packages/db`), access-log writes at every read point, login events and alerts (`packages/auth`), rate limits, key versioning and rotation (`packages/crypto`, `packages/db/scripts`), and the backup round trip with a tamper test (`apps/worker`). The quarterly checklist (Part 6 of `docs/phase-s-plan.md`) adds the routine reviews.

## 8. Open items (decisions for Daniel and counsel)

1. **Messages follow call retention.** `client_message` rows are deleted by the nightly purge once they are older than the client's `callRetentionDays` (default 90). State that in the DPA.
2. **Message emails still reach Resend in plaintext.** The Redis job now carries only the message id; the worker decrypts before send. Resend and the recipient's mailbox still hold the text. Options: send a "you have a new message, open the portal" email with no body; or accept and disclose it.
3. **Recordings and uploaded documents are not app-encrypted** in R2 (provider-managed encryption only). Encrypting objects before upload would remove that gap but changes playback and the worker; not scheduled.
4. **Retell, Resend, Sentry and OpenRouter retention** must be confirmed against each vendor's current terms, and each vendor's DPA signed where one exists.
5. **Leads have no purge** and sit in plaintext. Decide a retention period.
6. **Legacy plaintext** columns for messages, transfer numbers, staff notes and document text stay in the schema until a later phase drops them, after the backfill is verified on staging and production. Check "Plaintext still present" is 0 on both before relying on the inventory above.
7. **Breach law table** from counsel (section 5.5).
8. **`login_event` has no admin screen.** Assessment is by database query today.
