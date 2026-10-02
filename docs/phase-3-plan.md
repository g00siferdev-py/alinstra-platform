# Phase 3 plan

Status: draft for review. No Phase 3 code in this change. Stop here.

Checked against the live docs on 2 October 2026:

- Retell OpenAPI revision `2026-08-12-9e090f0` ([create agent](https://docs.retellai.com/api-references/create-agent), [create phone number](https://docs.retellai.com/api-references/create-phone-number), [delete agent](https://docs.retellai.com/api-references/delete-agent), [delete phone number](https://docs.retellai.com/api-references/delete-phone-number), [dynamic variables](https://docs.retellai.com/build/dynamic-variables), [secure webhook](https://docs.retellai.com/features/secure-webhook), [custom function](https://docs.retellai.com/build/single-multi-prompt/custom-function))
- Stripe billing docs current that day ([subscription create](https://docs.stripe.com/api/subscriptions/create), [setup fee on the first invoice](https://docs.stripe.com/billing/invoices/subscription), [cancel](https://docs.stripe.com/billing/subscriptions/cancel), [customer portal session](https://docs.stripe.com/api/customer_portal/sessions/create))

Staging uses Retell and Stripe **test** mode only. Production keys wait until a later checklist.

## What this phase does

After an admin approves a submitted wizard, a provisioning run turns that lead into a live client: a Stripe customer and subscription, a Retell agent whose prompt is the active `AgentConfig`, a phone number, and signed webhooks. The admin sees each step's status and can retry a failed step without repeating a step that already succeeded. A live client can be churned: release the number, delete the agent, cancel Stripe. The first provisioned client is Alinstra itself.

Calendar booking stays in Phase 5. Phase 3 tools that are not ready yet answer with a message-taking fallback instead of failing the call.

## Decisions

A. Provisioning is a list of named steps on a `ProvisioningRun`, one active run per client. Each step stores `pending`, `running`, `succeeded`, or `failed`, plus the external id when one exists, the last error, and timestamps. The admin client page shows that list and a Retry button on the failed step. Retry runs that step again and then continues forward. A step whose external id is already stored returns success without calling the provider again. A provider 404 on a later churn step counts as success so a half-finished teardown can be repeated.

B. Steps, in order: `stripe_customer`, `stripe_subscription`, `retell_agent`, `retell_number`, `retell_bind`. The run starts only from an admin action on a submitted, non-healthcare-blocked client that has one active `AgentConfig`. It does not start from wizard submit. Nothing in the run calls Twilio or a calendar.

C. The Retell agent is a single-prompt agent. `general_prompt` is the active config's prompt text with one substitution: the template token `{{current_time}}` is replaced by Retell's timezone variable `{{current_time_<IANA>}}`, using `Client.timezone`. Retell's plain `{{current_time}}` is always `America/Los_Angeles` ([dynamic variables](https://docs.retellai.com/build/dynamic-variables)). The timezone form, for example `{{current_time_America/New_York}}`, is filled by Retell at speak time. The stored `AgentConfig.prompt` is not rewritten. `platformAgentId` is set to the returned agent id when `retell_agent` succeeds. Voice id comes from a fixed map of the wizard's voice label to a Retell voice id, checked in at implementation time against the voice list, not guessed in this plan.

D. The phone number is created with `POST /create-phone-number` and bound to that agent as the inbound agent. `inbound_webhook_url` points at our inbound route. The webhook may set `dynamic_variables` and may reject a call. Signature check is the same as the call-event webhook. The number is stored in E.164; that string is the id for later delete.

E. Every Retell webhook and custom-function call is verified before any write. Header `X-Retell-Signature` is `v=<unix-ms>,d=<hex>`. The digest is HMAC-SHA256 of the raw body concatenated with the timestamp, keyed by the API key that has the webhook badge. Reject timestamps older than five minutes. Verify the raw bytes, not a re-serialized JSON object ([secure webhook](https://docs.retellai.com/features/secure-webhook), [custom function](https://docs.retellai.com/build/single-multi-prompt/custom-function)). A bad signature is 401 and is not retried by us.

F. Mid-call tools are Retell custom functions: `take_message` and `transfer`. `transfer` uses Retell's built-in transfer to the number on the client (staff directory, or Daniel's cell for client zero). `take_message` POSTs to our endpoint. The request body is `{ name, call, args }` (payload-args-only stays off). We store the message, return 200 and a short sentence the agent can read. Timeout is 8 seconds. `max_retry` stays 0 so a slow handler is not invoked twice. If we return non-2xx, time out, or the tool is one we do not implement yet (booking), the agent receives Retell's error string. The published prompt already says to take a message when unsure; the tool description repeats that a failure means offer to take a message and do not invent a booking. Talk-while-waiting is a static line ("One moment."). Booking is not registered as a callable tool in this phase.

G. Stripe staging uses `sk_test_` keys. One Customer per client. Prices are created once per plan in test mode (recurring monthly amount, and a one-time setup price) and reused by id. The subscription is `POST /v1/subscriptions` with the recurring price. Unless `setupFeeWaived` is set, the setup price is sent as `add_invoice_items`, which Stripe documents as the way to put a one-time charge on the first subscription invoice. `payment_behavior` is `default_incomplete` so the first invoice can wait for a card. The customer portal is a Billing Portal session (`POST /v1/billing_portal/sessions`) from the admin client page in this phase, return URL back to that page. Portal configuration in the test dashboard allows invoice history and payment-method update. Cancel for churn is `DELETE /v1/subscriptions/:id` (immediate). Stripe webhooks (`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`) are verified with the signing secret and update the stored billing status. They do not provision or tear down Retell by themselves.

H. Client zero is a real `Client` row with `internal: true`, name Alinstra, plan amount $0, setup fee waived. It is excluded from revenue and margin totals. Provisioning still creates the Retell agent and number. Stripe customer is created; the subscription step is skipped and marked succeeded with a note, because there is nothing to bill. The agent takes messages and transfers to Daniel's cell. The cell number is an env var, not a hardcoded literal. Calendar booking is not offered; if a caller asks, the agent takes a message. That booking tool arrives in Phase 5.

I. Churn is an admin action on a live client, separate from Remove (Remove stays lead and demo only). Order: delete the Retell number (`DELETE /delete-phone-number/{e164}`, 204), delete the agent (`DELETE /delete-agent/{agent_id}`, 204, all versions), cancel the Stripe subscription if one exists. Each of those is its own step with the same retry rules. Client status becomes `churned`. A second churn run is a no-op once the external ids are cleared or the provider returns 404.

J. Scoped repositories and a change-log row in the same transaction as each status write. Provider calls happen outside the transaction, then the result is saved. A crash after the provider succeeds and before the save is recovered by retry: the step looks up the external object by our idempotency key (Stripe `Idempotency-Key` header on customer and subscription creates; Retell agent metadata `client_id`) and stores the id it finds.

## Client zero, first

1. Seed or admin-create the Alinstra client with the internal flag, $0, and Daniel's transfer number from the env var.
2. Run provisioning. Expect the Stripe subscription step to be skipped, and the Retell agent and number to succeed.
3. Call the number. A message is stored. A transfer request rings Daniel's cell. A booking request becomes a message, not a calendar event.

## Open questions

1. Should the first invoice be `send_invoice` (Stripe emails a bill, subscription becomes active before payment) or stay `default_incomplete` until the portal collects a card? This plan uses `default_incomplete`.
2. Who owns the Retell account and the test API key, and is the webhook-badged key the same key we use for create-agent?
3. Which Retell voice ids match the wizard's voice labels? That map needs a pass against the current voice list before implementation.
4. Is Daniel's cell the only transfer target for client zero, and should after-hours calls still transfer or only take a message?
5. Should churn cancel Stripe immediately (this plan) or at period end (`cancel_at_period_end`)?
6. Do we create Stripe Prices from the plan catalog in code, or will Daniel create them in the test dashboard and paste the ids?
7. Healthcare clients stay blocked until a later compliance review. Confirm they cannot be provisioned in Phase 3.
8. The custom-function URL must be public. Staging's grey-cloud hostname is enough. Local tests need a tunnel. Is that acceptable for the first live test of client zero?
9. Retell documents one outbound IP (`100.20.5.228`). Do we allowlist it in addition to the signature check, or signature only?
10. Margin exclusion for client zero: exclude the whole client from the revenue query, or also exclude Retell's per-minute cost from a cost report we do not have yet?
