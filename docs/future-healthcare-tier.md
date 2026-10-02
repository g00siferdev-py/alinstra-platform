# Future: Healthcare Tier (not scheduled)

> Status: idea saved for later. Do not build until the core product is proven on non-healthcare niches (HVAC, veterinary) and Phase 6 (testing, launch, monitoring) is complete. Referenced from RECEPTIONIST_DASHBOARD_BRIEF.md under "Later".

## Target industries
- Weight loss / medical weight management clinics (including GLP-1 programs)
- Med spas
- Dental
- Chiropractic and physical therapy
- Optometry

Note: veterinary clinics are NOT in this tier. Animal health records are not covered by HIPAA.

## Why it's attractive
- High-value callers: a new weight-loss or med-spa client is often worth hundreds of dollars a month for many months, so one missed call can exceed a year of the Starter plan.
- Small, focused service menus: short knowledge bases, fewer ways for the assistant to be wrong.
- Recurring visits (check-ins, weigh-ins, refills, recalls) fit the recall add-on directly.
- Mostly privately owned: the person we pitch is usually the decision-maker.
- Justifies premium pricing: HIPAA-ready service costs more to run, and buyers expect to pay more.

## Requirements before the first healthcare client
1. **Treat every healthcare client as HIPAA-covered**, even cash-pay clinics. Callers volunteer health details ("I'm diabetic, can I do the program?"), so transcripts and recordings will contain protected health information (PHI) regardless of what the assistant asks.
2. **Business Associate Agreement (BAA) with each clinic.** Alinstra acts as their business associate. Have a HIPAA attorney review our BAA template.
3. **BAAs with every subprocessor that touches PHI**, verified against each vendor's current terms:
   - Voice platform (Retell offers a BAA)
   - Telephony / SMS (Twilio offers a BAA on eligible products only)
   - Hosting, database, Redis, and object storage (verify whether Railway signs a BAA; if not, healthcare clients run on HIPAA-eligible infrastructure)
   - LLM providers used for prompt generation, extraction, and grounding checks
   - Error tracking (Sentry: keep PHI scrubbed, or use a BAA-covered plan)
   - Email (Resend: keep PHI out of email content, or use a BAA-covered provider)
   - Uptime monitoring and any analytics
4. **Data handling:** encryption in transit and at rest; access logging (ChangeLog and view-as-client logging already exist); minimum-necessary content in staff notifications (no PHI in texts or emails beyond what's needed); configurable retention with automatic purge and shorter defaults for this tier; recording-consent notices.
5. **Policies and process (Daniel):** HIPAA risk assessment, written security policies, breach notification procedure, workforce training records.

## Product changes for the tier
- Extend the existing "healthcare/privacy-sensitive" wizard flag (which already blocks Submit until compliance review is done) into a **healthcare tier switch** that:
  - routes the client to HIPAA-eligible infrastructure and providers only
  - disables any integration that lacks a BAA
  - applies stricter transcript and recording access and shorter retention defaults
  - uses PHI-minimal notification templates
- Assistant guardrails (on top of the existing no-medical-advice rule): never answer eligibility, dosing, medication, or side-effect questions; route them to a clinician callback; emergencies go to 911.
- Pricing: a separate, higher-priced healthcare tier to cover compliance costs.

## Market notes
- The compounded GLP-1 market was disrupted when the FDA tightened its rules in 2025, and some clinics closed or changed business models. Check a clinic's stability before signing.
- Marketing to this niche should emphasize compliance and privacy as features.

## Timing
After the core product is proven with HVAC and veterinary clients, Phase 6 is complete, and there is revenue to cover legal review and any infrastructure changes.
