FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @alinstra/db generate
# No build step reads secrets. Runtime variables come from the host or Railway.
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@alinstra/worker", "start"]
