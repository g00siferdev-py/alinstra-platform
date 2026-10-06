/**
 * Phase B part 1: creates UsageRecord rows for existing ended CallRecords.
 * Idempotent and resumable. Prints counts only (never values).
 *
 *   cd packages/db && pnpm exec tsx scripts/usage-backfill.ts --dry-run
 *   cd packages/db && pnpm exec tsx scripts/usage-backfill.ts [--batch 500]
 *
 * Needs DATABASE_URL.
 */
import { prisma } from "../src/client";
import { backfillUsageRecords } from "../src/usage";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseBatch(raw: string | undefined): number {
  if (!raw) return 500;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error("--batch must be a positive integer");
  return value;
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
  const result = await backfillUsageRecords({ dryRun, batch, log: (line) => console.log(line) });
  console.log(
    dryRun
      ? `Dry run: would create ${result.created} row(s); ${result.skipped} already present.`
      : result.created === 0
        ? "Done. Nothing new to create."
        : `Done. Created ${result.created} row(s); ${result.skipped} already present.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(`usage-backfill failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
