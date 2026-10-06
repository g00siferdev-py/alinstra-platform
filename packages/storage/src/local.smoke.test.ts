import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@alinstra/config", () => ({
  getEnv: () => ({
    STORAGE_DRIVER: "local",
    UPLOAD_DIR: process.env.UPLOAD_DIR ?? ".",
    S3_BUCKET: "test",
    S3_ENDPOINT: "http://localhost",
    S3_ACCESS_KEY_ID: "x",
    S3_SECRET_ACCESS_KEY: "y",
    S3_REGION: "auto",
  }),
}));

import { getStorage, resetStorageForTests } from "./index";

describe("local storage driver smoke", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "alinstra-storage-"));
    process.env.UPLOAD_DIR = root;
    resetStorageForTests();
  });

  afterEach(async () => {
    resetStorageForTests();
    await rm(root, { recursive: true, force: true });
  });

  it("puts, gets, lists and deletes an object", async () => {
    const storage = getStorage();
    const key = "clients/c1/smoke.txt";
    const body = Buffer.from("phase-s1 storage smoke");
    await storage.put(key, body, "text/plain");
    expect(await storage.get(key)).toEqual(body);
    expect(await storage.byteSize(key)).toBe(body.length);
    const listed = await storage.list("clients/c1/");
    expect(listed.some((item) => item.key === key && item.size === body.length)).toBe(true);
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toThrow();
    expect(await storage.byteSize(key)).toBeNull();
  });
});
