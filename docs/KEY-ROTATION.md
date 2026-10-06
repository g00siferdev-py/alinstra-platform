# Encryption key rotation

Alinstra encrypts call data, messages, transfer numbers, staff notes, extracted document text, and invite tokens with AES-256-GCM through `@alinstra/crypto`. Keys live in environment variables, never in the database. Rotation moves every stored payload from one key to another without downtime.

Rotate once a year, and immediately if a key may have been exposed. Staging and production are separate Railway projects with separate keys. Do each one on its own.

## How keys are named

| Env var | Key id | Meaning |
| --- | --- | --- |
| `ENCRYPTION_KEY` | `k1` | The original key. Always required. |
| `ENCRYPTION_KEY_V2` | `k2` | Second key. Optional until you rotate. |
| `ENCRYPTION_KEY_V3` ... | `k3` ... | Later keys. |
| `ENCRYPTION_ACTIVE_KEY` | | Which key new writes use. Optional. Default `1`. |

Every stored payload names its key (`v2.k2.<iv>.<tag>.<ciphertext>`). Payloads written before key versioning (`v1.…`) are always `k1`. The app reads every configured key forever, so old payloads keep working until you move them.

On start the app refuses to run in production if any key is not 32 bytes of base64, if two keys are identical, or if `ENCRYPTION_ACTIVE_KEY` points at a key that is not set. Error messages name the variable, never the key.

## Steps

Do these in order. Do not skip the two deploys: the second one makes sure that nothing writes under the old key while the script runs.

1. **Generate a key** on your own machine (not in a shared terminal):

   ```bash
   openssl rand -base64 32
   ```

2. **Add `ENCRYPTION_KEY_V2`** to **both** the web service and the worker service in Railway. Both need it: the worker sends invite emails and writes document text, the web app reads everything. Leave `ENCRYPTION_KEY` and everything else as it is.
3. **Deploy** web and worker. Nothing changes yet: new writes still use `k1`, and both services can now read `k2`.
4. **Set `ENCRYPTION_ACTIVE_KEY=2`** on both services and deploy again. From now on every new write uses `k2`.
5. **Run the script** from the Railway console of the web service. Dry run first:

   ```bash
   cd /app/packages/db && pnpm exec tsx scripts/rotate-encryption-key.ts --to k2 --dry-run
   ```

   Then the real run:

   ```bash
   cd /app/packages/db && pnpm exec tsx scripts/rotate-encryption-key.ts --to k2
   ```

   Options: `--batch 500` (rows per batch, 1 to 5000). The script is safe to run while the app is live, safe to stop and start again, and does nothing on a second run.
6. **Confirm zero `k1` payloads remain.** The script prints, for every encrypted column, how many payloads sit under each key before and after:

   ```
   client_message.bodyCipher              k1=1200
   ...
   client_message.bodyCipher              k2=1200
   Done. Every payload is under k2.
   ```

   If any column still shows `k1`, or the script says rows raced a live write, run it again. A line `(v1 format: N)` counts old-format payloads; those are also `k1`. The script exits with an error if a payload cannot be decrypted (for example, its key is no longer configured). It leaves those rows alone.
7. **Keep `ENCRYPTION_KEY` set**, even after everything is on `k2`. Env validation requires it, and backups or old exports may still hold `k1` payloads.
8. **Store the new key offline** (password manager plus a printed or offline copy). If a key is lost, the data under it is gone. There is no recovery.

## The backfill (one time, Phase S)

Phase S added encrypted columns for messages (caller name, callback number, body), transfer numbers, staff notes, and extracted document text. New rows are written encrypted. Older rows still hold plaintext until you run the backfill, once per environment, after the Phase S deploy:

```bash
cd /app/packages/db && pnpm exec tsx scripts/encrypt-backfill.ts --dry-run
cd /app/packages/db && pnpm exec tsx scripts/encrypt-backfill.ts
```

It moves plaintext into the encrypted columns, sets the plaintext to null, and masks phone numbers in the change log and quick-update records. It prints counts per table and column, never values, and ends with "Plaintext still present", which should be 0 for every line. It is idempotent and safe while the app is live. The old plaintext columns stay in the schema (empty) until a later phase drops them.

Run the backfill before the first rotation so that nothing is left in plaintext.

## If something goes wrong

- **"Unknown encryption key id k2; set ENCRYPTION_KEY_V2"**: a service reads a `k2` payload but does not have `ENCRYPTION_KEY_V2`. Add it to that service. Check that the worker has it too.
- **The app refuses to start after a change**: read the message. It names the variable that is wrong (`ENCRYPTION_KEY_V2 must be 32 bytes`, `duplicates`, `ENCRYPTION_ACTIVE_KEY points at k3`). Fix that variable and redeploy.
- **You set `ENCRYPTION_ACTIVE_KEY=2` before adding `ENCRYPTION_KEY_V2`**: the app will not start. Add the key first.
- **Rolling back**: set `ENCRYPTION_ACTIVE_KEY` back to `1` and redeploy. Keep `ENCRYPTION_KEY_V2` set so existing `k2` payloads stay readable. To move data back, run the script with `--to k1`.
- Never remove a key while any payload is still under it. The script's "after" counts tell you.
