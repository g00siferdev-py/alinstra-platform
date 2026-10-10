Phase L: landing page refresh, Solo plan, Enterprise card

## 0. Start
1. `git checkout main && git pull`. Confirm `main` contains `97e1d6f` (Phase D: "Fix unlayered CSS element rules so Tailwind button text stays visible"). If it doesn't, stop and tell me; don't build on an older base.
2. `git checkout -b phase-l-landing`
3. Daniel has added these files. Read all three before writing code:
   - `docs/marketing-copy.md` (draft 2). This replaces the old file and is the source of truth for every word on the page. Use it verbatim.
   - `docs/design/landing-mockup.html`. Open it in a browser. It is the approved design and shows exact spacing, colors, radii and shadows. It is static HTML with inline styles; rebuild it with our Tailwind tokens and components, don't paste it in.
   - `docs/design/landing-mockup.png`, a full-page screenshot of the mockup at 1280px.
   If the mockup and this prompt disagree, this prompt wins.

## 1. Ground rules
- Marketing pages stay `force-dynamic` and must not query the DB at build time. Plans come only from `publicPlans()` (DB, with the seed fallback). Never hard-code prices, minutes, overage, setup fees or included changes in JSX. The only numbers allowed in copy are the illustrative ones in the mockup (example call, 555 numbers, recall list).
- Use the existing tokens in `globals.css`, `btnPrimary`/`btnSecondary`, `Pill`, `IconTile`, `WaveformMark` and `lucide-react` icons.
- Don't add unlayered element rules to `globals.css`; `globals-css-layers.test.ts` must stay green. Reuse the existing `live-wave` keyframe for every waveform. If you need a pulse for the live dot, add it next to `interview-dot-pulse`. Both animations must stop under `prefers-reduced-motion`.
- Get the phone from `publicSiteConfig()` and format it with `marketingPhoneDisplay`/`marketingTelHref`. When no phone is set, every "Call Ava" button becomes "Get started" → `/start`, and the "Hear Ava" section is hidden.
- Use server components everywhere. The FAQ uses native `<details>`/`<summary>`, so it needs no client JavaScript.
- Responsive:
  - Every multi-column grid becomes 1 column below `md`.
  - The stat bar becomes 2×2 below `md`.
  - Pricing cards: 1 column below `md`, 2 columns from `md`, 4 columns from `lg`.
  - Remove the Recommended card's upward offset below `lg`.
  - No horizontal scroll at 390px.
- Honesty rules (also listed at the top of `docs/marketing-copy.md`):
  - Messages go out by email only; never say "text."
  - Calendar booking always says "once connected."
  - Follow-up calls are always labeled Add-on, say "Ask about pricing," and carry the consent line.
  - No "Most popular." The highlighted plan says "Recommended."

## 2. Solo plan (data)
1. Add Solo to `PLAN_SEEDS` in `packages/db/src/plans.ts`: code `solo`, name `Solo`, monthly 9900, included minutes 150, overage 40, setup 9900, included changes 1, sortOrder 0. Leave the other three plans exactly as they are.
2. Deploys run `prisma migrate deploy`, not the seed, so add migration `20261006010000_phase_l_solo_plan`. It must be idempotent:
   ```sql
   INSERT INTO "plan" ("id","code","name","monthlyPriceCents","includedMinutes","overagePerMinuteCents","setupFeeCents","includedChangesPerMonth","extraChangeFeeCents","recallMonthlyCents","recallPerBookingCents","active","sortOrder","createdAt","updatedAt")
   VALUES ('plan_solo','solo','Solo',9900,150,40,9900,1,4900,2500,600,true,0,NOW(),NOW())
   ON CONFLICT ("code") DO NOTHING;
   ```
   (4900 is the current `EXTRA_CHANGE_FEE_CENTS`; double-check it in `domain.ts`.)
3. In the same migration, add `"planInterest" TEXT` (nullable) to the `lead` table, and update `schema.prisma` to match.
4. Solo needs nothing else. The admin plan editor, the new-client plan picker, allowance logic and the owner portal already read the Plan table, so check that Solo shows up in each one. Update any test that assumes exactly three plans.

