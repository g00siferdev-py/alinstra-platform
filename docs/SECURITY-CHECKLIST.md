# Quarterly security checklist

Do this once a quarter (put a recurring reminder in the calendar: first week of January, April, July, October). Copy the list into a note or issue, tick it off, and write down the date and anything you changed. Plan about two hours, plus the restore drill.

Date: ____  Done by: ____

## 1. Rotate vendor keys

Create the new key in the vendor dashboard, update it in Railway for **both** the web and worker services (where the service uses it), redeploy, confirm it works, then revoke the old key. Never put keys in chat, tickets or git.

- [ ] **Retell** (`RETELL_API_KEY`). Also check the webhook signing key follows the same key. Confirm a test call still reaches the webhook and tools.
- [ ] **Stripe** (`STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` if you roll the endpoint secret). Send a test webhook event.
- [ ] **Cloudflare R2** (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). Check a document download and that tonight's backup lands in the bucket.
- [ ] **Resend** (`RESEND_API_KEY`). Send a portal invite or password reset to yourself.
- [ ] **OpenRouter** (the key used for knowledge extraction and text generation). Upload a small test document.
- [ ] Anything else in `.env.example` that holds a secret and is not listed above (Sentry auth token, uptime monitor keys).
- [ ] Old keys are revoked, not just replaced.

`BETTER_AUTH_SECRET` and `BACKUP_PASSPHRASE` are not on the quarterly list: changing the first signs everyone out, and the second makes old backups unreadable unless the old value is kept. Rotate them only on suspicion of exposure, and keep the old passphrase until the last backup it protected has expired (30 days).

## 2. Review who has access

- [ ] Open `/admin/access`. Every admin account is a person who still works here and still needs it. Remove the rest.
- [ ] Look at recent reads of client data (the access log) for anything you cannot explain.
- [ ] For each client, check the portal user list (`/admin/clients/<id>/access`): remove owners and staff who have left.
- [ ] Look at recent sign-ins and lockouts for unfamiliar places or repeated failures.
- [ ] Check the Railway, GitHub, Cloudflare, Stripe, Retell, Resend and Sentry team lists. Remove people who no longer need them. Each must have two-factor on.

## 3. Restore drill

- [ ] Follow `docs/RESTORE.md` end to end on **staging** (never production), using the newest backup from R2.
- [ ] Sign in to the restored copy and open a client, a call and a knowledge document.
- [ ] Note how long it took and anything that was unclear; fix the runbook.
- [ ] The Services page backup card is green (a successful backup in the last day).
- [ ] The backup passphrase can be found in the password manager by someone other than the person who set it up.

## 4. Admin sessions and 2FA backup codes

- [ ] Every admin has two-factor on.
- [ ] Each admin still has unused backup codes. If fewer than three remain, regenerate them and store them in the password manager, not on the device the authenticator lives on.
- [ ] Sign out stale sessions: any admin session you do not recognise, or older than you would expect.
- [ ] Admin session length and idle timeout are still what `docs/DECISIONS.md` says.

## 5. Dependencies and supply chain

- [ ] Review the Dependabot backlog: merge or close every open pull request. Security updates first.
- [ ] CI is green on `main`, including the dependency audit and gitleaks jobs.
- [ ] Review `audit-allowlist.json`. Every entry has a reason that is still true and an expiry date that has not passed. Fix the dependency and delete the entry where you can; renew only with a new reason and a date at most 90 days out.
- [ ] If gitleaks ever reported a finding, confirm the key was rotated (see `docs/KEY-ROTATION.md` for the encryption key) and the `.gitleaks.toml` allowlist still covers only fake values.

## 6. Encryption key (once a year: January review)

- [ ] Rotate `ENCRYPTION_KEY` following `docs/KEY-ROTATION.md`: add the new key, switch the active key, run the backfill, verify. Keep the old key set afterwards.
- [ ] Record the date of the rotation here: ____

## 7. Wrap up

- [ ] Write the date and any changes in `docs/STATUS.md` or a short note.
- [ ] Anything that could not be done this quarter has a named owner and a date.
