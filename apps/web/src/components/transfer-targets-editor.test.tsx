/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TransferTargetsEditor,
  serializeTransferTargets,
  transferTargetsEditorError,
} from "./transfer-targets-editor";

afterEach(() => {
  cleanup();
});

describe("TransferTargetsEditor", () => {
  it("normalizes 423-555-0142 on blur and shows per-row errors", () => {
    const onTargetsChange = vi.fn();
    render(
      <TransferTargetsEditor
        liveTransfer
        transferTargetsText=""
        contactName="Daniel"
        onLiveTransferChange={() => undefined}
        onTargetsChange={onTargetsChange}
      />,
    );

    const phone = screen.getByLabelText("Phone number");
    fireEvent.change(phone, { target: { value: "423-555-0142" } });
    fireEvent.blur(phone);
    expect((phone as HTMLInputElement).value).toBe("(423) 555-0142");

    const name = screen.getByLabelText("Name or role");
    fireEvent.change(name, { target: { value: "" } });
    expect(screen.getByText("Add a name or role for this number")).toBeTruthy();
  });

  it("does not show a phone error on an empty new row until blur", () => {
    render(
      <TransferTargetsEditor
        liveTransfer
        transferTargetsText=""
        contactName="Daniel"
        onLiveTransferChange={() => undefined}
        onTargetsChange={() => undefined}
      />,
    );

    expect(screen.queryByText("That isn't a full US or Canada phone number")).toBeNull();

    const phone = screen.getByLabelText("Phone number") as HTMLInputElement;
    expect(phone.getAttribute("type")).toBe("tel");
    expect(phone.getAttribute("inputMode")).toBe("tel");

    fireEvent.blur(phone);
    expect(screen.getByText("That isn't a full US or Canada phone number")).toBeTruthy();
  });

  it("clears the requirement when choosing take a message instead", () => {
    const rows = [{ id: "1", label: "", phone: "" }];
    expect(transferTargetsEditorError(true, rows)).toMatch(/Add at least one phone number/i);
    expect(transferTargetsEditorError(false, rows)).toBeNull();
    expect(serializeTransferTargets(false, rows)).toBe("");
  });
});
