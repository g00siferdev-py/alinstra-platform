# Data Processing Addendum: outline for counsel

**This is an outline for a lawyer to turn into a contract. It is not legal text, and nothing here should be sent to a client as a commitment until counsel has reviewed it.** Facts come from the code as of Phase S. Items in **[COUNSEL]** need a legal answer; items in **[DANIEL]** need a business decision.

Technical detail lives in [SECURITY.md](./SECURITY.md). Section numbers below refer to it.

## 0. Questions to settle first

- Is "controller and processor" the right framing for each state and sector we serve? Some privacy laws use other terms (business and service provider). **[COUNSEL]**
- Which states are our clients in, and which of their rules apply to us (breach notice, call recording, telemarketing, privacy rights)? **[COUNSEL]**
- Do any clients (dental, medical offices) handle protected health information? We do not currently offer a healthcare tier ([future-healthcare-tier.md](./future-healthcare-tier.md)). Should the DPA exclude it expressly, or should those clients be refused until a healthcare agreement exists? **[COUNSEL]**
- Does this attach to the main customer agreement (order of precedence), and do we have one yet? Our site's Terms and Privacy pages say "Coming soon". **[COUNSEL]**

## 1. Parties and roles

- **Client** (the business that signs up) is the **controller**: it decides why and how callers' personal data is collected, and it owns the relationship with its callers.
- **Alinstra** is the **processor**: it handles that data only to provide the answering service, on the client's documented instructions.
- Alinstra as controller for its own purposes (billing, account security, product analytics, sales leads): list those data and purposes separately. **[COUNSEL]**
- The caller is the data subject. Callers have no contract with Alinstra.
- Describe the processing in an annex:
  - Subject matter and duration: the answering service, for the contract term plus the deletion period.
  - Categories of data subjects: callers; the client's staff and owner (portal users).
  - Categories of data: caller phone number; voice and recording; transcript and summary; name and message text the caller chooses to give; call metadata (time, duration, outcome, sentiment, cost); staff transfer numbers; client contact and account details (SECURITY.md section 2).
  - Special categories: callers may volunteer sensitive information (health, financial). The service does not ask for it, but cannot prevent it. How should the DPA treat this? **[COUNSEL]**
- Instructions: the client's setup choices and later edits in the portal are the documented instructions. Alinstra will not use call content to train models or for any purpose other than delivering the service to that client. Confirm this is true for every subprocessor before we promise it. **[DANIEL]** **[COUNSEL]**

## 2. Processor duties (to be drafted)

- Process only on instructions; tell the client if an instruction appears unlawful.
- Confidentiality commitment for staff with access (Alinstra admins, contractors).
- Assist the client with caller rights requests (access, deletion) and with their own regulatory duties. Note what we can actually do: find a call by number or date, export it, delete it. Today there is no self-service caller lookup; requests go through Alinstra admins. **[DANIEL]**
- Audit: what documentation we give a client on request (SECURITY.md, access history) and whether we allow on-site audits. The owner portal already shows "Who viewed your calls". **[COUNSEL]**
- Return of the controller's attention to any request received directly from a caller or regulator.

## 3. Subprocessors

