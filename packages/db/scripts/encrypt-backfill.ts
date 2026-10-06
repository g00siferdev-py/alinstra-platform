/**
 * Phase S backfill: moves plaintext into the cipher columns (ClientMessage, TransferTarget, KnowledgeBase.staff,
 * KnowledgeDocument.extractedText), sets plaintext to null, and masks phone numbers in ChangeLog and
 * QuickUpdate JSON. Idempotent and resumable; safe to run while the app is live. Prints counts only.
 *
 *   cd /app/packages/db && pnpm exec tsx scripts/encrypt-backfill.ts --dry-run
 *   cd /app/packages/db && pnpm exec tsx scripts/encrypt-backfill.ts [--batch 500]
 *
 * Needs DATABASE_URL and the encryption keyring env (ENCRYPTION_KEY, ENCRYPTION_KEY_V<N>, ENCRYPTION_ACTIVE_KEY).
 */
import { encryptBackfill, parseBatch } from "../src/encryption-jobs";
import { prisma } from "../src/client";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const known = new Set(["--dry-run", "--batch"]);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg.startsWith("--") && !known.has(arg)) throw new Error(`Unknown option ${arg}`);
    if (arg === "--batch") i += 1;
  }
  const dryRun = process.argv.includes("--dry-run");
  const batch = parseBatch(option("--batch"));
  const result = await encryptBackfill({ dryRun, batch, log: (line) => console.log(line) });
  const left = result.remaining.reduce((sum, row) => sum + row.rows, 0);
  console.log(dryRun ? "Dry run: nothing was written." : left === 0 ? "Done. No plaintext remains in the encrypted columns." : "Done. Re-run if any rows raced a live write.");
}

main()
  .catch((error: unknown) => {
    // Message only: errors from this script never carry row values.
    console.error(`encrypt-backfill failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
