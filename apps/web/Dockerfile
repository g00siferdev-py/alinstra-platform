FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @alinstra/db generate
# Build-only values. They are not ENV, so they do not exist in the runtime image.
# Real secrets come from the host or Railway at start. The production guard in
# @alinstra/config refuses placeholder secrets when the process is not building.
RUN NODE_ENV=production \
    NEXT_PHASE=phase-production-build \
    APP_URL=http://localhost:3000 \
    BETTER_AUTH_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=build-time-placeholder-secret-32-chars-min \
    ENCRYPTION_KEY=build-time-placeholder-not-a-real-key \
    ADMIN_EMAIL=build@example.com \
    DATABASE_URL=postgresql://alinstra:alinstra@postgres:5432/alinstra?schema=public \
    REDIS_URL=redis://redis:6379 \
    EMAIL_FROM=notifications@alinstra.com \
    EMAIL_TRANSPORT=resend \
    RESEND_API_KEY=build-placeholder \
    pnpm --filter @alinstra/web build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@alinstra/web", "start"]
