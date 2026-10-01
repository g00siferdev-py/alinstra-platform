FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @alinstra/db generate
ENV NODE_ENV=production
ENV APP_URL=http://localhost:3000
ENV BETTER_AUTH_URL=http://localhost:3000
ENV BETTER_AUTH_SECRET=build-time-placeholder-secret-32-chars-min
ENV ENCRYPTION_KEY=build-time-placeholder-not-a-real-key
ENV ADMIN_EMAIL=build@example.com
ENV DATABASE_URL=postgresql://alinstra:alinstra@postgres:5432/alinstra?schema=public
ENV REDIS_URL=redis://redis:6379
ENV EMAIL_FROM=notifications@alinstra.com
ENV EMAIL_TRANSPORT=resend
ENV RESEND_API_KEY=build-placeholder
CMD ["pnpm", "--filter", "@alinstra/worker", "start"]
