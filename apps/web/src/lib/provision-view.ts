export type ProvisionStepView = { name: string; label: string; status: string; error: string | null };

export type NumberPurchaseView = {
  tollFree: boolean;
  areaCode: string | null;
  monthlyCents: number;
  inboundPerMinuteCents: number;
};

export const AWAITING_APPROVAL = "awaiting_approval";

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function numberKindText(purchase: NumberPurchaseView): string {
  return purchase.tollFree ? "toll-free number" : `local number${purchase.areaCode ? ` in area code ${purchase.areaCode}` : ""}`;
}

export function numberCostText(purchase: NumberPurchaseView): string {
  const minutes = purchase.inboundPerMinuteCents > 0 ? ` plus $${(purchase.inboundPerMinuteCents / 100).toFixed(2)} per inbound minute` : "";
  return `Buy a ${numberKindText(purchase)} for ${dollars(purchase.monthlyCents)}/month${minutes}. Retell bills this to the card on file every month until the number is released.`;
}

export type Headline = { tone: "muted" | "running" | "live" | "failed"; text: string; error?: string | null };

export function provisionHeadline(input: {
  status: string;
  phoneDisplay: string | null;
  runStatus: string | null;
  runKind: string | null;
  steps: ProvisionStepView[];
}): Headline {
  const { status, phoneDisplay, runStatus, runKind, steps } = input;
  if (runKind === "provision" && runStatus === "failed") {
    const failed = steps.find((step) => step.status === "failed");
    const detail = failed?.error ?? null;
    return { tone: "failed", text: `Failed at ${failed?.label ?? "an unknown step"}${detail ? `: ${detail.split("\n")[0]}` : ""}`, error: detail };
  }
  if (runKind === "provision" && runStatus === "running") {
    if (steps.some((step) => step.status === AWAITING_APPROVAL)) return { tone: "running", text: "Waiting for your approval to buy a phone number" };
    const index = steps.findIndex((step) => step.status !== "succeeded");
    const position = index === -1 ? steps.length : index + 1;
    const current = steps[position - 1];
    return { tone: "running", text: `Provisioning — step ${position} of ${steps.length}: ${current?.label ?? ""}` };
  }
  if (runKind === "teardown" && runStatus === "running") return { tone: "running", text: "Ending service" };
  if (runKind === "teardown" && runStatus === "failed") {
    const failed = steps.find((step) => step.status === "failed");
    return { tone: "failed", text: `Teardown failed at ${failed?.label ?? "an unknown step"}`, error: failed?.error ?? null };
  }
  if (status === "churned") return { tone: "muted", text: "Service ended" };
  if (status === "live" && phoneDisplay) return { tone: "live", text: `Live · ${phoneDisplay}` };
  if (status === "live") return { tone: "live", text: "Live" };
  return { tone: "muted", text: "Not provisioned" };
}
