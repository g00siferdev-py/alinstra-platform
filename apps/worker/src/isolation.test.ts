import { EXTRACT_TIMEOUT_MS } from "@alinstra/db";
import { bullConnection, EMAIL_QUEUE } from "@alinstra/queue";
import { Queue, Worker } from "bullmq";
import { describe, expect, it } from "vitest";
import { runIsolatedJob } from "./jobs/run-isolated";

describe("extraction isolation", () => {
  it("kills a stuck extraction while the email queue still processes a job", async () => {
    const prefix = `iso-${process.pid}-${Date.now()}`;
    const connection = bullConnection();
    let emailDone = false;
    const email = new Worker(
      EMAIL_QUEUE,
      async () => {
        emailDone = true;
      },
      { connection, prefix, concurrency: 1 },
    );
    const queue = new Queue(EMAIL_QUEUE, { connection, prefix });
    const stuck = runIsolatedJob(new URL("./jobs/stuck-extraction.mjs", import.meta.url), {}, 1_500);
    try {
      await email.waitUntilReady();
      await queue.add("send-invite-email", { inviteId: "iso-test" });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("email queue did not process the job")), 3_000);
        const poll = setInterval(() => {
          if (!emailDone) return;
          clearTimeout(timer);
          clearInterval(poll);
          resolve();
        }, 20);
      });
      expect(emailDone).toBe(true);
      await expect(stuck).rejects.toThrow(/timed out/);
      expect(EXTRACT_TIMEOUT_MS).toBeGreaterThan(1_500);
    } finally {
      await Promise.all([email.close(), queue.close()]);
    }
  }, 10_000);
});
