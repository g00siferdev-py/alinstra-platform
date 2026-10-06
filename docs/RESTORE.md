# Restoring a database backup

Backups are encrypted nightly dumps (`pg_dump --format=custom`) in R2, kept 30 days. This is the runbook for turning one back into a working database. Practice it once on staging before you ever need it for real.

You need:

- the **backup passphrase** (`BACKUP_PASSPHRASE`, from your password manager or the Railway worker service variables);
- the R2 credentials (`S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, bucket name; or `BACKUP_S3_BUCKET` if backups use their own bucket);
- a checkout of this repo with `pnpm install` done (for the decrypt command), and PostgreSQL client tools (`pg_restore`, `psql`) at least as new as the server's major version.

Without the passphrase a backup cannot be opened by anyone. There is no recovery path.

## 1. Find and download the backup

Objects live at `backups/<APP_ENV>/YYYY/MM/DD/alinstra-<APP_ENV>-<timestamp>.dump.enc` (UTC; `APP_ENV` is `staging` or `production`).

```bash
export AWS_ACCESS_KEY_ID='<S3_ACCESS_KEY_ID>'
export AWS_SECRET_ACCESS_KEY='<S3_SECRET_ACCESS_KEY>'
export AWS_DEFAULT_REGION=auto
export R2_ENDPOINT='<S3_ENDPOINT>'          # https://<account-id>.r2.cloudflarestorage.com
export R2_BUCKET='<BACKUP_S3_BUCKET or S3_BUCKET>'

# list the newest backups (the last lines are the newest)
aws s3 ls "s3://$R2_BUCKET/backups/production/" --recursive --endpoint-url "$R2_ENDPOINT" | sort | tail -n 10

# download one
aws s3 cp "s3://$R2_BUCKET/backups/production/2026/10/06/alinstra-production-2026-10-06T07-30-00Z.dump.enc" ./backup.dump.enc --endpoint-url "$R2_ENDPOINT"
```

(No AWS CLI? Download the object from Cloudflare dashboard → R2 → the bucket → `backups/...`.)

## 2. Decrypt it

From the repo root, in the folder where you downloaded the file (`pnpm --filter ... exec` runs inside `apps/worker`, so pass absolute paths):

```bash
pnpm --filter @alinstra/worker exec tsx scripts/backup-decrypt.ts "$PWD/backup.dump.enc" "$PWD/backup.dump"
```

It reads the passphrase from the `BACKUP_PASSPHRASE` environment variable, or asks for it (typing is hidden). On Windows PowerShell use `"$PWD\backup.dump.enc"`.

- Success prints `Decrypted and verified: ... (N bytes)`.
- `Backup authentication failed` means the wrong passphrase, a damaged download, or a tampered file. The output file is deleted. Re-download, check the passphrase, or try the previous night's backup. **Never restore a file the CLI did not report as verified.**

Check that it is a real dump (first bytes are `PGDMP`):

```bash
head -c 5 backup.dump; echo
pg_restore --list backup.dump | head
```

## 3. Restore into a fresh Postgres

Do not restore over the live database. Create a new one:

- **Railway:** project → New → Database → PostgreSQL. Open it → Variables → copy `DATABASE_PUBLIC_URL` (the public one; you are connecting from your laptop).
- **Local:** `docker run -d --name restore-pg -e POSTGRES_PASSWORD=restore -p 55432:5432 postgres:16-alpine`, then the URL is `postgresql://postgres:restore@localhost:55432/postgres`.

The new server's major version must be the same as or newer than the one the backup came from.

```bash
export TARGET_URL='postgresql://postgres:<password>@<host>:<port>/<database>'   # no ?schema=public

pg_restore --no-owner --clean --if-exists --dbname="$TARGET_URL" ./backup.dump
```

`--clean --if-exists` drops and recreates objects, so on a brand-new empty database it may print harmless "does not exist, skipping" notices. Any other error is worth reading. To stop at the first problem add `--exit-on-error`.

## 4. Verify the row counts

On the restored database:

```bash
psql "$TARGET_URL" -c "
select table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int as rows
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;"
```

Compare with what you expect: the counts for `client`, `user`, `call_record`, `client_message`, `knowledge_document` against the live app (Admin → Clients, a client's calls and messages), allowing for activity since the backup time. Also check the backup's age: the **Admin → Services → Backups** card shows the time of the last successful backup, and the object name carries the UTC time of this one.

Then check the schema is current:

```bash
psql "$TARGET_URL" -c 'select migration_name, finished_at from _prisma_migrations order by finished_at desc limit 3;'
```

If the web app on the new database is newer than the backup, run migrations against it first:

```bash
DATABASE_URL="$TARGET_URL?schema=public" pnpm db:migrate:deploy
```

Encrypted columns (call transcripts, messages, staff numbers, invite tokens) are copied as ciphertext. They only read correctly with the same `ENCRYPTION_KEY` (and any `ENCRYPTION_KEY_V<N>`) as the app that wrote them. Keep those keys; see `docs/KEY-ROTATION.md`.

## 5. Repoint the app

Only after the counts look right:

1. Railway → **web** service → Variables → set `DATABASE_URL` to the new database's **private** URL, with `?schema=public` on the end (for a Railway database, reference it: `${{Postgres-NEW.DATABASE_URL}}`; if you use the raw value, append `?schema=public`).
2. Do the same on the **worker** service.
3. Redeploy web, then worker. Web's pre-deploy runs `migrate deploy`, which is a no-op when the schema is current.
4. Check `https://<app>/api/health` returns `"db": "up"`, sign in, open a call, and place a test call if Retell is live.
5. Keep the old database for a few days before deleting it.

If the worker is repointed, its next 03:30 backup is of the new database. The `backup.last` setting lives in the database, so it restarts from the restored backup's state; run `pnpm --filter @alinstra/worker exec tsx scripts/backup-now.ts` from the worker shell to take a fresh backup straight away.

## Practising the restore (the drill)

`apps/worker/src/jobs/backup.integration.test.ts` does steps 1 to 4 automatically against scratch databases: dump, encrypt, decrypt, `pg_restore`, compare row counts and a content checksum. It runs in CI and locally wherever `pg_dump`, `pg_restore`, and `psql` are installed:

```bash
pnpm --filter @alinstra/worker exec vitest run src/jobs/backup.integration.test.ts
```

It needs `DATABASE_URL` pointing at a Postgres where it may create and drop `alinstra_drill_*` databases (it uses the `_test` sibling of the configured database). The manual drill above (real R2 object, real passphrase) is still worth doing on staging after the first backups appear.
