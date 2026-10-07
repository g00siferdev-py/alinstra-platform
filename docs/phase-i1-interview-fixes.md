# Phase I.1: setup interview reliability

Branch `phase-i1-interview` off `main` (680d22d). Don't merge. Claudia reviews first.

## 0. Why

On Oct 6, Daniel ran the self-serve setup chat on staging as a real owner would: "Test Account", a lawn-care business on the `general` bank with Kimi K2.5. The admin turn log for that session shows these problems, in order of severity:

1. **Loop.** He answered the after-hours question twice ("Schedule a call back for the next business day", then "Same thing."), and it was asked **four times**. He had to type "You are asking me the same thing over and over" and "You seem to be stuck!" The cause is that the model chooses both which question it is on (`askedId`) and where to file the answer, while `buildInterviewUserPayload` separately suggests "next = first open item in bank order". When those disagree, answers go into the wrong item (his after-hours answer was confirmed as the "nobody picks up" answer), `coverage.afterHours` stays empty, and the engine keeps steering back to it.
2. **Overpromising.** The bot told the owner Ava *"can also check your availability directly on the calendar"* and will *"schedule the estimate meeting"* or *"schedule a callback"*. Calendar booking doesn't exist yet: it's Phase 8, the site says "once connected", and it's only on Professional and Premium. Ava can't schedule anything today. This breaks our honesty rule and would disappoint a paying customer on the first call. **Treat it as the top priority.**
3. **Made-up progress.** When asked to recover, the bot said *"We've covered: hours, services, FAQs, booking, transfers…"*, but booking was never covered.
4. **Duplicate turns.** The owner's hours message and the reply to it appear twice. `ThinkingBubble` shows "Try again" at 30 s **while the first request is still running**. Clicking it calls `runSend` with the same text, so the server processes both. `postInterviewMessage` has no idempotency and no concurrency check.
5. **Silent failure.** Turn 1 failed with `model=error tokens=0/0`. The `catch {}` in `interviewTurn` throws away the cause, so we can't tell whether it was a timeout, a 401/402/429, or a network error. Thinking was on at the time; Kimi produced 755 output tokens for one short reply, and the 30 s client timeout is the likely cause.
6. **Unexplained drop.** One turn logged `dropped=[transferTargetsText]` with no reason.
7. **Small stuff.** Every reply starts "Got it —". "Same thing." was misread as "you already asked that".

For context: Daniel has set staging's `/admin/interview` reasoning effort to **off**. After that, turns ran about 70–170 output tokens and felt fast. The design below cuts down what the model has to get right, so a fast model with thinking off is good enough.

## 1. The engine owns the question flow

The model now only extracts answers and writes one short confirmation. The engine decides what's asked next and words the question itself.

- Add `currentQuestionId: string | null` and `askCounts: Record<string, number>` to `InterviewState`.
  - The greeting asks hours, so `initialInterviewState` sets `currentQuestionId = "gen.hours"` (or the first item of the bank in use) and `askCounts = { [thatId]: 1 }`.
  - Back-compat for old sessions without these fields: set `currentQuestionId` to the first open required item and `askCounts` to `{}`.
- New model JSON shape. Update `validate.ts`, `types.ts` and the prompt:
  ```json
  {
    "confirmation": "one short sentence restating what the owner said, in plain words",
    "updates": { },
    "answerStatus": "answered | skipped | unclear | off_topic",
    "followUp": "a clarifying question, or null"
  }
  ```
  - Drop `reply`, `askedId` and `done` from what the model returns. The engine decides all three.
  - Keep `parseModelTurnForgiving`'s tolerance. If the model still sends `reply`, treat it as `confirmation`.
- The payload (`buildInterviewUserPayload`) tells the model exactly this:
  - `The owner is answering: <id> — "<question text>"`
  - `File the answer in: <item.fields>` (it may also fill other fields the owner clearly mentioned)
  - the collected JSON, the capabilities block (§2), and the owner's message.
  - Remove the "Suggested next question" line. The model must **not** ask the next question. The app does that.
