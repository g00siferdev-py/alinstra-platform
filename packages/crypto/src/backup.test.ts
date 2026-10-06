import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { BACKUP_HEADER_BYTES, BACKUP_MAGIC, BACKUP_TAG_BYTES, createBackupDecryptStream, createBackupEncryptStream } from "./backup";

const PASSPHRASE = "correct horse battery staple 42";

async function collect(chunks: Buffer[], transform: NodeJS.ReadWriteStream): Promise<Buffer> {
  const out: Buffer[] = [];
  await pipeline(Readable.from(chunks), transform, async function (source) {
    for await (const piece of source) out.push(piece as Buffer);
  });
  return Buffer.concat(out);
}

async function encrypt(plain: Buffer, passphrase = PASSPHRASE, chunkSize = 64 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for (let i = 0; i < plain.length; i += chunkSize) chunks.push(plain.subarray(i, i + chunkSize));
  return collect(chunks, await createBackupEncryptStream(passphrase));
}

function decrypt(file: Buffer, passphrase = PASSPHRASE, chunkSize = 7000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for (let i = 0; i < file.length; i += chunkSize) chunks.push(file.subarray(i, i + chunkSize));
  return collect(chunks, createBackupDecryptStream(passphrase));
}

describe("backup file encryption", () => {
  it("round-trips a multi-chunk payload", async () => {
    const plain = randomBytes(300_000);
    const file = await encrypt(plain);
    expect(file.subarray(0, BACKUP_MAGIC.length).toString()).toBe("ALBK1");
    expect(file.length).toBe(BACKUP_HEADER_BYTES + plain.length + BACKUP_TAG_BYTES);
    expect(file.includes(plain.subarray(0, 64))).toBe(false);
    expect((await decrypt(file)).equals(plain)).toBe(true);
  });

  it("round-trips tiny chunk boundaries and an empty payload", async () => {
    const plain = randomBytes(1000);
    const file = await encrypt(plain, PASSPHRASE, 3);
    expect((await decrypt(file, PASSPHRASE, 1)).equals(plain)).toBe(true);
    const empty = await encrypt(Buffer.alloc(0));
    expect(empty.length).toBe(BACKUP_HEADER_BYTES + BACKUP_TAG_BYTES);
    expect((await decrypt(empty)).length).toBe(0);
  });

  it("uses a fresh salt and iv per file", async () => {
    const plain = Buffer.from("same input");
    const a = await encrypt(plain);
    const b = await encrypt(plain);
    expect(a.subarray(BACKUP_MAGIC.length, BACKUP_HEADER_BYTES).equals(b.subarray(BACKUP_MAGIC.length, BACKUP_HEADER_BYTES))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it("fails on a wrong passphrase without echoing it", async () => {
    const file = await encrypt(randomBytes(5000));
    const wrong = "a completely different passphrase";
    const error = await decrypt(file, wrong).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/authentication failed/);
    expect((error as Error).message).not.toContain(wrong);
  });

  it("fails when any single byte is flipped: header, body, or tag", async () => {
    const file = await encrypt(randomBytes(4000));
    const positions = [0, BACKUP_MAGIC.length + 3, BACKUP_HEADER_BYTES - 1, BACKUP_HEADER_BYTES + 10, file.length - BACKUP_TAG_BYTES - 1, file.length - 1];
    for (const position of positions) {
      const tampered = Buffer.from(file);
      tampered[position] = (tampered[position] ?? 0) ^ 0x01;
      await expect(decrypt(tampered)).rejects.toThrow();
    }
  });

  it("fails on a truncated file or trailing extra bytes", async () => {
    const file = await encrypt(randomBytes(4000));
    await expect(decrypt(file.subarray(0, file.length - 1))).rejects.toThrow();
    await expect(decrypt(file.subarray(0, BACKUP_HEADER_BYTES + 4))).rejects.toThrow(/truncated/);
    await expect(decrypt(file.subarray(0, 8))).rejects.toThrow(/truncated/);
    await expect(decrypt(Buffer.concat([file, Buffer.from([0])]))).rejects.toThrow();
  });

  it("rejects a file that is not a backup", async () => {
    await expect(decrypt(Buffer.from("-- PostgreSQL database dump, not encrypted at all"))).rejects.toThrow(/Not an Alinstra backup/);
  });

  it("refuses a short passphrase", async () => {
    await expect(createBackupEncryptStream("short")).rejects.toThrow(/at least 16/);
    expect(() => createBackupDecryptStream("short")).toThrow(/at least 16/);
  });
});
