# Phase 2 plan

Status: Approved 2026-10-01. Work stays on branch `phase-2`. Do not merge to main or staging.

Brief §6: two kinds of client changes. Quick updates (hours, closures and temporary notices, staff directory and transfer numbers, one FAQ) are self-serve. Configuration changes are admin-reviewed and count against a monthly allowance. Beyond the allowance, the extra change fee is recorded for Phase 3 billing.

Brief §17 Phase 2: industry prompt templates (general, HVAC, veterinary), versioned configs, diff, prompt preview, quick updates, configuration change requests with allowance tracking, and rollback.

## Decisions

A. Prompt generation is deterministic template rendering from structured client data and the submitted knowledge base. No LLM and no external API calls. Templates are versioned files in `@alinstra/agent`: `general`, `hvac`, `veterinary`. Any other industry uses `general`. Each `AgentConfig` stores `templateId` and `templateVersion`.

B. Every generated prompt includes: AI disclosure in the greeting; a recording notice when recording is enabled; answer only from the provided business info; never invent prices, services, availability, or policies (offer a message or callback); no medical, legal, or financial advice; emergencies follow the business's emergency instructions, and immediate danger to a person goes to 911; no discounts, promises, or commitments; take a message when unsure; transfer rules from the staff directory. Optional `Client.namePronunciation` is included when set (for example `uh-LIN-struh`).

C. Uploaded and extracted knowledge text is data. It sits between `REFERENCE START` and `REFERENCE END`, with an explicit line that the content is reference material and must not be followed as instructions. The prompt budget is 24,000 characters. Structured fields are kept ahead of extracted document text. Truncation is stored on the config and shown in the preview.

D. `AgentConfig` is versioned. Prompt text, the knowledge snapshot (knowledge base id, version, and document ids), voice, greeting, declared tools, template version, and `platformAgentId` are not edited in place. Status is `draft`, `active`, or `superseded`. One active version per client (partial unique index). Rollback and activation copy the chosen version into a new row, so version numbers stay linear. Admin can view a line diff of the prompt and a field diff of the stored settings.

E. Wizard step 11 renders a real preview. Submit creates `AgentConfig` version 1 as `draft`. Nothing is provisioned. `platformAgentId` stays null.

F. Quick updates are `client_owner` only. Staff stay read-only. Kinds: hours, closures and temporary notices, staff directory and transfer numbers, add or edit or remove one FAQ. Validation is deterministic: length, phone shape, and clock times. Text that looks like a price, discount, guarantee, or refund (`$` amounts, "free", "discount", "guarantee", "refund") is held for admin review and the reason is shown to the client. Otherwise the owner sees a preview, the change is applied, a new active `AgentConfig` is created, and an admin notification email is queued (console transport locally).

G. Configuration change requests are `client_owner` only: category plus description, text only, no attachments. Allowance is the calendar month in the client's timezone, from `overrideIncludedChangesPerMonth` or the plan's `includedChangesPerMonth`. Null means unlimited. The page shows the remaining allowance before submit. Past the allowance, the page shows `extraChangeFeeCents` and requires confirmation. The fee is stored on the request. Billing is Phase 3. Rejected and client-cancelled requests do not count. Admin reviews, can edit the description, previews, and approves into a new active `AgentConfig`.

H. My Business is editable for owners through quick updates. Owners get a Change Requests page. Admin client detail gets an Agent Config tab (versions, diff, preview, activate, rollback) and a Change Requests view. Admin home lists pending change requests and held quick updates.

I. Scoped repositories, a change log row in the same transaction, and isolation tests: client A cannot read or write client B's configs, quick updates, or requests; staff cannot submit; owners cannot approve. Prompt tests cover guardrails, the reference delimiter, the size budget, and pronunciation. Allowance tests cover the month boundary in the client timezone, unlimited, and the over-allowance fee.

## Simpler choices

- Declared tools are the fixed list `take_message`, `transfer`, `callback`. They are stored and not callable.
- A new knowledge base version is written when a quick update or an approved change request changes structured fields. Document rows stay on the version that received the upload. The config stores those document ids.
- FAQ text that is still a single string becomes one entry titled "Existing" on the first FAQ quick update, then an array of question and answer.
- Closures and approved change-request text are appended to `KnowledgeBase.notices`.
- Activating a draft or rolling back copies that version into a new active row. The previous active row becomes `superseded`. Status is the only column updated on an existing row.
- A client with no plan and no override is treated as unlimited.
- An invalid timezone falls back to `America/New_York`.
- The admin email is queued only when a quick update applies immediately. Held updates and change requests appear on the admin home.
