import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { getEnv } from "@alinstra/config";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGN_SECONDS = 300;

export type StoredObject = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  byteSize(key: string): Promise<number | null>;
  presignPut(key: string, contentType: string, byteSize: number): Promise<string | null>;
  presignGet(key: string, contentDisposition?: string): Promise<string | null>;
};

export function attachmentDisposition(filename: string): string {
  const cleaned = filename.replace(/[^\w. -]/g, "_").slice(0, 180).trim() || "download";
  return `attachment; filename="${cleaned}"`;
}

function safeKey(key: string): string {
  if (!key.startsWith("clients/") || key.includes("..") || key.includes("\\")) {
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
    async delete(key) {
      await rm(pathFor(key), { force: true });
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

function s3Driver(): StoredObject {
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
  const bucket = env.S3_BUCKET;
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
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
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

export function resetStorageForTests(): void {
  cached = undefined;
}

export { ExtractionFailed, extractDocumentText, withTimeout } from "./extract";
