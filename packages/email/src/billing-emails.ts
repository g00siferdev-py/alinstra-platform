/**
 * Phase B Part 4 billing emails (plain text, same pattern as newSignInEmail / provisionFailedEmail).
 */

export function paymentFailedOwnerEmail(input: {
  billingUrl: string;
}): { subject: string; text: string } {
  return {
    subject: "Your payment didn't go through",
    text: [
      "Your payment didn't go through. Update your card to keep Ava answering.",
      "",
      `Update billing: ${input.billingUrl}`,
    ].join("\n"),
  };
}

export function billingResumedOwnerEmail(): { subject: string; text: string } {
  return {
    subject: "You're all set",
    text: [
      "You're all set. Your payment went through and Ava is answering calls again.",
      "",
      "If you have any questions, reply to this email or open Billing in your portal.",
    ].join("\n"),
  };
}

export function billingPausedOwnerEmail(input: {
  billingUrl: string;
}): { subject: string; text: string } {
  return {
    subject: "Ava is paused",
    text: [
      "Ava is paused because a payment is still past due. Update your card so she can answer again.",
      "",
      `Update billing: ${input.billingUrl}`,
    ].join("\n"),
  };
}
