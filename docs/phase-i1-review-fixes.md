# Phase I.1 review fixes (same branch, before merge)

Branch: **`phase-i1-interview`** (currently `dfb90cb`). Add commits on top; don't rebase or squash. Don't merge; Claudia reviews again.

## 0. Review result for `dfb90cb`
Claudia's checks:
- GitHub CI is green on all 3 jobs.
- Tests: **489 passed** locally twice (the backup drill runs here, so 484 + 5).
- Typecheck and lint are clean.
- The migration is additive.

The engine-owned flow, the capabilities block, booking defaults, idempotency + `version`, failure classification, `droppedReasons`, the admin diagnostics and the "Try again" change all match the plan. Good work.

Two things still need doing before merge.

**A. You built from the first version of the plan.** `docs/phase-i1-interview-fixes.md` was updated on disk after you started (Daniel had already sent the prompt). The update added the **transfers and hours** fix and the **owner step 5** fix. Those are launch blockers: on staging, an owner can't get past the transfer-number field. The file on disk is now the full version. **Commit it as-is in this round, replacing the shorter copy in `d1b0148`.** Then do §2 and §3 below, which are its additions.

**B. Bugs found in review:**

1. **Skip regex skips real answers.** `SKIP_RE = /^(skip|next|pass)\b/i` matches "Next business day we call them back". Claudia reproduced it: `gen.after_hours` ends up skipped and flagged needs review, and the summary says "You skipped after-hours". Now that skip applies to required items, this matters.
   - Fix: treat a message as a skip cue only if the **whole message** is one of: `skip`, `skip it`, `skip this`, `skip that`, `skip for now`, `next question`, `pass` (with optional trailing `.`/`!`, case-insensitive).
   - Keep honoring `answerStatus === "skipped"` from the model.
   - Tests:
     - "Next business day we call them back" → answered, not skipped;
     - "Passing calls to me is fine" → answered;
     - "skip" / "Pass." / "skip for now" → skipped.
2. **Progress line counts things that weren't discussed.** `gen.booking` is auto-answered (request-only default), so "So far: …, booking" repeats the made-up progress problem from §0 of the plan.
   - Keep a list of auto-defaulted ids (`state.autoAnsweredQuestions`, set in `applyBookingDefaults`) and leave them out of `progressLine`.
   - `summaryReply` keeps its booking sentence; it's informational and true.
3. **Contradiction question can repeat forever.** `contradictionQuestion` runs every turn and returns before advancing. If the owner's reply doesn't change the fields, they get the same question again.
   - Fix: store asked contradiction texts in `state.askedContradictions`, and ask each one at most once.
   - If it would repeat, don't ask it. Add a needs-review note `hours_conflict` (shown on the owner review page as "Hours and after-hours/on-call times don't match — check them") and continue the normal flow.
   - Test it.

## 1. Interview field changes (from the full plan §1)
- `gen.hours` also fills **`features.weeklyHoursText`** in the strict `mon 08:00-17:00` format (one line per open day, one range per day; lunch stays in `coverage.lunchHours`).
  - Add a worked example to the prompt: "Mon-Fri 8am-5pm, lunch 12-1, closed weekends" → `weeklyHoursText` = mon…fri `08:00-17:00`, `lunchHours = "12:00-1:00 pm"`.
  - The validator runs `parseWeeklyHours`; a bad value is dropped with a reason.
  - The raw fallback must **never** write into `weeklyHoursText`. Only string fields that are free text qualify; exclude `weeklyHoursText` from `primaryStringField`.
- `gen.transfers` fills a **new `features.transferNotes`** (who to transfer to and when, names/roles only) plus `features.liveTransfer`.
  - Add `transferNotes` as `optionalText` to `featuresSchema` in `domain.ts`. It's JSON, so there's no migration.
  - **The interview may never write `features.transferTargetsText`:** remove it from the interview's allowed shape and the validator, and make sure the raw fallback can't target it.

## 2. Transfers and hours an owner can actually fill in (from the full plan §3)
Replace the two raw textareas with structured editors. Use them on the owner setup review page (`/home/business/setup`, `OwnerSetupReview`) and in wizard step 5 for both audiences. They still serialize to the same text fields (`transferTargetsText` via `formatTransferTargets`, `weeklyHoursText` via `formatWeeklyHours`), so storage, `applyStep` and `submitWizard` keep their shape.

