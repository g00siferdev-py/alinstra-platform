# Phase 3

Status: implemented on `phase-3`, with the 3 October 2026 review fixes. Not on `main`. No live Retell or Stripe calls until `RETELL_API_KEY` and `STRIPE_SECRET_KEY` are set. Local development and tests use in-memory fakes.

## Docs checked on 3 October 2026

- [Create phone number](https://docs.retellai.com/api-references/create-phone-number) (spec `2026-09-14-b240eb0`). Bind with `inbound_agents: [{ agent_id, weight: 1 }]`. `agent_version` is optional. The schema does not say what happens when it is omitted, so the app sends `agent_version: "latest_published"`. That tag is defined as the most recently published version. `allowed_outbound_country_list` empty means every country. We send `["US", "CA"]`. `area_code` is a 3-digit integer and currently only a US area code. `toll_free: true` buys a toll-free number. `country_code` is `US` or `CA` and defaults to `US` when omitted, including for toll-free, so a toll-free buy does not send `area_code` or `country_code`.
- [Phone number single-agent fields](https://docs.retellai.com/deprecation-notice/2026/03-31_phone_number_agent_fields). `inbound_agent_id` was removed after 31 March 2026. The replacement is `inbound_agents`.
- [Custom function](https://docs.retellai.com/build/single-multi-prompt/custom-function) and the create-LLM `CustomTool.parameters` schema. Parameters are a JSON Schema object (`type: "object"`, `properties`, `required`). Omitting them defines a function with an empty parameter list. The model fills properties that have a `description`.
- [Create Retell LLM](https://docs.retellai.com/api-references/create-retell-llm). `default_dynamic_variables` is a string map used when a request does not supply the variable. The create request has no name and no metadata field, so an LLM cannot be found again by `alinstra-<clientId>`. `findLlmId` is gone. An orphan LLM has no monthly fee; deleting it is cleanup.
- [Inbound call webhook](https://docs.retellai.com/features/inbound-call-webhook). The body is `{ event: "call_inbound", call_inbound: { to_number, ... } }`. The response is `{ call_inbound: { dynamic_variables } }`. A non-2xx is retried, with a 10-second timeout.
- [Stripe subscription billing periods](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end). `current_period_end` is on the subscription item. The current Stripe API version is `2026-09-30.endive` ([versioning](https://docs.stripe.com/api/versioning)). Monthly releases after basil are non-breaking, so item periods are still the shape. Every Stripe request sends `Stripe-Version: 2026-09-30.endive`.
- [Stripe signatures](https://docs.stripe.com/webhooks/signatures). During secret rotation the header contains more than one `v1=` signature. Verification accepts the header when any `v1` matches.

Checked against the live docs on 2 October 2026:

- Retell spec revision `2026-08-12` for create/update LLM and agent, and `2026-09-14` for delete LLM. A single-prompt agent is a Retell LLM (`general_prompt`, no `states`) plus an agent whose `response_engine` is `{ type: "retell-llm", llm_id }`. [Create Retell LLM](https://docs.retellai.com/api-references/create-retell-llm), [create agent](https://docs.retellai.com/api-references/create-agent), [update Retell LLM](https://docs.retellai.com/api-references/update-retell-llm), [publish agent version](https://docs.retellai.com/api-references/publish-agent), [agent versions](https://docs.retellai.com/agent/version).
- Published agent versions are immutable. Sync creates a draft with `POST /create-agent-version/{agent_id}` when the current version is published, patches the LLM and agent at that version, then `POST /publish-agent-version/{agent_id}`. The legacy `POST /publish-agent/{agent_id}` was deprecated on 20 July 2026.
- Delete LLM is `DELETE /delete-retell-llm/{llm_id}` and removes every version. Delete the agent first. A 404 on delete counts as success.
- `{{current_time}}` is always `America/Los_Angeles`. The publish step rewrites that token to `{{current_time_<IANA>}}` from `Client.timezone` and does not change the stored prompt. [Dynamic variables](https://docs.retellai.com/build/dynamic-variables).
- Webhooks: `X-Retell-Signature` is `v=<unix-ms>,d=<HMAC-SHA256(rawBody + timestamp, apiKey)>`, five-minute window, raw body only. The same key verifies webhooks when it has the webhook badge. Signature and timestamp only. No IP allowlist. [Secure webhook](https://docs.retellai.com/features/secure-webhook).
- Call events used here are `call_started` and `call_ended` (`call_id`, timestamps, `from_number`, `disconnection_reason`). Transcripts are not stored. [Webhook overview](https://docs.retellai.com/features/webhook-overview).
- Transfer destinations can be a predefined E.164 number. Custom tools time out at 8 seconds. [Custom function](https://docs.retellai.com/build/single-multi-prompt/custom-function).
- Retell has no sandbox. Testing bills like production. A Retell number is about $2 per month plus per-minute voice and telephony. There is no API spend cap; billing is post-usage. [Testing pricing](https://docs.retellai.com/test/testing-pricing), [billing](https://docs.retellai.com/accounts/billing).
- Stripe Checkout `mode=subscription` puts one-time prices on the first invoice only. Lookup keys move to a new Price with `transfer_lookup_key`; existing subscriptions keep the Price they were created with. [Checkout](https://docs.stripe.com/api/checkout/sessions/create), [lookup keys](https://docs.stripe.com/products-prices/manage-prices).

## Decisions Daniel confirmed

1. Payment is a Checkout session in subscription mode. The setup fee is a one-time line item unless it is waived. The link is shown on the admin client page. The card stays on file and the subscription bills monthly. Retell steps may finish before payment. The client status stays `awaiting_payment` until Checkout completes, then `live`. Client zero skips billing.
2. Daniel creates the Retell account under Alinstra Technologies, LLC. One `RETELL_API_KEY` per environment does API calls and webhook verification. Staging and production use different keys.
3. Voice ids wait for Daniel. `docs/voice-options.md` lists previews. Until he picks, provisioning uses `RETELL_DEFAULT_VOICE_ID`.
4. Client zero transfers to `DANIEL_TRANSFER_NUMBER` during the hours on its wizard. After hours it takes a message and emails Daniel (`ADMIN_EMAIL`).
5. Churn defaults to the end of the paid period. The number stays up until then. A worker sweep tears it down after `serviceEndsAt`. **End service now** cancels Stripe immediately and tears down.
6. Prices are created from the plan catalog with lookup keys `plan_<code>_monthly` and `plan_<code>_setup`. A price change creates a new Price and moves the lookup key. Existing subscriptions are not moved. `plan_<code>_overage` is reserved for metered overage in Phase 6 and is not created yet.
7. Healthcare-flagged clients cannot be provisioned.
8. The first live test is staging, with no tunnel. Local development uses the fakes.
9. Signature and timestamp only.
10. Client zero is excluded from revenue and margin. Its provider costs belong in an internal bucket when cost reporting exists. This phase does not compute margin.

## What shipped

- Provisioning steps, in order: `stripe_customer`, `stripe_checkout`, `retell_llm`, `retell_agent`, `retell_number`, `retell_bind`. One open run per client. A stored external id is not created again. Admin starts the run. Wizard submit does not.
- Agent sync when an active config is activated, rolled back, approved from a change request or held update, or when transfer targets change. The client page shows In sync, Syncing, or Sync failed — retry. A failure emails the admin. The job is safe to run again.
- `take_message` stores the message and emails the client's message recipients. Client zero also emails Daniel. SMS stays Phase 5. Home and the admin client page list messages.
- Transfer targets are label plus E.164, edited in the wizard, on the admin client page, and by the owner quick update `transfers`. The transfer tool allows only those numbers, and only inside `weeklyHours`. Otherwise it tells the agent to take a message.
- Call rows store call id, client, start, end, duration, masked caller, and end reason.
- Client zero is an internal client named Alinstra, created from the clients list. $0, no Checkout, no subscription. It is not in a revenue query because there is no revenue query yet; `internal` is the flag that query will use.

## Staging spend

Use one Retell number, for client zero. Watch the Retell Billing tab. Releasing the number (`DELETE /delete-phone-number/{e164}`, or End service now) stops the monthly number charge. There is no switch in this repo that caps Retell's invoice.

## Still later

Calendar booking and SMS are Phase 5. Transcripts, call history, and metered overage billing are Phase 6. The voice label map is blocked on Daniel's pick in `docs/voice-options.md`.
