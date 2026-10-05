# Alinstra design direction

Chosen by Daniel on Oct 5, 2026. Use this file as the source of truth for the Phase D reskin. Screenshots of the "Final" mockups (Admin home, Call detail, Setup interview) are attached alongside it when available.

**Decision:** Direction **C · Friendly SMB** as the base, plus three things borrowed from **B · Signal**: the live-call banner with a moving waveform, the speaker-colored call timeline + "Flagged" card on call detail, and B's button treatment. Applies to admin, owner portal, and marketing site so everything reads as one company.

## Base: C

### Type
- Plus Jakarta Sans (Google Fonts via `next/font`), weights 500/600/700/800.
- Page headings 800, 26–30px, letter-spacing -0.02em. Marketing hero 58px, -0.035em.
- Body 15px, line-height 1.55. Labels and captions 13px, weight 600.
- Numbers in stats: 28px, weight 800, `font-variant-numeric: tabular-nums`.

### Color tokens
| Token | Value | Use |
|---|---|---|
| ground | `#F3F6FA` | page background |
| surface | `#FFFFFF` | cards, top bar |
| surface-subtle | `#F7F9FC` | inputs, player strip |
| line | `#E3E9F1` | top bar border, input border |
| divider | `#EEF2F7` | rows inside cards |
| ink | `#0F1B2D` | headings, primary text |
| body | `#3B4760` | secondary text, inactive tabs |
| muted | `#55627A` | captions (passes 4.5:1 on white) |
| primary | `#2453D6` | primary button, logo tile, links, progress bars |
| primary-soft / primary-text | `#E7EEFD` / `#1D3FA8` | active tab, info pills, tip cards |
| success-soft / text | `#E3F6EA` / `#146C3A` | "Message taken", "Live" |
| warning-soft / text | `#FFF4E8` (cards), `#FFF0E2` (pills) / `#9A4A0B` | to-do count, flagged |
| danger-soft / text | `#FDE8E8` / `#A3261E` | failed |
| purple-soft / text | `#F1ECFD` / `#5B34B8` | minutes / misc tiles |
| neutral-soft / text | `#EEF2F7` / `#3B4760` | "No action", "Draft" |
| live (Ava teal) | strong `#14A38B`, soft `#E9F8F4`, border `#BCEBDD`, text `#0E6E5C` | live banner, Ava's bubbles/avatar, Ava segments |
| teal-bright (button option) | `#34D3B5` with text `#04221C` | only if Daniel picks teal buttons |
| badge-orange | `#B4560F` with white text | count badges |

Light theme only for now; remove the dark-mode override until a dark theme is designed.

### Shape
- Cards: radius 18–20px, no border, shadow `0 1px 2px rgba(15,27,45,0.06)`.
- Pills: fully round, 12px/600, padding 4px 10px.
- Icon tiles: 40px square, radius 12px, soft background with a strong-colored stroke icon (lucide-react is fine).
- Progress bars: 10px tall, fully round, primary fill on divider track.

### Logo lockup
White Waveform A (five rounded bars) inside a 34px `primary` rounded square (radius 10px), followed by "Alinstra" at 18px/800, -0.02em.

### Layout
- White top bar: logo, tab navigation (inactive tabs `body` color 14px/600; active tab = `primary-soft` pill with `primary` text), search field, avatar circle. No sidebar. Tabs wrap on small screens.
- Content max-width ~1160px, 28px side padding, 20–24px vertical gaps between sections.

### Voice of the UI
- Plain-language headings: "Hi Daniel, here's today", "Your to-do list", "Latest calls", "About this call", "What we've covered".
- Call detail headline is a one-sentence plain summary of the call (from the stored call summary).
- A to-do list instead of an "attention" panel; each item has a colored icon tile, a bold title, one plain sentence, and one small action button.
- One big obvious primary action per page ("Call them back", "New client", "Finish and review").

## Borrowed from B

### Buttons
- **Primary:** solid fill, radius 10px, weight 700, height 44px (48px for hero/page CTAs), optional leading icon, plus a soft halo ring: `box-shadow: 0 0 0 4px <button color at 16–22% opacity>`. Default color `primary` (#2453D6) with white text. Alternative: teal `#34D3B5` with `#04221C` text and a `rgba(52,211,181,0.22)` halo. Keep the color in one token so switching is one line.
- **Secondary:** white background, 1px `#C9D6F5` border, `#1D3FA8` text, weight 700, radius 10px, same heights; hover `#F4F7FE`.
- **Small row actions:** secondary style at 36px tall, 13px text.
- Disabled: 60% opacity, no halo.

### Live-call banner (admin home)
- Shown while any call has started and not ended (cap: started within the last 20 minutes).
- Soft-teal card (`live` soft background + border). Left: "LIVE NOW" (12px/800, letter-spacing 0.08em, `live` text) with a pulsing teal dot; client name (19px/800); what Ava is doing (e.g., "Ava is taking a message") + masked caller. Middle: an animated waveform of rounded teal bars (CSS `scaleY` keyframes, staggered delays; static under `prefers-reduced-motion`). Right: running timer (24px/800, tabular) and a secondary-style "View call" button.
- Calls tab shows a small "1 live" teal badge; that client's row shows an "On a call" pill.
- Refresh by polling every 10 s (no websockets needed).

### Call detail
- Player strip: primary play button (with halo), a call timeline drawn as rounded bars colored by who is speaking, derived from transcript turn timestamps (Ava = live teal, caller = primary blue, silence gaps longer than 8 s = amber `#F3C89A`). Bar heights are decorative (deterministic from the call id). The played portion is full color, the rest is a lighter tint. Time "0:15 / 0:51" and a speed button. Legend underneath: Ava, Caller, and any silence gap called out ("13 seconds of silence at 0:02").
- Transcript: Ava's bubbles soft teal (`#EAF7F3`) with a teal "A" avatar, left-aligned; caller bubbles primary blue with white text, right-aligned; small timestamps above each; a centered amber chip where a long silence occurred; a final pill "Ava ended the call · 0:51" (or who hung up).
- **Flagged card** (warning colors) in the side column when the call has flags, each with a plain explanation and a fix action where one exists (e.g., "Resync agent"). Flagged calls also show a "Flagged" pill in call lists and appear in the admin to-do list.
- "About this call" facts card: business, line called, caller mood, message taken, cost (admin only), kept until.

## Setup interview page
- Chat on the left in a white card; "What we've covered" checklist on the right (done ✓ green, current ● blue with a "Now" pill, to-do ○ gray) with a progress bar and "4 of 9 topics"; a soft-blue note "You can stop anytime. Everything you've answered is saved as you go."
- Header: small label "Setup interview", business name as the heading, "Save and exit" (secondary) and "Finish and review" (primary).
- Assistant bubbles light gray with a small blue icon tile avatar; owner bubbles primary blue.
- Thinking state and disclaimer as already specified for the interview (Thinking… / Still thinking… / Taking longer than usual · Try again; "Your receptionist is only as good as the information she's given. The more detail you share, the better she can represent your business.").

## Marketing site
White page; hero inside a rounded `#F3F6FA` panel (radius 32px); "Built in Morristown, Tennessee" success pill; headline 58px/800; notification-style cards on the right showing outcomes (new message, appointment request, follow-up booked); industry chips; a 3-step strip below. Buttons use the B treatment.
