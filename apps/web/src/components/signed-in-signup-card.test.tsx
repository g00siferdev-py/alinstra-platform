/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signOut } = vi.hoisted(() => ({
  signOut: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut },
}));

import { SignedInSignupCard } from "./signed-in-signup-card";

describe("SignedInSignupCard", () => {
  let originalLocation: Location;

  beforeEach(() => {
    signOut.mockClear();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "" },
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("sends owners to the dashboard and admins to admin", () => {
    const { rerender } = render(<SignedInSignupCard email="owner@example.com" role="client_owner" planQuery="solo" />);
    expect(screen.getByRole("link", { name: "Go to your dashboard" }).getAttribute("href")).toBe("/home");
    rerender(<SignedInSignupCard email="admin@example.com" role="admin" planQuery="solo" />);
    expect(screen.getByRole("link", { name: "Go to admin" }).getAttribute("href")).toBe("/admin");
  });

  it("signs out and returns to the same plan signup URL", async () => {
    render(<SignedInSignupCard email="admin@example.com" role="admin" planQuery="solo" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out and create a new account" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(window.location.href).toBe("/signup?plan=solo");
  });
});
