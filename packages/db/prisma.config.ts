import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

// `prisma generate` does not connect to a database, so it must work without
// DATABASE_URL (Docker image builds, CI build tasks). Migrate commands still
// need it and fail with Prisma's own "no datasource url" error if it is missing.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
