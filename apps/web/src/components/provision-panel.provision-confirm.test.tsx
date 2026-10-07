/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const startProvisioningAction = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("@/app/admin/provision-actions", () => ({
  approveNumberPurchaseAction: vi.fn(),
  createClientZeroAction: vi.fn(),
  endServiceNowAction: vi.fn(),
  refreshPaymentLinkAction: vi.fn(),
  retrySyncAction: vi.fn(),
  saveTransferTargetsAction: vi.fn(),
  scheduleChurnAction: vi.fn(),
  startProvisioningAction,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { ProvisionPanel } from "./provision-panel";

const baseProps = {
  clientId: "c1",
  status: "ready",
  syncStatus: "not_provisioned",
  syncError: null,
  checkoutUrl: null,
  billingStatus: "paid",
  phone: null,
  phoneDisplay: null,
  targets: "",
  internal: false,
  steps: [] as [],
  runStatus: null,
  runKind: null,
  numberApproved: false,
  numberPurchase: { tollFree: false, areaCode: "423", monthlyCents: 200, inboundPerMinuteCents: 0 },
  voiceName: "Ava",
  appEnv: "staging",
};

afterEach(() => {
  cleanup();
  startProvisioningAction.mockClear();
});

describe("ProvisionPanel start confirm", () => {
  it("does not call the action on the first click", () => {
    render(<ProvisionPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Start provisioning" }));
    expect(startProvisioningAction).not.toHaveBeenCalled();
    expect(screen.getByText(/buys a real phone number/i)).toBeTruthy();
    expect(screen.getByText(/This is staging/i)).toBeTruthy();
  });

  it("calls the action only after Buy number and provision", async () => {
    render(<ProvisionPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Start provisioning" }));
    fireEvent.click(screen.getByRole("button", { name: "Buy number and provision" }));
    expect(startProvisioningAction).toHaveBeenCalledWith("c1", { numberApproved: true });
  });
});
