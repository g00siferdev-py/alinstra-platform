/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/clients/[id]/interview/actions", () => ({
  adminSendInterviewMessage: vi.fn(),
  adminFinishInterview: vi.fn(),
  adminDiscardInterview: vi.fn(),
}));

vi.mock("@/app/home/business/interview/actions", () => ({
  ownerSendInterviewMessage: vi.fn(),
  ownerFinishInterview: vi.fn(),
  ownerDiscardInterview: vi.fn(),
}));

import { InterviewChat, INTERVIEW_DISCLAIMER, type InterviewSendResult } from "./interview-chat";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderChat(
  sendMessage: (sessionId: string, message: string, clientMessageId: string) => Promise<InterviewSendResult>,
) {
  return render(
    <InterviewChat
      sessionId="sess_1"
      clientId="client_1"
      audience="owner"
      initialTranscript={[{ role: "assistant", content: "What are your hours?" }]}
      initialCaptured={{}}
      initialDone={false}
      checklist={[
        { id: "gen.hours", label: "Hours", status: "now" },
        { id: "gen.services", label: "Services", status: "todo" },
      ]}
      exitHref="/home/business"
      sendMessage={sendMessage}
    />,
  );
}

describe("InterviewChat send UX", () => {
  it("renders the optimistic message and disables input before the action resolves", async () => {
    let resolveSend!: (value: { ok: true; reply: string }) => void;
    const sendMessage = vi.fn(
      () =>
        new Promise<{ ok: true; reply: string }>((resolve) => {
          resolveSend = resolve;
        }),
    );

    renderChat(sendMessage);

    const input = screen.getByLabelText("Interview answer");
    fireEvent.change(input, { target: { value: "Open 9 to 5 weekdays" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("Open 9 to 5 weekdays")).toBeTruthy();
    expect(screen.getByTestId("interview-thinking")).toBeTruthy();
    expect(screen.getByText("Thinking…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Waiting…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((input as HTMLTextAreaElement).disabled).toBe(true);
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(sendMessage).toHaveBeenCalledWith("sess_1", "Open 9 to 5 weekdays", expect.any(String));

    await act(async () => {
      resolveSend({ ok: true, reply: "Got it — what services do you offer?" });
    });

    await waitFor(() => {
      expect(screen.getByText("Got it — what services do you offer?")).toBeTruthy();
    });
    expect(screen.queryByTestId("interview-thinking")).toBeNull();
    expect((screen.getByLabelText("Interview answer") as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("keeps the owner message and re-enables input on error", async () => {
    const sendMessage = vi.fn(async () => ({ ok: false as const, error: "boom" }));

    renderChat(sendMessage);

    const input = screen.getByLabelText("Interview answer");
    fireEvent.change(input, { target: { value: "We do wellness exams" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByTestId("interview-send-error")).toBeTruthy();
    });

    expect(screen.getByText("We do wellness exams")).toBeTruthy();
    expect(screen.getByText(/That didn't go through/i)).toBeTruthy();
    expect(screen.queryByTestId("interview-thinking")).toBeNull();
    expect((screen.getByLabelText("Interview answer") as HTMLTextAreaElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows still/slow labels without Try again while pending, even after 20s", async () => {
    vi.useFakeTimers();
    let resolveSend!: (value: { ok: true; reply: string }) => void;
    const sendMessage = vi.fn(
      () =>
        new Promise<{ ok: true; reply: string }>((resolve) => {
          resolveSend = resolve;
        }),
    );

    renderChat(sendMessage);
    expect(screen.getByText(INTERVIEW_DISCLAIMER)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Interview answer"), {
      target: { value: "After-hours answering service" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("Thinking…")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByText("Still thinking…")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(14_000);
    });
    expect(screen.getByText("This is taking longer than usual…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    await act(async () => {
      resolveSend({ ok: true, reply: "Thanks — noted." });
    });
  });

  it("shows Try again after ok:false and retries with the same clientMessageId", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, error: "boom" })
      .mockResolvedValueOnce({ ok: true as const, reply: "Recovered." });

    renderChat(sendMessage);

    fireEvent.change(screen.getByLabelText("Interview answer"), {
      target: { value: "Open Saturdays" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    });

    const firstId = sendMessage.mock.calls[0]?.[2] as string;
    expect(firstId).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.getByText("Recovered.")).toBeTruthy();
    });
    expect(sendMessage.mock.calls[1]?.[2]).toBe(firstId);
  });

  it("sends on Enter and allows Shift+Enter for a new line", () => {
    const sendMessage = vi.fn(
      () =>
        new Promise<never>(() => {
          /* hang */
        }),
    );
    renderChat(sendMessage);
    const input = screen.getByLabelText("Interview answer");

    fireEvent.change(input, { target: { value: "line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(sendMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(sendMessage).toHaveBeenCalledWith("sess_1", "line one", expect.any(String));
  });
});
