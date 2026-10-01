import { parentPort } from "node:worker_threads";

const started = Date.now();
while (Date.now() - started < 30_000) {
  // Synchronous work. The parent thread must kill this worker; a timer here never runs.
}
parentPort?.postMessage({ ok: true });
