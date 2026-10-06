import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const stub = fileURLToPath(new URL("./test-stubs/next-headers.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "next/headers.js": stub,
      "next/headers": stub,
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    globalSetup: ["../db/src/ensure-test-database.ts"],
    server: {
      deps: {
        // So resolve.alias applies to better-auth's dynamic import("next/headers.js").
        inline: ["better-auth"],
      },
    },
  },
});
