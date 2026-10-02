import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { testDatabaseUrl } from "./test-database-url";

for (const path of [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), "../../../.env"),
]) {
  if (existsSync(path)) loadDotenv({ path });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function connectionString(): string {
  const configured = process.env.DATABASE_URL;
  if (!configured) throw new Error("DATABASE_URL is not set");
  if (process.env.NODE_ENV === "test") return testDatabaseUrl(configured, process.env.DATABASE_URL_TEST);
  return configured;
}

export function createPrismaClient(): PrismaClient {
  const connectionStringValue = connectionString();
  const adapter = new PrismaPg({ connectionString: connectionStringValue });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
