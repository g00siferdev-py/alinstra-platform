import { Worker, type ResourceLimits } from "node:worker_threads";

const limits: ResourceLimits = {
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 64,
  codeRangeSizeMb: 64,
  stackSizeMb: 4,
};

export class IsolatedJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IsolatedJobError";
  }
}

export function runIsolatedJob(
  processor: URL,
  workerData: unknown,
  timeoutMs: number,
  options?: { transpile?: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(processor, {
      workerData,
      resourceLimits: limits,
      execArgv: options?.transpile ? ["--import", "tsx"] : [],
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      void worker.terminate().finally(() => {
        finish(() => reject(new IsolatedJobError("Extraction timed out.")));
      });
    }, timeoutMs);

    worker.once("message", (message: unknown) => {
      const ok =
        typeof message === "object" && message !== null && "ok" in message && (message as { ok: unknown }).ok === true;
      void worker.terminate();
      if (ok) finish(() => resolve());
      else finish(() => reject(new IsolatedJobError("Extraction failed.")));
    });
    worker.once("error", (error) => {
      void worker.terminate();
      finish(() => reject(error));
    });
    worker.once("exit", (code) => {
      if (code === 0) finish(() => resolve());
      else finish(() => reject(new IsolatedJobError("Extraction timed out.")));
    });
  });
}