- After merging updates, the engine runs, in this order:
  1. **Skip.** If the message matches `/^(skip|next|pass)\b/i` or `answerStatus === "skipped"`, mark the current item skipped, whether it's required or not. A skipped required item is flagged **needs review** (§5).
  2. **"Same thing."** If the message matches `/^(same( thing)?|same as (before|above|that)|ditto)[.!]?$/i`, copy the previous answered item's primary field value into the current item's primary field. The primary field is the first string field in `item.fields`.
  3. **Raw fallback.** If `answerStatus === "answered"` but the current item still isn't `done`, write the owner's own words (trimmed, cut to the field's max length) into the current item's primary field. The owner's words are always acceptable; the owner and Daniel both review the form before go-live.
  4. **Unclear or off-topic.** If `answerStatus` is `unclear`/`off_topic`, or a `followUp` is present, and `askCounts[current] < 2`: stay on the current item, increment its count, and reply with `confirmation` (if any) plus `followUp`, or else the item's question reworded as "Just to make sure I have it right: …".
  5. **Two-ask cap.** If the current item has already been asked twice and is still not done: mark it skipped plus needs review, and move on. **No item is ever asked more than twice.**
  6. **Advance.** Otherwise mark the current item answered. The next item is the first open item in bank order (required before optional), skipping anything already done. Reply with `confirmation + " " + nextItem.question`, then set `currentQuestionId` and increment `askCounts`.
- `done` happens when no required items are open. The reply is always the engine's `summaryReply`, never model text. Rewrite `summaryReply` to list only the items actually filled and to name any skipped/needs-review items ("You skipped emergencies; you can fill it in on the next screen.").
- If the owner says something like "you're stuck" or "you already asked", the model returns `off_topic`. The engine apologizes in one line, builds a **progress line from state** ("So far: hours, services, common questions, transfers. Next: after-hours."), and asks the current item. The model never writes progress lists.
- Prompt style: "Vary how you start; don't begin every confirmation with 'Got it'. One sentence."

## 2. Tell the model what Ava can actually do, by plan

- At session start, load the client's plan code (`client.planId` → `plan.code`) and store it as `state.planCode`. Old sessions without it are treated as `null` and get the most conservative wording.
- Add a **capabilities block** to the system prompt. It's built in code from `planCode` and one constant: `CALENDAR_BOOKING_AVAILABLE = false`. Phase 8 flips that.

  > What Ava can do today:
  > - answer callers' questions from this business's information (hours, services, policies, FAQs)
  > - take a message (name, number, reason) and email it to the people the owner chooses
  > - take a callback request, including the best time to call back, and email it to the owner
  > - transfer live calls to the people the owner names, during the hours they choose
  > - give the owner's own emergency instructions word for word
  >
  > What Ava cannot do (if the owner asks for it, say so plainly and offer the closest real option):
  > - see or book a calendar, or schedule meetings, estimates or callbacks at a set time. She takes the request and the owner confirms. *(Professional/Premium only: "Calendar booking is coming once your calendar is connected.")*
  > - send text messages. Messages go out by email only. Never mention texting.
  > - quote prices the owner hasn't given, or give medical, legal or veterinary advice

- **Translation rule** in the prompt: when an owner says "schedule a callback" or "book the estimate", the confirmation says "take a callback request and email it to you", not "schedule".
- Remove `features.textConfirmations`, `features.textReminders` and the `direct_calendar` value from the interview's **allowed updates shape** and validator. The wizard keeps them; only the interview can't set them.
- **Booking question:** while `CALENDAR_BOOKING_AVAILABLE` is false, `initialInterviewState` sets `collected.features.bookingMode = "request_only"` and marks `gen.booking` answered, so it's never asked. `summaryReply` says: "Appointment requests: Ava takes them and emails them to you to confirm."
- **Belt and braces:** after each turn, check the confirmation and followUp text against `/\b(calendar|availability|book(ing|ed)?\s+(the|an?|your)\b|schedul\w*\s+(the|an?|your)?\s*(meeting|appointment|estimate|callback|call back)|text(s|ing)?\b|sms)\b/i`. On a match, set `capabilityFlag: true` on the turn log entry and `log("warn", "interview.capability_claim", { sessionId, questionId })`, with no content. Don't rewrite the reply; the flag is for Daniel to spot on the admin page and for us to tune the prompt.

## 3. No more duplicate or lost turns

- **UI** (`interview-chat.tsx`):
  - Remove "Try again" from `ThinkingBubble`'s slow phase. While a request is running, show "This is taking longer than usual…" only.
  - "Try again" appears only after the action has actually returned `ok: false` or thrown (the existing `sendFailed` path).
  - Change "still" to 6 s and "slow" to 20 s.
- **Idempotency:**
  - Every submit gets a `clientMessageId` (`crypto.randomUUID()`), and a retry reuses the same id.
  - `postInterviewMessage` takes it. If `state.lastClientMessageId === id`, return the stored last assistant reply without calling the model.
  - Store `lastClientMessageId` in state after a successful turn.
- **Concurrency:**
  - Add `version Int @default(0)` to `InterviewSession`. Migration `20261007010000_phase_i1_interview_version`.
  - `postInterviewMessage` updates with `where: { id, version }` and `version: { increment: 1 }` (use `updateMany` and check `count`).
  - If `count === 0`, return `{ ok: false, conflict: true }`. The UI then reloads the transcript from the server instead of showing an error.

## 4. Failures say why

- In `interviewTurn`'s catch, classify the error into `error: "timeout" | "http_401" | "http_402" | "http_429" | "http_4xx" | "http_5xx" | "network" | "unknown"` from `ProviderRequestError.status` / `AbortError`. Store it on the turn log entry.
- In `postInterviewMessage`, `log("warn", "interview.turn_failed", { sessionId, error, model })`. Never log prompt or owner text.
- `validate.ts` records a reason per dropped path, such as `transferTargetsText: expected string, got array`. Reasons only, never values. Store it as `droppedReasons` on the turn log.
- Raise the text call timeout from 30 s to **40 s**. Keep "no retry after a timeout".
- Change the **default** interview reasoning effort to **off** in code (`resolveTextInterviewConfig`), so production starts the way staging is now set. The admin setting still overrides it.

## 5. Admin turn log shows the new fields

On `/admin/interview?session=…`, each assistant turn's diagnostic line adds:
- `q=<currentQuestionId>`
- `asked=<n>`
- `status=<answerStatus>`
- `fallback=raw|same` when §1 steps 2–3 fired
- `error=<code>` on failures
- `dropped=[path: reason]`
- a red **capability** pill when `capabilityFlag` is set

The session row also shows a **needs review** count. Skipped required items appear in the owner's wizard review as empty fields marked "Needs an answer" (reuse the existing empty-field styling; no new design).

## 6. Tests

Use the scripted memory text provider for everything in the engine.

- **Lawn-care replay.** Script the model to file after-hours under `coverage.holdOverflow` with `answerStatus: "answered"`. Then:
  - after-hours is filled by the raw fallback;
  - no item is asked more than twice;
  - questions follow bank order;
  - the reply never contains a second question.
- "Same thing." copies the previous answer into the current item.
- `off_topic` twice in a row on one item → skipped plus needs review, and the engine moves on.
- Skip works on a required item.
- The done summary lists only filled items and names the skipped ones.
- The capabilities block for `solo` has no calendar promise. For `professional` it has the "once connected" line. `bookingMode` is `request_only` at start, and `gen.booking` is never asked.
- The allowed shape/validator rejects `textConfirmations`, `textReminders` and `direct_calendar`.
- The capability regex sets `capabilityFlag` on "She can check your calendar" and doesn't set it on "callers ask about scheduling".
- The same `clientMessageId` twice → one model call, same reply.
- A stale `version` → conflict.
- A thrown `ProviderRequestError(…, 402)` → `error: "http_402"`, and an `AbortError` → `"timeout"`. Assert the logged object contains no message text.
- UI:
  - no "Try again" while a request is pending, even after 20 s with fake timers;
  - "Try again" appears after `ok: false`, and the retry sends the same `clientMessageId`.
- Update existing interview tests for the new JSON shape. Don't delete coverage.

## 7. Replay script (real model)

Add `packages/agent/scripts/interview-replay.ts` and a `pnpm --filter @alinstra/agent interview:replay` script.
- It reads `TEXT_API_BASE`, `TEXT_API_KEY`, `TEXT_MODEL` and an optional `TEXT_REASONING_EFFORT` from the environment.
- It runs the owner answers from `packages/agent/scripts/fixtures/lawn-care.json` through `interviewTurn`. Use Daniel's actual answers from §0, in order, including "Same thing." and "You seem to be stuck!".
- It prints each question asked, `askCounts` at the end, every `capabilityFlag`, and the final summary.
- Exit code 1 if any item was asked more than twice or any capability flag fired.

If you have a text API key locally, run it twice with `kimi-k2.5` and reasoning off, and paste both outputs into your report. If you don't, say so; Daniel will run it.

## 8. Verify before you report

1. `pnpm typecheck`, `pnpm lint`, `pnpm test` (twice).
2. The no-DB production build.
3. Apply the migration to a local DB twice.
4. **Push the branch and confirm GitHub CI is green on all three jobs.** Include the run result in your report.
5. Report: branch, commit, test count, CI result, replay output (or "no key"), and anything you couldn't do. Don't merge.
