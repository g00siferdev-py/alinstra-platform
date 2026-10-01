import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

loadDotenv({ path: resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: [
    "@alinstra/auth",
    "@alinstra/config",
    "@alinstra/crypto",
    "@alinstra/db",
    "@alinstra/email",
    "@alinstra/queue",
  ],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "bullmq", "ioredis"],
};

export default nextConfig;
