/**
 * Decrypts an Alinstra database backup (`.dump.enc`) into a pg_restore-ready custom-format dump.
 *
 *   pnpm --filter @alinstra/worker exec tsx scripts/backup-decrypt.ts <in.enc> <out.dump>
 *
 * The passphrase comes from BACKUP_PASSPHRASE, or a hidden prompt when that is not set.
 * It needs no database, Redis, or other environment. See docs/RESTORE.md.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { createBackupDecryptStream } from "@alinstra/crypto";

function promptHidden(question: string): Promise<string> {
  return new Promise((resolvePrompt) => {
    let muted = false;
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        if (!muted) process.stderr.write(chunk);
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output: sink, terminal: true });
    process.stderr.write(question);
    muted = true;
    rl.question("", (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolvePrompt(answer);
    });
  });
}

async function main(): Promise<void> {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Usage: tsx scripts/backup-decrypt.ts <in.enc> <out.dump>");
    process.exitCode = 2;
    return;
  }
  const inPath = resolve(input);
  const outPath = resolve(output);
  if (inPath === outPath) {
    console.error("Refusing to overwrite the input file.");
    process.exitCode = 2;
    return;
  }
  await stat(inPath).catch(() => {
    throw new Error(`Cannot read ${inPath}`);
  });

  const passphrase = process.env.BACKUP_PASSPHRASE?.length ? process.env.BACKUP_PASSPHRASE : await promptHidden("Backup passphrase: ");

  try {
    await pipeline(createReadStream(inPath), createBackupDecryptStream(passphrase), createWriteStream(outPath, { mode: 0o600 }));
  } catch (error) {
    // GCM only verifies at the end: whatever was written is unauthenticated, so never leave it behind.
    await rm(outPath, { force: true });
    throw error;
  }
  const { size } = await stat(outPath);
  console.error(`Decrypted and verified: ${outPath} (${size} bytes)`);
}

main().catch((error: unknown) => {
  console.error(`Decrypt failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
