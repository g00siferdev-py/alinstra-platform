import { parentPort, workerData } from "node:worker_threads";
import { extractKnowledge } from "./extract-knowledge-text.ts";

const documentId =
  typeof workerData === "object" && workerData !== null && "documentId" in workerData
    ? String((workerData as { documentId: unknown }).documentId)
    : "";

if (!documentId) {
  throw new Error("Missing document id");
}

await extractKnowledge(documentId);
parentPort?.postMessage({ ok: true });
