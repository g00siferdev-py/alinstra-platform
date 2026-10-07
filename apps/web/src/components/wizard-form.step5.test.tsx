/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/navigation-guard", () => ({
  useNavigationGuard: () => null,
}));

vi.mock("@/components/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/app/admin/actions", () => ({
  continueWizardAction: vi.fn(),
  discardWizardAction: vi.fn(),
  editClientStepAction: vi.fn(),
  previewWizardPromptAction: vi.fn(async () => ({ prompt: "" })),
  saveDraftAction: vi.fn(),
  submitWizardAction: vi.fn(),
}));

import { WizardForm, type WizardFormPayload } from "./wizard-form";

afterEach(() => {
  cleanup();
});

const emptyPayload: WizardFormPayload = {
  version: 1,
  business: { contactName: "Ada", name: "Ada Co", industry: "hvac", timezone: "America/New_York" },
  plan: {},
  coverage: {},
  features: { liveTransfer: false, weeklyHoursText: "", transferTargetsText: "" },
  voice: {},
  knowledge: { hours: "Mon-Fri 9-5" },
  phone: {},
  compliance: {},
};

function renderStep5(audience: "admin" | "owner") {
  return render(
    <WizardForm
      clientId="c1"
      initialStep={5}
      initialUpdatedAt={new Date().toISOString()}
      initialPayload={emptyPayload}
      plans={[{ id: "p1", name: "Starter", monthlyPriceCents: 9900 }]}
      documents={[]}
      audience={audience}
      mode="edit"
      backHref="/home"
    />,
  );
}

describe("WizardForm step 5 audience", () => {
  it("hides text and recall controls for owners", () => {
    renderStep5("owner");
    expect(screen.queryByText("Text confirmations")).toBeNull();
    expect(screen.queryByText("Text reminders")).toBeNull();
    expect(screen.queryByText("Recall add-on")).toBeNull();
    expect(screen.getByText("Messages")).toBeTruthy();
  });

  it("shows text and recall controls for admins", () => {
    renderStep5("admin");
    expect(screen.getByText("Text confirmations")).toBeTruthy();
    expect(screen.getByText("Text reminders")).toBeTruthy();
    expect(screen.getByText("Recall add-on")).toBeTruthy();
  });

  it("locks owners to request_only without a Direct to calendar option", () => {
    renderStep5("owner");
    expect(
      screen.getByText("Appointment requests: Ava takes them and emails them to you to confirm."),
    ).toBeTruthy();
    expect(screen.queryByText("Direct to calendar")).toBeNull();
    expect(screen.queryByLabelText("Booking mode")).toBeNull();
  });

  it("keeps the booking mode dropdown for admins", () => {
    renderStep5("admin");
    expect(screen.getByText("Direct to calendar")).toBeTruthy();
    expect(screen.getByText("Request only")).toBeTruthy();
    expect(
      screen.queryByText("Appointment requests: Ava takes them and emails them to you to confirm."),
    ).toBeNull();
  });
});
