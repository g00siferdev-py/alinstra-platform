import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globalSetup: ["../db/src/ensure-test-database.ts"],
  },
});
