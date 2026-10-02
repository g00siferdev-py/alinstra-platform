FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @alinstra/db generate
# No build step reads secrets. Runtime variables come from the host or Railway.
# tsx is a production dependency. The knowledge job starts a worker_thread with
# `--import tsx` and a small resolver that adds `.ts` to relative imports, so
# extract-knowledge-thread.ts runs inside this image.
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@alinstra/worker", "start"]
