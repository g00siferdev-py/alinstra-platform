# Marketing site copy (draft 2, Oct 5, 2026)

Status: draft 1 reviewed by Daniel Oct 4. Draft 2 (Oct 5) adds the redesigned home page (approved mockup: "Final · Landing page" on the design canvas, copy in `docs/design/landing-mockup.html`), the Solo plan, and the Enterprise contact card. `[Product]` is the receptionist product name; render it from the `PRODUCT_NAME` constant. "Ava" is the default persona name callers hear (`ASSISTANT_NAME`).

Open questions: whether "A backup receptionist, not a replacement" should be the headline rather than the subline; whether the founding offer stays "first ten businesses"; Solo overage rate ($0.40/min proposed).

Honesty constraints:
- Messages are delivered by **email**. Text-message delivery is not built; never say "text."
- Direct calendar booking is a later phase. Always say "once your calendar is connected" / "when it's connected."
- Outbound follow-up calls are a named add-on. v1 is list-driven (owner uploads a recall CSV or adds rows; no practice-management integration yet) and requires prior express consent from each customer (TCPA; AI voices count as artificial). Never promise it works on day one. Pricing is not final; the site says "Ask about pricing."
- No "Most popular" badge until we actually have customers. The highlighted plan says "Recommended."
- Enterprise has no published price and no special product yet; it is a contact card only. Do not promise HIPAA.
- The example call, notification cards and recall list on the home page are illustrations (fictional names, 555 numbers).

---

## HOME

### Hero
Pill: Built in Morristown, Tennessee
**The calls you miss are the ones that mattered.**
[Product] answers when your team can't: after hours, over lunch, and when every line is busy. It takes the message, books the request, and sends it to you in seconds.
[Call Ava now: (888) 387-1525] [See pricing]
Subline: A backup receptionist, not a replacement. Your people answer first. Ava catches what they can't.

Live chip (teal, pulsing dot, small waveform): Ava is on a call · 0:42

Notification cards:
- **New message from Ava** · 9:16 PM — Maria G. · AC stopped cooling, 88° inside · call back (423) 555-0198
- **Appointment request** · 7:42 PM — Biscuit's rabies booster · prefers Thursday morning
- **Follow-up booked** · Today — Ava called the Hendersons from your recall list. Furnace tune-up, Oct 14.

### Stat bar
- **2 rings** — That's how fast Ava picks up
- **24/7** — Nights, weekends, and holidays
- **20 min** — One setup chat. No forms.
- **$99/mo** — Plans start with Solo  *(computed from the cheapest active plan)*

