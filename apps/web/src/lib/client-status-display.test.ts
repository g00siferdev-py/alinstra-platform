import { describe, expect, it } from "vitest";
import { clientStatusDisplay, clientStatusSortRank } from "./client-status-display";

describe("clientStatusDisplay", () => {
  it("labels paid self-serve leads by wizard state", () => {
    expect(
      clientStatusDisplay({
        status: "lead",
        billingStatus: "paid",
        wizardSubmittedAt: new Date("2026-10-01"),
      }),
    ).toEqual({ label: "Held for review", awaitingReview: true });
    expect(
      clientStatusDisplay({
        status: "held_for_review",
        billingStatus: "paid",
        wizardSubmittedAt: new Date("2026-10-01"),
      }),
    ).toEqual({ label: "Held for review", awaitingReview: true });
    expect(
      clientStatusDisplay({
        status: "lead",
        billingStatus: "paid",
        wizardSubmittedAt: null,
      }),
    ).toEqual({ label: "Paid · setting up", awaitingReview: false });
    expect(
      clientStatusDisplay({
        status: "live",
        billingStatus: "paid",
        wizardSubmittedAt: new Date(),
      }),
    ).toEqual({ label: "live", awaitingReview: false });
  });

  it("ranks awaiting-review clients first", () => {
    expect(
      clientStatusSortRank({
        status: "lead",
        billingStatus: "paid",
        wizardSubmittedAt: new Date(),
      }),
    ).toBe(0);
    expect(
      clientStatusSortRank({
        status: "lead",
        billingStatus: "paid",
        wizardSubmittedAt: null,
      }),
    ).toBe(1);
  });
});