## 3. Shared pieces
- `apps/web/src/lib/marketing-plans.ts`, keyed by plan code:
  - `PLAN_MARKETING` holds, for each code: `tagline`, `badge` ("Self-serve" for solo), `recommended` (true for professional only), `ctaLabel` ("Start Solo" for solo, otherwise "Get started"), `foundingWaiver` (false for solo, true for the rest), `everythingIn` (the previous plan's name, or null for solo), and `staticFeatures` (the non-numeric bullets from the copy doc).
  - An unknown code falls back to: empty tagline, no badge, no static features, ctaLabel "Get started", foundingWaiver false.
  - Helpers:
    - `typicalCallsRange(minutes)` → `{ low, high }`, using 3 and 2 minutes per call. Round to the nearest 5 below 200 and to the nearest 10 above that. Expected: 150 → 50–75, 300 → 100–150, 1000 → 330–500, 2500 → 830–1,250.
    - `planChangesLine(n | null)` → "1 update to Ava's info each month", "2 updates…", or "Unlimited updates to Ava's info". Use `ASSISTANT_NAME`.
    - `planOverageLine(plan, allPlans)` → "$0.35 a minute after 300". Prefix "Our lowest rate: " only when the plan has the strictly lowest overage and there is more than one plan.
    - `cheapestPlan(plans)` for the stat bar.
  - Bullet order on each card: `everythingIn` (bold), then `staticFeatures`, then the changes line, then the overage line.
- In `brand.ts`, add `export const FOUNDING_OFFER = { active: true, audience: "our first ten businesses" } as const;`
  - While it's active, plans with `foundingWaiver` show the setup fee struck through plus a "Waived" success pill. Solo always shows its own setup (now $49 one time; this plan originally said $99).
  - The pricing header pill names the waived plans from the data ("…setup fee waived on Starter, Professional, and Premium for our first ten businesses").
  - When it's inactive, the pill disappears and no fees are struck.
- `apps/web/src/components/marketing/plan-cards.tsx` (server component):
  - Props: `plans: PublicPlan[]`.
  - Renders the cards exactly as in the mockup: name + badge, tagline, big price + "/month", the minutes box with the typical-calls line, the setup line, the CTA, a divider, then the bullets.
  - The recommended card gets a 2px primary border, the "Recommended" pill on its top edge, a primary CTA, primary-tinted minutes box and check icons. Every other card uses a secondary CTA.
  - CTAs link to `/start?plan=<code>`.
  - Below the cards, render the dark Enterprise card (ink background, building icon, "Custom pricing" pill, white "Contact us" button → `/start?plan=enterprise`).
- `apps/web/src/components/marketing/marketing-waveform.tsx`: rounded bars using `live-wave`. Props are `heights: number[]` and a size of `"sm"` or `"lg"`. Pass the heights in as a fixed array; never randomize them.
- `isTollFree(e164)` in `marketing-phone.ts` returns true for +1 800/833/844/855/866/877/888. "Toll-free" is shown only when it's true. Add a test for it.

## 4. Home page (`apps/web/src/app/(marketing)/page.tsx`), top to bottom
Build it in this order. Every word comes from `docs/marketing-copy.md`.
1. **Hero.**
   - Keep the copy and buttons.
   - Replace the three Pill outcome cards with the notification cards: icon tile, bold title, timestamp, and a detail line. The second card is indented 32px from `md` up.
   - Above the cards, right-aligned, add the teal "Ava is on a call" chip: pulsing dot, 7-bar sm waveform, "0:42".
   - Give the hero panel extra bottom padding so the stat bar can overlap it.
2. **Stat bar.**
   - A white card about 1040px wide, pulled up about 52px over the hero, with a large soft shadow and 4 cells split by divider lines.
   - The 4th cell is computed from `cheapestPlan` (now "$49/mo" / "Plans start with Solo"; this plan originally said $99).
   - Below it, a centered chips row: "Made for any business that runs on the phone:" + the INDUSTRIES chips + "See who it's for →".
3. **How it works.**
   - Centered eyebrow and heading.
   - 3 bordered cards. Each has an IconTile, a "Step N" pill, title, body, and a mini visual at the bottom (chat bubbles / number → "Ava answers" / email notification).
   - Step 3 must say "in your email the moment the call ends."
4. **What Ava does.**
   - A full-width ground (`#F3F6FA`) band.
   - Heading on the left, lead on the right.
   - A 3×2 grid of white cards with tones matching the mockup: primary, success, purple, warning (with "Add-on" pill), live teal, neutral.
5. **Hear Ava for yourself.**
   - Only render when a phone is set.
   - A live-soft panel with a live border and radius 28.
   - Left: pulsing dot + eyebrow, heading, lead, the 20-bar lg waveform, the primary call button, and the "Toll-free · about two minutes" note.
   - Right: the "Example call" card. Bubbles match call detail: Ava's are teal with an "A" avatar on the left, the caller's are blue on the right.
6. **Pricing** (`id="pricing"`). Eyebrow, heading, lead, founding pill, `<PlanCards>`, then the "Every plan includes" strip with "Compare plans →" (`/pricing`), then the two add-on cards (warning-soft and purple-soft).
7. **Ava calls them back, too.**
   - Ground band.
   - Left: eyebrow in warning text, heading, lead, 3 checks, consent line.
   - Right: the recall-list card (static illustration, `aria-label="Example recall list"`). The "Calling now" pill has a 4-bar mini waveform.
8. **Why owners pick it.** 3 bordered cards with Headphones, Lock and MapPin tiles.
9. **FAQ.**
   - Two columns: heading + email line on the left, six `<details>` on the right. The first one starts open.
   - The chevron rotates when an item is open.
   - Use the phone and email from site config.
10. **Final CTA.**
    - A rounded primary-gradient band with a faint oversized WaveformMark in the corner.
    - White "Get started" button with primary text, plus a white-outline "Call Ava" button.
11. **Footer** (`site-chrome.tsx`).
    - 4 columns (brand + blurb, Product, Company, Legal), then a bottom row: "© {current year} Alinstra Technologies LLC" and "Calls are answered by an AI assistant and may be recorded." linking to `/legal#ai-disclosure`.
    - Remove the footer's `mt-16`. That gap is the empty gray band above the footer.
    - Make the marketing layout background white so every marketing page is white edge to edge.

## 5. Other pages
- `/pricing`: put `<PlanCards>` at the top with the same heading and lead as the home pricing section. Keep the existing comparison table below it under an h2, "Compare plans in detail." The table now has four columns, including Solo. Update the "Not sure which plan?" and Founding offer copy from the PRICING section of the copy doc.
- `/start`:
  - Read `?plan=`. If it's an active plan code or `enterprise`, show a small primary-soft chip above the form ("Plan: Solo", "Plan: Enterprise", …) and send it as a hidden field.
  - The server action validates it against that same allowed set (drop anything else) and saves it to `Lead.planInterest`.
  - `/admin/leads` shows it as a pill on each lead.

## 6. Tests
- Keep `marketing-home.test.ts` passing. Add these checks on the home source: it doesn't contain "email or text"; it doesn't contain "Most popular"; it contains `id="pricing"`; it renders `PlanCards`.
- `marketing-plans.test.ts`:
  - The typicalCallsRange values above.
  - The changes lines.
  - The lowest-rate prefix appears only on Premium, and not when there's a single plan.
  - The unknown-code fallback.
  - Solo has no founding waiver.
- Plans tests: the seed list has 4 plans, Solo is first by sortOrder, and `publicPlansFromSeeds()` includes Solo.
- Start action: a valid plan is saved, an invalid plan is dropped, and enterprise is accepted.
- `isTollFree` cases.

## 7. Verify before you report
1. `pnpm typecheck`, `pnpm lint`, `pnpm test`. Run the tests twice.
2. Run the production build with no database (same env as CI, `DATABASE_URL` pointing at an unreachable host). It must pass.
3. Apply the migration to a local DB twice, to prove the insert is idempotent.
4. `next start`, then screenshot `/` at 1280 and 390 wide, plus `/pricing` at 1280. Attach all three. Check:
   - Every button shows its text.
   - Nothing scrolls sideways at 390.
   - The stat bar overlaps the hero.
   - The pricing cards line up, with Professional raised on desktop.

Report back with: branch, commit hash, test count, the screenshots, and anything you couldn't match. Don't merge; Claudia reviews first.
