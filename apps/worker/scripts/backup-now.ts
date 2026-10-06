/**
 * Runs the nightly backup once, right now, with the worker's own environment. Use it from the Railway
 * worker shell to prove backups work without waiting for 03:30:
 *
 *   cd /app/apps/worker && pnpm exec tsx scripts/backup-now.ts
 *
 * Writes the same result record, sends the same admin notices, and uploads to the same place as the job.
 */
import { runBackupDb } from "../src/jobs/backup";

runBackupDb()
  .then((record) => {
    console.log(`backup ${record.status}: ${record.bytes} bytes${record.key ? ` -> ${record.key}` : ""}${record.error ? ` (${record.error})` : ""}`);
    process.exit(record.status === "success" ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(`backup failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  });