List by name, purpose and data touched, with a way to object to changes. Starting list (confirm each against its current terms, and sign each vendor's DPA where one exists):

| Subprocessor | Purpose | Data | Location (confirm) |
| --- | --- | --- | --- |
| Retell AI | Voice agent, telephony, call transcription, recording | Call audio, transcripts, recordings, caller number, agent prompt and knowledge, staff transfer numbers | **[confirm]** |
| Railway | Hosting; Postgres and Redis | All platform data (call content encrypted at the application level) | US **[confirm region]** |
| Cloudflare | R2 object storage (recordings, documents, encrypted backups); DNS | Recordings and documents; encrypted backups | **[confirm]** |
| Resend | Transactional email | Recipient addresses; invite, reset and notification emails; **message emails include caller name and message text** | **[confirm]** |
| Sentry | Error monitoring | Ids, counts, stack traces; request bodies and known sensitive fields stripped | **[confirm]** |
| Stripe | Billing | Client business and contact details, plan and usage | **[confirm]** |
| OpenRouter and the model provider it routes to | Admin onboarding interview (feature off when unset) | Business details typed by Alinstra staff; no caller data | **[confirm]** |
| GitHub | Source code and CI | No customer data | n/a |

- Mechanism: general written authorization with a published list, notice to clients of additions (how many days?), and a right to object or terminate. **[COUNSEL]**
- Flow-down: each subprocessor bound to equivalent obligations. Alinstra remains responsible for them.
- Where do we publish the list (a page on the website, linked from the DPA)? **[DANIEL]**
- Cross-border transfers: if any subprocessor processes outside the US, what do we need? **[COUNSEL]**

## 4. Security measures

Refer to [SECURITY.md](./SECURITY.md) as an annex, rather than copying it, so the annex can be updated without re-signing. Headline measures it supports:

- Application-level AES-256-GCM encryption of transcripts, summaries, raw call events, full caller numbers, message contents, staff transfer numbers, staff notes, uploaded document text and invite tokens, with versioned keys and a documented rotation runbook (section 2; [KEY-ROTATION.md](./KEY-ROTATION.md)).
- Private storage; authenticated and rate-limited access to recordings and documents.
- Role-based access, per-client data isolation (tested), call content visible to staff only when the owner allows it, admin two-factor.
- Read-access audit log retained 400 days, visible to the client owner; bulk-read and new-network sign-in alerts; sign-in attempt log retained 180 days.
- Signed and rate-limited webhooks; login lockout and password-reset limits.
- Encrypted nightly database backups kept 30 days, with a documented restore procedure ([RESTORE.md](./RESTORE.md)).
- Candid limits to disclose or fix before signing: recordings and uploaded documents rely on provider-managed encryption; message emails carry caller name and text; messages and leads have no automatic retention (SECURITY.md section 8). **[DANIEL]** **[COUNSEL]**
- Do not promise certifications (SOC 2, ISO 27001, HIPAA) we do not hold.

## 5. Breach notice

- Alinstra notifies the client's designated contact **without undue delay and within 72 hours of confirming** a breach affecting the client's data (our internal commitment; SECURITY.md section 5.4). Does the contract say "confirming" or "becoming aware"? Counsel to choose; the shorter trigger is a bigger commitment. **[COUNSEL]**
- Content of the notice: nature of the incident, data and time window affected, likely consequences, steps taken, a contact, and follow-up updates.
- Evidence we can supply: the client's own `access_log` export and sign-in records for the period.
- Who notifies callers and regulators: the client, as controller, unless the law puts it on us. Alinstra cooperates and bears (or shares) the cost under terms to be set. **[COUNSEL]**
- State deadlines: **confirm current Tennessee and other state requirements with counsel.** Do not state statute deadlines in the DPA from our notes. The DPA's period must not be longer than any shorter statutory deadline that applies to a client.
- Client contact for notices: collect and keep current in the portal. **[DANIEL]**

## 6. Retention and deletion

- **During the term:** calls (transcript, summary, caller number, raw events, recording) are deleted by the nightly purge after the client's retention period. The owner chooses it, 7 to 365 days, default 90. Duration, outcome, sentiment and cost are kept for reporting. Is that acceptable as non-personal reporting data, or should it be deleted too? **[COUNSEL]**
- Messages and transfer numbers: kept until deleted or the client leaves. Messages have no automatic purge today. Decide a rule and write it in. **[DANIEL]**
- Audit data: `access_log` 400 days; `login_event` 180 days.
- **On termination:** the client's service ends; calls are purged 30 days after service ends (the existing archived-client grace period), and the account data deleted on a stated schedule. Decide the schedule, whether there is a data export first (format and period), and whether deletion is certified in writing. **[DANIEL]** **[COUNSEL]**
- Backups: encrypted, 30-day rolling retention. Deleted data can remain in backups for up to 30 days and is not restored after deletion except in disaster recovery. State this. **[COUNSEL]**
- Subprocessors: deletion at Retell, Resend, Sentry, Stripe and others is on their schedules. Our purge does not delete Retell's copy of a call. Confirm Retell's retention settings and whether we can set them or delete by call id before promising an end-to-end schedule. **[DANIEL]**
- Legal holds and records we must keep (billing, tax): carve-out. **[COUNSEL]**

## 7. Recording and consent responsibilities

Who must do what, as a division of responsibility. **[COUNSEL]** to confirm all of it, especially for two-party consent states and for callers outside the client's state.

- The **client** is responsible for lawful basis and consent to record calls to its numbers, including in states that require all-party consent, and for any notices on its own website, voicemail or signage.
- **Alinstra** provides the tools: an AI disclosure (always on; the assistant says it is a virtual assistant when asked, and optionally up front), and a recording notice that is on by default. The client can turn the notice off in setup; the DPA should say that doing so is the client's decision and risk, and that it warrants it has any consent required. **[COUNSEL]**
- The client decides retention within the allowed range and can ask Alinstra to delete a specific call.
- Our public Legal page already states that calls may be recorded for message accuracy and quality and that the business controls retention. Align the wording of the DPA, Terms and that page. **[COUNSEL]**
- Calls transferred to a staff member: who is responsible for telling the staff member or the caller that the call may be recorded? **[COUNSEL]**
- Industry rules (health, legal, financial): the client confirms the service is appropriate for its calls. Wizard setup already has a "healthcare-sensitive" flag and a compliance review note; say how those feed into acceptance of the client. **[COUNSEL]**

## 8. Follow-up calls consent attestation

For clients using the Follow-up (recall) add-on, where the business's customers are contacted by phone. (Plans carry recall prices, but check what is actually built before describing the mechanics to counsel.) Today the wizard has a `recallConsent` checkbox, and the Legal page says clients "attest that each customer called has given prior express consent to be contacted by phone". That is a statement of intent, not yet a contract term. Outline of the attestation to draft:

- The client represents and warrants that every person it asks Alinstra to contact has given the consent the law requires for that kind of call (including consent for automated or artificial-voice calls, and for text messages if we ever offer them), and that it can show proof of that consent on request.
- The client will not provide numbers on do-not-call lists and is responsible for scrubbing against national and state lists. Does Alinstra offer scrubbing, or is it entirely the client's job? **[DANIEL]**
- Calling hours, caller identification, the AI disclosure at the start of the call, and how a person opts out. Which of these does Alinstra enforce in the product? (Do not claim enforcement that does not exist.) **[DANIEL]**
- Alinstra may suspend follow-up calls where it suspects a consent problem or receives a complaint.
- Indemnity for claims arising from the client's failure to hold consent. **[COUNSEL]**
- Acceptance must be recorded: who accepted, when, and which version of the text. The checkbox today is stored in the client's `compliance` JSON, which does not record who or when beyond the change log. Decide whether to add a dated, versioned acceptance record before the add-on goes live. **[DANIEL]**
- Which federal and state rules apply to follow-up calls and to AI-voice calls specifically. **[COUNSEL]**

## 9. Other clauses for counsel

- Liability caps and carve-outs for data protection.
- Term, termination, and survival of confidentiality and deletion duties.
- Governing law and venue (Tennessee?). **[COUNSEL]**
- Changes to the DPA and to the subprocessor list.
- Insurance (cyber).
- Contact details for privacy questions on both sides.

## 10. Deliverables to give counsel

- This outline and [SECURITY.md](./SECURITY.md) (inventory and breach runbook).
- [KEY-ROTATION.md](./KEY-ROTATION.md) and [RESTORE.md](./RESTORE.md).
- A copy of the public Legal page text (`apps/web/src/app/(marketing)/legal/page.tsx`) and the wizard's compliance step wording.
- Vendor terms and DPAs for each subprocessor in section 3.
