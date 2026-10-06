/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BackupRecord } from "@alinstra/db";
import { BackupsCard } from "./backups-card";

const NOW = new Date("2026-10-06T12:00:00Z");
const HOUR = 3_600_000;

function success(hoursAgo: number, bytes = 5_242_880): BackupRecord {
  return { at: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(), bytes, key: "backups/staging/2026/10/06/a.dump.enc", status: "success" };
}

afterEach(cleanup);

describe("BackupsCard", () => {
  it("is healthy within 36 hours and shows time, size and status", () => {
    const ok = success(5);
    render(<BackupsCard snapshot={{ last: ok, lastSuccess: ok }} now={NOW} />);
    expect(screen.getByTestId("backups-card").dataset.health).toBe("ok");
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByText("5.0 MB")).toBeTruthy();
    expect(screen.getByText("success")).toBeTruthy();
  });

  it("turns red when the last success is more than 36 hours old, even if a later attempt only failed", () => {
    const failed: BackupRecord = { at: NOW.toISOString(), bytes: 0, key: null, status: "failed", error: "pg_dump failed (exit 1)" };
    render(<BackupsCard snapshot={{ last: failed, lastSuccess: success(40) }} now={NOW} />);
    expect(screen.getByTestId("backups-card").dataset.health).toBe("stale");
    expect(screen.getByText(/Overdue/)).toBeTruthy();
    expect(screen.getByText("pg_dump failed (exit 1)")).toBeTruthy();
  });

  it("is red with a clear message before the first backup, and shows not configured", () => {
    const notConfigured: BackupRecord = { at: NOW.toISOString(), bytes: 0, key: null, status: "not_configured", error: "BACKUP_PASSPHRASE is not set on the worker" };
    render(<BackupsCard snapshot={{ last: notConfigured, lastSuccess: null }} now={NOW} />);
    expect(screen.getByTestId("backups-card").dataset.health).toBe("never");
    expect(screen.getByText("No successful backup yet")).toBeTruthy();
    expect(screen.getByText("not configured")).toBeTruthy();
  });
});