Chips row: Made for any business that runs on the phone: HVAC · Veterinary · Home services · Salons · Auto shops · Offices · [See who it's for →]

### How it works
Eyebrow: HOW IT WORKS — **Live in three simple steps.**
1. **Tell us about your business.** Hours, services, who to transfer to, what to say when you're closed. Takes about twenty minutes.
   Mini chat: "What are your hours on Saturday?" / "9 to 1. Closed Sundays."
2. **Forward your calls, or get a new number.** Keep the number you have and let your carrier send the calls you can't pick up to Ava. Or, if you're just starting out, we give you a new local number you can put on the truck and the business cards.
   Mini: Your number (423) 555-0100 → Ava answers
3. **Get every message instantly.** Caller, callback number, and what they need, in your email the moment the call ends.
   Mini email: New message: Maria G. — AC stopped cooling · call back (423) 555-0198 · just now

### What Ava does
Eyebrow: WHAT AVA DOES — **Everything a great front desk does, around the clock.**
Lead: She learns your business from one setup chat, then handles the calls your team can't get to.
- **Answers in two rings** — 24 hours a day, including nights, weekends, and holidays.
- **Takes the message** — Name, callback number, and what they need, written up clearly and sent to you.
- **Schedules appointments** — As a request your office confirms, or booked straight into your calendar when it's connected.
- **Makes follow-up calls** (Add-on) — Calls customers from your recall list so they book the next visit before they forget.
- **Transfers urgent calls** — Gets the emergency to a real person during business hours, without ever giving out a staff member's cell number.
- **Knows your business** — Your hours, services, and policies. She says "I don't know" instead of guessing, and tells callers the truth if they ask whether she's a person.

### Hear Ava for yourself (shown only when the site phone number is set)
Eyebrow: TRY HER RIGHT NOW — **Hear Ava for yourself.**
Call our line. That's Ava, answering for Alinstra. Ask her what you'd ask your own receptionist, then picture her answering for you.
[Call (888) 387-1525]  Toll-free · about two minutes  *("Toll-free" only for 8xx numbers)*
Example call card (header "Example call", pill "Ava · 0:58"):
- Ava: Thanks for calling Alinstra, this is Ava. How can I help?
- Caller: Can you book appointments for my clinic?
- Ava: Yes. I can take the request for your office to confirm, or book it straight into your calendar once it's connected.
- Caller: And if it's an emergency?
- Ava: During business hours I'll transfer them to someone on your team right away.

### Pricing (cards render live from the Plan table)
Eyebrow: PRICING — **Simple plans. No per-call surprises.**
Start on your own with Solo, or let our team set you up. Minutes count only while Ava is on the line, and a typical message takes two to three minutes.
Founding pill: Founding offer: setup fee waived on Starter, Professional, and Premium for our first ten businesses

Cards (see PRICING below for numbers):
- **Solo** (pill: Self-serve) — For owner-operators who want to sound like a real business. CTA [Start Solo]
  Answers 24/7 in two rings · Messages and appointment requests by email · Urgent transfers during business hours · Guided 20-minute setup chat · 1 update to Ava's info each month · $0.40 a minute after 150
- **Starter** — For one location missing a handful of calls a week. CTA [Get started]
  **Everything in Solo** · Hands-on setup review, plus a setup call if you want one · 1 update to Ava's info each month · $0.35 a minute after 300
- **Professional** (badge: Recommended) — For busy offices and after-hours emergencies. CTA [Get started] (primary)
  **Everything in Starter** · Calendar booking once your calendar is connected · 2 updates to Ava's info each month · $0.30 a minute after 1,000
- **Premium** — For high call volume and frequent changes. CTA [Get started]
  **Everything in Professional** · Unlimited updates to Ava's info · Our lowest rate: $0.25 a minute after 2,500
Each card also shows "N minutes included / About X to Y typical calls" (2–3 minutes per call) and the setup line ("Setup $99 one time" on Solo; struck-through fee + "Waived" pill on the others while the founding offer is on). Plan CTAs go to `/signup?plan=<code>`.

Enterprise card (dark): **Enterprise** (pill: Custom pricing) — Several locations, heavy call volume, or special requirements? We'll build a plan around you. [Contact us] → `/start?plan=enterprise`

Every plan includes: A person reviews Ava before she goes live · A local number, or keep yours · Transcripts and recordings · The owner portal · [Compare plans →]

Pricing footnote: Billed monthly. Cancel anytime; service runs to the end of your paid month. Sales tax added where required.

Add-ons:
- **Follow-up calls** (Add-on) — Ava calls your recall list when service is due and books the next visit. Never charged for calls that don't connect. [Ask about pricing →]
- **Calendar booking** (Professional and Premium) — Ava books straight into your calendar once it's connected. Google Calendar first; practice systems on request.

### Ava calls them back, too.
Eyebrow: FOLLOW-UP ADD-ON
Reorders. Annual checkups. Tune-ups. Membership renewals. Every business with a repeat schedule loses revenue to customers who simply forgot. Give Ava your recall list and she calls when it's due, offers the next appointment, and books it.
- Upload a list, or add customers one at a time
- She offers the next opening and books it
- One reminder call that lands is worth the whole month
*Customers must have agreed to be contacted by phone.*
Recall list card: "Recall list · This week · 12 customers due" · pill "4 booked"
- The Hendersons — Furnace tune-up — Booked · Oct 14
- Ravi Patel — AC maintenance plan — Calling now (teal, mini waveform)
- Julia Alvarez — Filter replacement — Left a message
- Mark Brooks — Duct cleaning — Due Oct 20

### Why owners pick it
Eyebrow: WHY OWNERS PICK IT — **Built by people you can actually reach.**
- **You hear the real thing before you buy.** Call the number at the top of this page. That's Ava, answering for us.
- **Transcripts and recordings, your eyes only.** Encrypted, kept 90 days by default, deleted on your schedule. Staff see them only if you say so.
- **Built in Morristown, Tennessee.** Set up by a person, reviewed before it goes live, and you can reach us.

### FAQ
Eyebrow: QUESTIONS — **Good questions, straight answers.**
Still wondering about something? Email us at hello@alinstra.com or just call Ava.
- **Will my callers know they're talking to AI?** Ava sounds natural, and she's honest. If a caller asks whether she's a person, she tells them she's a virtual assistant. Callers also hear a short notice that the call may be recorded.
- **Do I have to change my phone number?** No. Keep your number. Your carrier forwards the calls you don't pick up to Ava. If you'd rather, we can set you up with a new local number too.
- **What happens when Ava can't answer something?** She says she doesn't know instead of guessing, takes a detailed message, and sends it to you right away. During business hours she can transfer urgent calls to a person on your team.
- **Can Ava book appointments?** Yes. On every plan she takes the appointment request and your office confirms it. On Professional and Premium she can book straight into your calendar once it's connected.
- **How long does setup take?** About twenty minutes of your time. Ava asks about your hours, services, and how you want calls handled. A person on our team reviews everything before she goes live.
- **What if I go over my minutes?** Ava keeps answering. Extra minutes are billed at your plan's per-minute rate, shown on each plan above. Minutes only count while she's on the line.

### Final call to action
**Stop missing the calls that matter.**
Try Ava right now, or get set up in about twenty minutes.
[Get started] [Call Ava: (888) 387-1525]

### Footer
Alinstra Technologies LLC — Empowering businesses with the power of AI.
Practical AI for small businesses, starting with the phone. Morristown, Tennessee.
Product: Pricing · Who it's for · Call Ava · Log in
Company: About · hello@alinstra.com · Get started
Legal: Privacy · Terms · AI disclosure
© [current year] Alinstra Technologies LLC · Calls are answered by an AI assistant and may be recorded.

---

## PRICING (cards and table render live from the Plan table)

**Simple plans. No per-call surprises.**
Start on your own with Solo, or let our team set you up. Every plan includes a person reviewing Ava before she goes live, a dedicated local number (or use your own), instant message delivery by email, transcripts and recordings, and the owner portal.

| | Solo | Starter | Professional | Premium |
|---|---|---|---|---|
| Monthly | $99 | $199 | $399 | $699 |
| Included minutes | 150 | 300 | 1,000 | 2,500 |
| Overage | $0.40/min | $0.35/min | $0.30/min | $0.25/min |
| Setup | $99 (self-serve) | $299 | $499 | $799 |
| Included changes/month | 1 | 1 | 2 | Unlimited |

**Founding offer:** setup fee waived on Starter, Professional, and Premium for the first ten businesses. Solo keeps its $99 setup. [Start]
Not sure which plan? Just you and your truck? Solo. Most single-location businesses that miss 5 to 15 calls a week fit Starter. A busy clinic or a company with after-hours emergencies usually wants Professional.
Minutes count only while Ava is on the line. A typical message takes two to three minutes.
Billed monthly. Cancel anytime; service runs to the end of your paid month. Sales tax added where required.

**Enterprise:** Several locations, heavy call volume, or special requirements? We'll build a plan around you. [Contact us]

**Add-ons**
**Follow-up calls:** Upload your recall list and Ava calls each customer when their service is due and books the next visit. Simple monthly tiers; you're never charged for calls that don't connect. [Ask about pricing]
**Calendar booking:** Direct scheduling into your calendar (Google Calendar first; practice management systems on request). Included on Professional and Premium once connected.

---

## INDUSTRIES

**HVAC and home services**
Your techs are on roofs and in crawlspaces. Ava takes the "my AC just died" call at 9 p.m., gets the address and the problem to the on-call tech, or books the morning slot. Come fall, hand her your maintenance-plan list and she calls to schedule the furnace tune-up before the first cold snap.

**Veterinary clinics**
Front desk slammed, three on hold, the phone keeps ringing. Ava takes the refill request and the "is this an emergency" call, gives your after-hours instructions word for word, and never guesses on medical advice. And when a patient's rabies booster or flea refill comes due, give Ava the recall list and she calls the owner and books the visit, so that list stops being a sticky note.

**More coming.** Dental, med spa, chiropractic, and medical weight management are on the way with a HIPAA-ready tier. [Tell us your industry]

---

## ABOUT

**Alinstra Technologies**
Empowering businesses with the power of AI.

**Alinstra Technologies** builds practical AI for small businesses, starting with the phone.
We're based in Morristown, Tennessee. [Product] is our first product. It exists because every small business owner we know has the same story: the call that came in while they were under a sink, on a ladder, or with a patient, and the customer who went to the next name on the list.
We don't cold call, we don't make AI robocalls, and we tell callers the truth when they ask if Ava is a person.
[Call Ava] [Email us: hello@alinstra.com]

---

## START (lead form for questions and Enterprise)

**Get in touch.**
Questions, Enterprise, or not sure which plan? Tell us about your business and we'll get back to you within one business day.
Fields: business name, your name, phone, email, industry, roughly how many calls you miss a week.
When `LAUNCH_STATE` is unset or `prelaunch`, plan CTAs on Home and `/pricing` go to `/start?plan=<code>` and `/signup` redirects to `/start`. When `LAUNCH_STATE=live`, plan CTAs go to `/signup?plan=<code>`. General "Get started" / "Ask about pricing" and Enterprise go to `/start` (Enterprise may include `?plan=enterprise`). When the visitor arrives with a plan chip (`/start?plan=…`), show "Plan: Solo" (etc.) above the form and save it on the lead.
After submit: "Thanks. We'll call you within one business day to walk through setup, and you'll be live within 24 hours of that call."

---

## LEGAL

**AI disclosure:** Calls to [Product] numbers are answered by an AI assistant. If a caller asks whether they're speaking with a person, the assistant says it's a virtual assistant.
**Recording:** Calls may be recorded for message accuracy and quality. The business you called controls how long recordings are kept.
**Follow-up calls:** Businesses using the Follow-up add-on attest that each customer called has given prior express consent to be contacted by phone.
Privacy policy and terms of service: to be drafted once the public address is final.
