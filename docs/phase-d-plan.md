# Phase D plan — Friendly SMB reskin

Branch: `phase-d` from `origin/main` (`9bc71ab`). Do **not** touch `main` / `staging`.

Source of truth: [design-direction.md](./design-direction.md) and the Final mockups (Admin home, Call detail, Setup interview).

Out of scope: agent prompts, provisioning, billing logic, encryption.

## Locked decisions

| Topic | Choice |
|---|---|
| Primary buttons | `--btn-primary` / `--btn-primary-ink` / `--btn-halo` = blue `#2453D6` / white / soft halo. Teal swap is a one-line comment in `globals.css`. |
| Admin nav | Keep Plans / Services / Interview. **Add** Calls → `/admin/calls` for the live badge. No Messages tab. No search box. |
| Live banner CTA | “View call” (not “Listen in”). |
| Share with staff | Disabled, labelled “Coming soon”. |
| Migration | `20261005210000_phase_d_call_flags` → `CallRecord.flags Json?`. |
| Interview thinking UX | Not on main; Part 6 ports `80837fe` (or re-applies) then restyles. |

## Commits

1. This plan (+ design-direction + mockups if present)
2. Part 1 — Foundation
3. Part 2 — App shell
4. Part 3 — Admin home
5. Part 4 — Owner / staff home
6. Part 5 — Call flags + detail/list
7. Part 6 — Interview page
8. Part 7 — Inherit pass
9. Part 8 — Marketing + verify/push notes in the PR description

## Part 1 — Foundation

- Plus Jakarta Sans via `next/font/google` (500/600/700/800) on root layout.
- Replace tokens in `apps/web/src/app/globals.css` (light only). `@theme` mapping. Focus ring: 2px primary, 2px offset.
- Rebuild `components/ui.tsx`: Card, Button (`primary`/`secondary`/`small`/`danger`, keep `tone` alias), Input/Textarea/Select, Label, ErrorText, Pill, IconTile, StatCard, ProgressBar, PageHeader, SectionCard, EmptyState. Keep FileDropzone.
- Add `lucide-react`. Live-waveform + interview-dot keyframes honor `prefers-reduced-motion`.

**Accept:** App still compiles; old pages look slightly off until later parts.

## Part 2 — App shell

- Rewrite `app-header.tsx`: logo lockup, active pill tabs from pathname, avatar + existing SignOutControl.
- Content container: max-width 1160px, 28px padding (`app-shell-main` on home/admin/account layouts).
- Optional live-count badge slot on Calls.

**Accept:** Tabs wrap at 375px; focus visible on links/buttons.

## Part 3 — Admin home

- `adminOverview(ctx, now)` in `packages/db` + tests.
- `/api/admin/live-calls` polled every 10s.
- `/admin/calls` list page + home dashboard: greeting, live banner, stats, to-do list, clients card, latest calls.
- “N live” badge on Calls tab; “On a call” on client rows.

## Part 4 — Owner / staff home

- Same `/home` for portal roles: greeting, tiles, latest calls, messages, “Your receptionist” card.
- Staff without `canViewCalls` never see call data.

## Part 5 — Calls

- Migration + `callFlags` / `callTimeline` pure functions + tests.
- Wire flags in `applyRetellCall` on ended/analyzed.
- Restyle call detail + list rows per mockup.

## Part 6 — Interview

- Port thinking UX; relayout to chat + “What we've covered” + stop-anytime note + Save/Finish header.

## Part 7 — Inherit

- Swap ad-hoc Tailwind for new components on remaining app pages. No behavior changes.

## Part 8 — Marketing

- Restyle `(marketing)` to white page, ground hero panel, Morristown pill, outcome cards, chips, 3-step strip, B buttons. Copy from `marketing-copy.md`.

## Quality bar

- Text ≥ 4.5:1; real buttons/links with focus; 375px usable; reduced-motion stops waveform/dots.
- Ship: `pnpm test` / `typecheck` / `lint` / no-DB web production build; push `origin/phase-d`.

## Expected mockup gaps

- No Messages tab / no search (intentionally deferred).
- No live listen-in audio (View call only).
- Share with staff = Coming soon.
- Plans / Services remain in admin nav (product needs them; mockup omitted them).
