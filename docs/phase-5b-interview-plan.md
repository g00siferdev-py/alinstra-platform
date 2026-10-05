# Phase 5b-i — Interview wizard

Status: shipped on branch `phase-5b-interview` (from `9dc57aa`). Chat-style AI onboarding that fills the existing `WizardPayload` / `WizardDraft`. Nothing downstream (render, provisioning, holds) changes. Industry-neutral by default; deeper banks for HVAC and veterinary. Feature off when `TEXT_API_KEY` is absent.

## Spec source

User Phase 5b-i brief (Oct 2026).

## Decisions (this plan)

1. **Server-side only.** The browser never talks to the model. One turn per server action, always scoped to a specific client's wizard (`InterviewSession.clientId` + optional `draftId`).
2. **One OpenAI-compatible HTTP client.** `httpText()` posts to `{TEXT_API_BASE}/chat/completions` with bearer auth. Same code path for OpenRouter, Ollama Cloud, OpenAI, and Anthropic's OpenAI-compatible endpoint. No vendor SDKs.
3. **Env defaults + optional DB overrides.** Env: `TEXT_API_BASE` (default OpenRouter), `TEXT_API_KEY` (required to enable), `TEXT_MODEL` (default `moonshotai/kimi-k2.5`), `TEXT_FALLBACK_MODEL`, token budget. API key stays env-only. Admin `/admin/interview` stores base/model/fallback/budget in `AppSetting` (DB overrides env).
4. **JSON discipline.** Ask for JSON in the system prompt and set `response_format: json_object` when requested. Extract first `{...}` if needed; retry once with "return only JSON"; validate `updates` with domain zod schemas before merge. Invalid updates are rejected and the turn asks again.
5. **Question banks are data.** `packages/agent/src/interview/banks/{general,hvac,veterinary}.ts`. Adding an industry = new bank file + register. Engine is a pure function: state + user message → model call → validated next state.
6. **Merge, never clobber.** Finish writes collected fields into `WizardDraft` only where the draft field is empty / unset. Admin- or owner-entered values win.
7. **Guardrails.** `stripPhoneNumbers` on staff/transfer free text before save; transfer numbers only via structured transfer-target fields later in the form. Never solicit card details. Healthcare-sensitive answers set `compliance.healthcareSensitive` so Submit stays blocked until review.
8. **Cost guard.** Default 60k input / 12k output tokens per interview; stop with a friendly message when exceeded. Usage accumulated on the session.

## Parts

| Part | Commit theme |
|------|----------------|
| 1 | `TextPlatform` + `httpText` / `memoryText`, env, `platformsFor().text` |
| 2 | Interview engine + question banks (pure, no DB) |
| 3 | `InterviewSession` migration, admin/owner chat UI, merge/finish, tests |
| 4 | `/admin/interview` settings, AppSetting, sessions table |
| 5 | DEPLOYMENT + ROADMAP docs; `submitLeadAction` email try/catch |

## Tests required

- `httpText` request shape, OpenRouter headers, retry/backoff, JSON extract, fallback model
- Engine turn with `memoryText`: asks next question, applies valid updates, rejects invalid
- Contradiction (hours vs tech-line hours) prompts clarification
- Finish merges into draft without overwriting filled fields
- Owner route 404 / hidden after `wizardSubmittedAt`; feature off when no `TEXT_API_KEY`

## Out of scope

- Voice-call version of the interview (later idea)
- Changing render / provisioning / holds
- Storing the API key in the database
- Fast-forward of main/staging
