import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/generated/**",
      "**/coverage/**",
      "pnpm-lock.yaml",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.{mjs,js}"],
    languageOptions: {
      sourceType: "module",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/worker/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@alinstra/db",
              importNames: ["prisma", "createPrismaClient"],
              message:
                "Tenant data must go through scoped repositories in @alinstra/db. Direct prisma is only allowed in the health check and worker jobs.",
            },
          ],
        },
      ],
    },
  },
  {
    // Exceptions: /api/health probes the database, and the worker updates invite
    // rows for email jobs. Neither is a tenant-scoped read. See docs/DECISIONS.md.
    files: ["apps/web/src/app/api/health/route.ts", "apps/worker/src/index.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
