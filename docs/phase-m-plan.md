# Phase M — Marketing site

Status: on branch `phase-m`, not yet on `main`. Public marketing site at `/` with pricing from the Plan table, a lead form, and admin lead list. Copy source: `docs/marketing-copy.md` (verbatim). No Stripe checkout yet.

## Spec source

User Phase M brief + `docs/marketing-copy.md`.

## Decisions (this plan)

1. **`PRODUCT_NAME` / `ASSISTANT_NAME`.** Both live in `apps/web/src/lib/brand.ts`. `PRODUCT_NAME` is `"Ava"` for now (replaces `[Product]` in copy). `ASSISTANT_NAME` is `"Ava"` and does not change with the product rename.
2. **Phone never hard-coded.** `publicSiteConfig()` in `packages/db` returns `{ phone, email }` from the internal client (client zero), cached in-process for one hour. Fallback phone is optional env `MARKETING_PHONE`; fallback email is `hello@alinstra.com`.
3. **Root `/` is marketing for everyone.** Signed-in users see "Go to dashboard" in the marketing header (client island / cookie check so Home/Pricing/Industries/About stay ISR). Portal `AppHeader` moves out of the root layout into portal route layouts so it does not double-render on marketing pages.
4. **Pricing is live from `publicPlans()`.** Tenant-free, active plans, `sortOrder` asc. "Unlimited" when `includedChangesPerMonth` is null. Follow-up add-on shows recall cents when set, else "Ask about pricing."
5. **Leads.** New `Lead` model + migration. Honeypot + 5/hour/IP via `@alinstra/auth` counter helpers. Admin notice only — no auto-reply to the lead. Admin `/admin/leads` can mark contacted and open Create client with prefilled fields.
6. **Design.** Quiet modern (Anthropic/OpenAI spirit): one accent, Waveform A mark, optional one inline SVG hero, no stock photos. Dark mode via CSS variables / `prefers-color-scheme`.
7. **SEO.** Per-page metadata, sitemap, robots (disallow `/admin`, `/home`, `/api`), canonical `https://alinstra.com`.

## Parts

| Part | Commit theme |
|------|----------------|
| 1 | Marketing route group, layout, pages shell, `publicSiteConfig`, brand constants |
| 2 | `publicPlans()` + live pricing table |
| 3 | Lead form, Lead model, admin leads |
| 4 | Design pass (WaveformMark, spacing, dark mode) |
| 5 | SEO, sitemap/robots, `MARKETING_PHONE` env |
| 6 | Compliance `recordingNotice` help text |
| 7 | DEPLOYMENT + ROADMAP docs |

## Tests required

- `publicPlans` ordering and formatting
- Lead action: saves, enqueues admin email, rejects honeypot, rate limits
- sitemap / robots routes
- `/` renders for anonymous without redirect
- Admin leads page gated to admin

## Out of scope

- Stripe checkout / AI interview wizard (Phase 5b in the copy)
- Auto-replies to leads
- Real Privacy / Terms legal text (placeholders only)
- Fast-forward of main/staging
