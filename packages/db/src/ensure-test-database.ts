import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Client } from "pg";
import { databaseNameFromUrl, testDatabaseUrl } from "./test-database-url";

function loadEnv(): void {
  for (const path of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
    if (existsSync(path)) loadDotenv({ path });
  }
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe database name "${name}".`);
  }
  return `"${name}"`;
}

export async function ensureTestDatabase(): Promise<void> {
  loadEnv();
  const configured = process.env.DATABASE_URL;
  if (!configured) throw new Error("DATABASE_URL is not set");
  const testUrl = testDatabaseUrl(configured, process.env.DATABASE_URL_TEST);
  const name = databaseNameFromUrl(testUrl);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to prepare database "${name}". Test databases must end in _test.`);
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdent(name)}`);
    }
  } finally {
    await client.end();
  }

  const packageRoot = resolve(import.meta.dirname, "..");
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "inherit",
  });
}

export default async function globalSetup(): Promise<void> {
  await ensureTestDatabase();
}
