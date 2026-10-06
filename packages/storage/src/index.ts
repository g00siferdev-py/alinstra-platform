import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { getEnv } from "@alinstra/config";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGN_SECONDS = 300;

export type ListedObject = { key: string; size: number; lastModified: Date };

export type StoredObject = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Inclusive byte range, like HTTP `Range: bytes=start-end`. */
  getRange(key: string, start: number, end: number): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Uploads a local file as one object without loading it into memory. `bytes` must be the file size. */
  putFile(key: string, path: string, bytes: number, contentType: string): Promise<void>;
  /** Every object under a key prefix (all pages), in no guaranteed order. */
  list(prefix: string): Promise<ListedObject[]>;
  byteSize(key: string): Promise<number | null>;
  presignPut(key: string, contentType: string, byteSize: number): Promise<string | null>;
  presignGet(key: string, contentDisposition?: string): Promise<string | null>;
};

export function attachmentDisposition(filename: string): string {
  const cleaned = filename.replace(/[^\w. -]/g, "_").slice(0, 180).trim() || "download";
  return `attachment; filename="${cleaned}"`;
}

function safeKey(key: string): string {
  if (!(key.startsWith("clients/") || key.startsWith("backups/")) || key.includes("..") || key.includes("\\")) {
    throw new Error("Invalid storage key");
  }
  return key;
}

function workspaceRoot(start: string): string {
  let dir = resolve(start);
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

function uploadRoot(configured: string): string {
  return isAbsolute(configured) ? configured : resolve(workspaceRoot(process.cwd()), configured);
}

function localDriver(root: string): StoredObject {
  const pathFor = (key: string) => resolve(root, safeKey(key));
  return {
    async put(key, body) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async get(key) {
      return readFile(pathFor(key));
    },
    async getRange(key, start, end) {
      const whole = await readFile(pathFor(key));
      return whole.subarray(start, end + 1);
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
    async putFile(key, path) {
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(path, target);
    },
    async list(prefix) {
      const base = pathFor(prefix);
      const out: ListedObject[] = [];
      const walk = async (dir: string): Promise<void> => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = resolve(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else {
            const info = await stat(full);
            const key = full.slice(root.length + 1).split("\\").join("/");
            if (key.startsWith(prefix)) out.push({ key, size: info.size, lastModified: info.mtime });
          }
        }
      };
      await walk(prefix.endsWith("/") ? base : dirname(base));
      return out;
    },
    async byteSize(key) {
      try {
        return (await stat(pathFor(key))).size;
      } catch {
        return null;
      }
    },
    async presignPut() {
      return null;
    },
    async presignGet(_key, _contentDisposition) {
      return null;
    },
  };
}

function s3Driver(bucketOverride?: string): StoredObject {
  const env = getEnv();
  const client = new S3Client({
    region: env.S3_REGION || "auto",
    endpoint: env.S3_ENDPOINT,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  const bucket = bucketOverride || env.S3_BUCKET;
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: safeKey(key), Body: body, ContentType: contentType }),
      );
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) throw new Error("Empty object");
      return Buffer.from(bytes);
    },
    async getRange(key, start, end) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: safeKey(key), Range: `bytes=${start}-${end}` }));
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) throw new Error("Empty object");
      return Buffer.from(bytes);
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
    },
    async putFile(key, path, bytes, contentType) {
      const body = createReadStream(path);
      try {
        await client.send(
          new PutObjectCommand({ Bucket: bucket, Key: safeKey(key), Body: body, ContentLength: bytes, ContentType: contentType }),
        );
      } finally {
        body.destroy();
      }
    },
    async list(prefix) {
      safeKey(prefix);
      const out: ListedObject[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const item of page.Contents ?? []) {
          if (item.Key && item.LastModified) out.push({ key: item.Key, size: item.Size ?? 0, lastModified: item.LastModified });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async byteSize(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
        return result.ContentLength ?? null;
      } catch {
        return null;
      }
    },
    async presignPut(key, contentType, byteSize) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: safeKey(key),
          ContentType: contentType,
          ContentLength: byteSize,
        }),
        { expiresIn: PRESIGN_SECONDS },
      );
    },
    async presignGet(key, contentDisposition) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: safeKey(key),
          ResponseContentDisposition: contentDisposition,
        }),
        { expiresIn: PRESIGN_SECONDS },
      );
    },
  };
}

let cached: StoredObject | undefined;

export function getStorage(): StoredObject {
  if (cached) return cached;
  const env = getEnv();
  cached = env.STORAGE_DRIVER === "s3" ? s3Driver() : localDriver(uploadRoot(env.UPLOAD_DIR));
  return cached;
}

let cachedBackup: StoredObject | undefined;

/**
 * Storage for encrypted database backups (keys under `backups/`). Uses `BACKUP_S3_BUCKET` when set,
 * otherwise the main bucket. Same credentials either way, so a separate bucket must be reachable by
 * the S3_ACCESS_KEY_ID in use.
 */
export function getBackupStorage(): StoredObject {
  if (cachedBackup) return cachedBackup;
  const env = getEnv();
  cachedBackup = env.STORAGE_DRIVER === "s3" ? s3Driver(env.BACKUP_S3_BUCKET) : getStorage();
  return cachedBackup;
}

export function resetStorageForTests(): void {
  cached = undefined;
  cachedBackup = undefined;
}

export { ExtractionFailed, extractDocumentText, withTimeout } from "./extract";
