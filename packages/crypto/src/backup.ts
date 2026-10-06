import { createCipheriv, createDecipheriv, randomBytes, scrypt, type DecipherGCM } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

/**
 * Streaming file encryption for database backups (`.dump.enc`).
 *
 * Layout: `ALBK1` (5 bytes magic) | salt (16) | iv (12) | AES-256-GCM ciphertext | tag (16).
 * The key is scrypt(passphrase, salt, N=2^15, r=8, p=1) with a fresh random salt per file.
 * The header (magic + salt + iv) is bound into the GCM tag as additional authenticated data, so any
 * flipped byte, in the header, the body, or the tag, makes decryption fail.
 *
 * GCM can only verify at the end of the stream. A decrypt stream therefore emits plaintext before it
 * knows the file is authentic; callers MUST treat the output as untrusted until the stream finishes
 * without error, and delete it if it errors. Nothing here ever includes the passphrase or key in errors.
 */

export const BACKUP_MAGIC = Buffer.from("ALBK1", "utf8");
export const BACKUP_SALT_BYTES = 16;
export const BACKUP_IV_BYTES = 12;
export const BACKUP_TAG_BYTES = 16;
export const BACKUP_HEADER_BYTES = BACKUP_MAGIC.length + BACKUP_SALT_BYTES + BACKUP_IV_BYTES;
export const BACKUP_MIN_PASSPHRASE_LENGTH = 16;

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
// scrypt needs 128 * N * r bytes (32 MiB); Node's default maxmem is exactly that, so give headroom.
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < BACKUP_MIN_PASSPHRASE_LENGTH) {
    throw new Error(`BACKUP_PASSPHRASE must be at least ${BACKUP_MIN_PASSPHRASE_LENGTH} characters`);
  }
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Derives the key (async, ~100 ms) and returns a Transform: plaintext in, `ALBK1` file bytes out. */
export async function createBackupEncryptStream(passphrase: string): Promise<Transform> {
  assertPassphrase(passphrase);
  const salt = randomBytes(BACKUP_SALT_BYTES);
  const iv = randomBytes(BACKUP_IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  const header = Buffer.concat([BACKUP_MAGIC, salt, iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  let headerSent = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      if (!headerSent) {
        headerSent = true;
        this.push(header);
      }
      const out = cipher.update(chunk);
      if (out.length > 0) this.push(out);
      callback();
    },
    flush(callback: TransformCallback) {
      if (!headerSent) {
        headerSent = true;
        this.push(header);
      }
      const last = cipher.final();
      if (last.length > 0) this.push(last);
      this.push(cipher.getAuthTag());
      callback();
    },
  });
}

/**
 * A Transform: `ALBK1` file bytes in, plaintext out. Errors (wrong passphrase, tampering, truncation,
 * not a backup file) surface as a stream error from the final flush; see the module note about trust.
 */
export function createBackupDecryptStream(passphrase: string): Transform {
  assertPassphrase(passphrase);
  let header = Buffer.alloc(0);
  let decipher: DecipherGCM | undefined;
  // The last 16 bytes of the file are the tag, so always hold back that much ciphertext.
  let tail = Buffer.alloc(0);

  const fail = (callback: TransformCallback, message: string) => callback(new Error(message));

  const feed = (stream: Transform, chunk: Buffer): void => {
    if (!decipher) return;
    const combined = Buffer.concat([tail, chunk]);
    if (combined.length <= BACKUP_TAG_BYTES) {
      tail = combined;
      return;
    }
    const body = combined.subarray(0, combined.length - BACKUP_TAG_BYTES);
    tail = Buffer.from(combined.subarray(combined.length - BACKUP_TAG_BYTES));
    const out = decipher.update(body);
    if (out.length > 0) stream.push(out);
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      if (decipher) {
        feed(this, chunk);
        callback();
        return;
      }
      header = Buffer.concat([header, chunk]);
      if (header.length < BACKUP_HEADER_BYTES) {
        // Reject early if what we have so far can't be a backup (wrong file handed to the CLI).
        const seen = header.subarray(0, Math.min(header.length, BACKUP_MAGIC.length));
        if (!BACKUP_MAGIC.subarray(0, seen.length).equals(seen)) {
          fail(callback, "Not an Alinstra backup file (bad header)");
          return;
        }
        callback();
        return;
      }
      if (!header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
        fail(callback, "Not an Alinstra backup file (bad header)");
        return;
      }
      const fixedHeader = Buffer.from(header.subarray(0, BACKUP_HEADER_BYTES));
      const rest = header.subarray(BACKUP_HEADER_BYTES);
      const salt = fixedHeader.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + BACKUP_SALT_BYTES);
      const iv = fixedHeader.subarray(BACKUP_MAGIC.length + BACKUP_SALT_BYTES);
      deriveKey(passphrase, Buffer.from(salt)).then(
        (key) => {
          decipher = createDecipheriv("aes-256-gcm", key, iv);
          decipher.setAAD(fixedHeader);
          feed(this, Buffer.from(rest));
          callback();
        },
        () => fail(callback, "Could not derive the backup key"),
      );
    },
    flush(callback: TransformCallback) {
      if (!decipher || tail.length < BACKUP_TAG_BYTES) {
        fail(callback, "Backup file is truncated");
        return;
      }
      try {
        decipher.setAuthTag(tail);
        const last = decipher.final();
        if (last.length > 0) this.push(last);
        callback();
      } catch {
        fail(callback, "Backup authentication failed: wrong passphrase, or the file is corrupted or tampered with");
      }
    },
  });
}
