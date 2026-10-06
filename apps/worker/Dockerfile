FROM node:22-bookworm-slim
# pg_dump for the nightly backup job. Debian's own postgresql-client is 15, which cannot dump a newer
# server, so install the matching major from the PostgreSQL apt repo. PG_MAJOR must be >= the server's major
# (local docker-compose and CI run 18 to match Railway; override at build time with --build-arg PG_MAJOR=NN).
# The job also refuses to run if pg_dump is older than the server.
ARG PG_MAJOR=18
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && . /etc/os-release \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}" \
  && apt-get purge -y --auto-remove curl \
  && rm -rf /var/lib/apt/lists/* \
  && pg_dump --version
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