- **`TransferTargetsEditor`** (new component; existing `Card`/`Input`/`Button`/`ErrorText` styles; no new design language):
  - A choice at the top, as two radio options:
    - "Transfer callers to a person during business hours"
    - "Don't transfer — Ava takes a message instead"

    These map to `features.liveTransfer`.
  - When transferring, show rows of **[Name or role] [Phone number] [Remove]**, an "Add another person" button, and at most 5 rows.
    - Phone placeholder: `(423) 555-0142`.
    - Helper text: "Ava only ever transfers to these numbers, and only during your business hours."
  - Accept any common US/Canada format: `(423) 555-0142`, `423-555-0142`, `4235550142`, `+14235550142`, `1 423 555 0142`. Normalize on blur with `normalizeTransferNumber` and show it as `(423) 555-0142`.
  - Per-row inline errors:
    - "Add a name or role for this number"
    - "That isn't a full US or Canada phone number"
  - If `transferNotes` exists, show it above the rows as "From your setup chat: …".
  - When there are no rows yet, pre-add one row with the name prefilled from `business.contactName`.
  - Validation: if transferring with zero complete rows, show "Add at least one phone number, or choose 'take a message instead'."
- **`WeeklyHoursEditor`** (new component): 7 rows, Mon–Sun.
  - Each row: **[Open] checkbox, [Opens] select, [Closes] select**, in 30-minute steps shown as "8:00 am".
  - Prefill from `weeklyHoursText`. If that's empty, all rows start closed and a note under the editor says "Set the hours Ava should treat as open. Transfers only happen during these hours."
  - Show `knowledge.hours` above it as "From your setup chat: …".
  - Validation: closing time must be after opening time.
- **Owner setup review page:** add a "Business hours" card and a "Transfers" card with these editors, between the summary card and Submit.
  - Saving uses the existing `ownerSaveWizardDraftAction`.
  - Submit stays disabled while either editor has an error.
  - The "Continue the interview" link stays.
  - The needs-review lines from `dfb90cb` stay.
- **Server parser** (`parseTransferTargets`, `domain.ts`). It stays the authority but becomes forgiving:
  - Accept `Label, number`, `Label: number`, `Label - number` and `Label number` (label = everything before the first digit or `+`).
  - Normalize the number with `normalizeTransferNumber`.
  - Specific errors: `Line 2: add who this number is for, like "Daniel, (423) 555-0142".` versus `Line 2: "(423) 555-01" isn't a full US or Canada number.` Keep `TRANSFER_NUMBER_ERROR` only for the number-specific case.
  - `formatTransferTargets` output stays canonical (`Label, +1…`).
- **`submitWizard` / step 5:**
  - If `liveTransfer` is true and there are no targets, return the specific "Add at least one phone number…" error.
  - If `liveTransfer` is false, targets are optional and ignored.
  - **Old drafts** that already hold notes-only text in `transferTargetsText` (like staging's Test Account) must not block submit. If parsing finds lines with no number, move that text into `transferNotes`, clear `transferTargetsText`, and treat it as "no targets yet". Then the editor shows the notes, and the owner adds numbers or picks "take a message".

## 3. Owner-facing step 5 (from the full plan §2)
- `WizardForm` gets an `audience: "admin" | "owner"` prop. `/home/business/edit/[step]` passes `"owner"`.
- For owners, hide **Text confirmations**, **Text reminders** and **Recall add-on**.
- For everyone, change the "Messages" hint to "What Ava should collect when she takes a message, for example name, number, address and reason." (no "text").
- Admins still see the text and recall toggles, but add "(not available yet)" to both text hints.

## 4. Tests to add
- The skip regex cases in §0.B.1; the progress line without booking; the contradiction asked once.
- The validator accepts `transferNotes` and rejects `transferTargetsText` from the interview. `weeklyHoursText` is accepted only if `parseWeeklyHours` passes, and the raw fallback never writes `weeklyHoursText` or `transferTargetsText`.
- **Parser cases:**
  - `+14235551234` → "add who this number is for";
  - `Me, (423) 555-1234`, `Owner, 423-555-1234`, `Daniel +14235551234` and `Owner: 4235551234` parse;
  - `Just me (owner) for quotes` → "add a phone number";
  - 900/976 numbers are still rejected.
- **`submitWizard`:**
  - `liveTransfer` false with notes-only text submits;
  - `liveTransfer` true with no targets gives the specific error;
  - an old draft with notes-only `transferTargetsText` is migrated to `transferNotes` and doesn't throw.
- **UI:**
  - `TransferTargetsEditor` normalizes `423-555-0142`, shows per-row errors, and "take a message instead" clears the requirement;
  - `WeeklyHoursEditor` round-trips `formatWeeklyHours`/`parseWeeklyHours`;
  - owner step 5 renders no "Text confirmations", "Text reminders" or "Recall add-on", and admin step 5 still does.

## 5. Verify and report
1. `pnpm typecheck`, `pnpm lint`, `pnpm test` (twice), and the no-DB build.
2. **Screenshots at 1280 and 390 wide**, attached. Daniel looks at these before merge.
   - `/home/business/setup` as a paid self-serve owner, with Business hours + Transfers cards and one transfer row showing an inline error;
   - `/home/business/edit/5` as that owner;
   - admin step 5.
3. Push, and confirm **GitHub CI is green on all three jobs** for the new head.
4. Report: commits, test count, CI result, the screenshots, and anything you couldn't do. Don't merge.
