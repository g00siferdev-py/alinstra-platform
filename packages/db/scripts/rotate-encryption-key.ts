/**
 * Re-encrypts every cipher column (CallRecord, ClientMessage, TransferTarget, KnowledgeBase.staffCipher,
 * KnowledgeDocument.extractedTextCipher, Invite.tokenCipher) from whatever key it is under to the target key.
 * Idempotent, resumable, batched. Prints per-column counts of payloads by key id before and after; never values.
 *
 *   cd /app/packages/db && pnpm exec tsx scripts/rotate-encryption-key.ts --to k2 --dry-run
 *   cd /app/packages/db && pnpm exec tsx scripts/rotate-encryption-key.ts --to k2 [--batch 500]
 *
 * Run it after ENCRYPTION_KEY_V2 is on web and worker and ENCRYPTION_ACTIVE_KEY=2 is deployed. See docs/KEY-ROTATION.md.
 */
import { parseBatch, rotateEncryptionKey } from "../src/encryption-jobs";
import { prisma } from "../src/client";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const known = new Set(["--to", "--dry-run", "--batch"]);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg.startsWith("--") && !known.has(arg)) throw new Error(`Unknown option ${arg}`);
    if (arg === "--batch" || arg === "--to") i += 1;
  }
  const to = option("--to");
  if (!to) throw new Error("Usage: rotate-encryption-key.ts --to k2 [--dry-run] [--batch 500]");
  const dryRun = process.argv.includes("--dry-run");
  const batch = parseBatch(option("--batch"));
  const result = await rotateEncryptionKey({ to, dryRun, batch, log: (line) => console.log(line) });
  const leftover = result.after.reduce((sum, entry) => sum + Object.entries(entry.counts.keys).filter(([id]) => id !== to).reduce((s, [, n]) => s + n, 0), 0);
  if (dryRun) console.log("Dry run: nothing was written.");
  else if (result.failed > 0) {
    console.log(`${result.failed} payload(s) could not be decrypted and were left alone. Check that every key they were written with is still configured.`);
    process.exitCode = 1;
  } else if (leftover === 0) console.log(`Done. Every payload is under ${to}.`);
  else console.log(`Done, but ${leftover} payload(s) are still under another key (written during the run). Run it again.`);
}

main()
  .catch((error: unknown) => {
    console.error(`rotate-encryption-key failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
