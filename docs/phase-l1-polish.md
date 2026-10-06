Phase L.1: polish on phase-l-landing before merge

Work on the existing `phase-l-landing` branch. Add a new commit on top of `03c3843`; don't rebase or squash. Commit this file (`docs/phase-l1-polish.md`) with it.

Claudia's review of `03c3843`:
- 245 tests pass across ALL packages. Your 167 counted only web/db/auth/worker; always report the full total.
- Typecheck, lint and the no-DB build pass.
- The migration is idempotent, and the Solo plan and planInterest data are correct.
- Mobile looks good.
Fix the items below, then it merges.

## Must fix
1. **/pricing follow-up add-on.** Remove the "From $25/month plus $6 per booking" line (the `recallSample` block) and show only "Ask about pricing →" linking to `/start`. Follow-up pricing isn't final, and Daniel rejected per-booking pricing. The marketing site must not display `recallMonthlyCents` or `recallPerBookingCents` anywhere. Add a test that the pricing page source doesn't contain "per booking".
2. **The "Custom pricing" pill on the Enterprise card is unreadable** (dark text on dark). `Pill` always adds its tone's bg/text classes, and those clash with the custom bg/text classes passed in. The "Recommended" pill only looks right by luck of CSS order.
   - Add `tone="none"` to `Pill` so it emits no color classes.
   - Use it for both the Recommended and Custom pricing pills.
   - Grep the marketing components for any other `Pill` given custom bg/text classes and fix those the same way.
3. **Stat bar: the divider between cells 2 and 3 is dark on desktop**, because `md:border-r` has no color. Put `border-[var(--divider)]` on every cell so every divider is the light divider color at every breakpoint.

## Match the mockup
4. **One container for every section.** Content edges must line up with the hero panel: 60px from the edge at 1280 wide, 1160px max content.
   - Right now How it works, Hear Ava, Pricing, Why owners pick it and the FAQ sit 28px further in (double padding). /pricing has the same problem.
   - The extra width also lets "About 330 to 500 typical calls" fit on one line in the plan cards. If a line still wraps at 1280, reduce the card side padding to `px-5`.
5. **Center the Pricing header** (eyebrow, h2, lead, founding pill) and the "Why owners pick it" header, as in the mockup. Do it on /pricing too. The founding pill gets 13px text and is 32px tall.
6. **Plan price:** 44px, extrabold. "/month" stays at 15px.
7. **Icon buttons need a gap** between icon and text. Add `gap-2` to `btnPrimary` and `btnSecondary` in `button-classes.ts`, then spot-check the app pages that use them.
8. **Home add-on cards.**
   - Restore the white icon tiles: RefreshCw in warning text, CalendarDays in purple text.
   - Restore the "Professional and Premium" pill (purple) on Calendar booking, and drop the "Included on Professional and Premium" sentence there.
9. **Hear Ava.**
   - In the example call, Ava's "A" avatar is solid live teal (`--live-strong`) with white text, matching call detail.
   - On `md`+, "Toll-free · about two minutes" sits to the right of the button. Below it on mobile is fine.
10. **Recall list card**, as in the mockup.
    - Header: "Recall list" in bold, with "This week · 12 customers due" underneath and the success "4 booked" pill on the right.
    - Each row: a colored initials circle (TH, RP, JA, MB), then the name in bold with the service on the line under it, then a status Pill on the right.
    - Statuses: success "Booked · Oct 14"; live "Calling now" with the 4-bar sm waveform; warning "Left a message"; neutral "Due Oct 20".

## Flaky test (pre-existing, not from Phase L)
11. `packages/db/src/phase2.test.ts` › "keeps a staff transfer number out of the published prompt" occasionally fails: the random `REFERENCE END <token>` can be all digits and trip the 7-digit regex (seen as `REFERENCE END 98583343`). Slice the prompt from "Staff directory" up to the next "REFERENCE END" before applying the regex.

## Verify
- `pnpm typecheck`, `pnpm lint`, `pnpm turbo run test --force`. Run the tests twice, and report the total across all packages (it should be at least 245).
- The no-DB production build.
- Start with `MARKETING_PHONE=+18883871525` so the phone-gated parts render (header Call Ava, Hear Ava, final CTA).
- Screenshot `/` at 1280 and 390 and `/pricing` at 1280. Save them to `docs/design/phase-l-screenshots/`, overwriting the old ones.

Report: commit hash, total test count, screenshots. Don't merge; Claudia gives the merge go-ahead.
