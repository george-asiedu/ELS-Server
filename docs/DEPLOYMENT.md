# Deploying the API

| Branch    | Environment | Hosting                     |
|-----------|-------------|-----------------------------|
| `develop` | Development | Render                      |
| `main`    | Production  | Contabo VPS (EU), systemd   |

Every push runs **CI** (`.github/workflows/ci.yml`: lint, build). The deploy
workflow for that branch runs only if CI passes.

The API runs its scheduler and email queue in the same process, so
production is one `zuri-api` service behind Nginx, with Postgres and Redis on
the same server.

## 1. Development: Render

1. In the Render service: **Settings → Branch:** `develop`, and turn
   **Auto-Deploy off** (the workflow deploys after CI).
2. **Settings → Deploy Hook:** copy the URL.
3. GitHub environment **development**: secret `RENDER_DEPLOY_HOOK_URL`.
4. Point the dev service at a **separate dev database** (not production's).

## 2. Production: Contabo VPS

The API runs on the same Contabo VPS as Nichelle (Ubuntu 24.04, 8 GB,
Germany), following the same design: no Docker, a systemd service behind
Nginx, releases built in GitHub Actions. Nichelle's setup already hardened the
server (SSH keys only, no root login, UFW 22/80/443, fail2ban, automatic
updates, swap) and installed Node 22, Redis, Nginx and Certbot. Zuri adds only:

| | |
|---|---|
| App user | `zuri` (runs the app; no login; can't change its code) |
| Service | `zuri-api` on `127.0.0.1:5060`, with its scheduler and email queue |
| Nginx site | `api.zuristudios.com` → `127.0.0.1:5060`, HTTPS by Certbot |
| Database | PostgreSQL 17 on loopback, database and role `zuri` |
| Redis | Nichelle's Redis, database `1`, so queues and keys never mix |
| Releases | `/srv/zuri-api/releases/*`, `current` symlink, 5 kept |
| Settings | `/etc/zuri/api.env` (root:zuri, 640), never inside a release |
| Backups | nightly at 02:30 UTC to `/var/backups/zuri` (14 days) and S3 |

Port 5060 and Postgres are never opened in UFW; Nginx is the only way in.

### One-time setup

1. **DNS:** `api.zuristudios.com` → an **A** record to the VPS IPv4.
2. **Copy the setup files and run them** (Local, from `ELS-Server`):
   ```bash
   scp -r deploy/server deploy@SERVER_IP:/tmp/zuri-setup
   ssh -t deploy@SERVER_IP 'sudo bash /tmp/zuri-setup/setup.sh'
   ```
   It creates the database with a random password and fills `DATABASE_URL`
   and `REDIS_URL` into `/etc/zuri/api.env`.
3. **HTTPS** (Server):
   `sudo certbot --nginx -d api.zuristudios.com --redirect -m YOU@EMAIL --agree-tos -n`
4. **Settings** (Server): `sudoedit /etc/zuri/api.env`. Fill every empty value
   (Paystack **live** keys, JWT secret from `openssl rand -hex 48`, AWS media
   bucket, Plunk). Check: `sudo grep -nE '^[A-Z_]+=$' /etc/zuri/api.env`;
   only optional ones (`OPENAI_API_KEY`, `BACKUP_BUCKET`) may stay empty.
5. **Backups off the server:** create a **private** S3 bucket (not the media
   one, which CloudFront serves publicly), set `BACKUP_BUCKET`, and give the
   AWS keys in `api.env` `s3:PutObject` on it. Add a lifecycle rule to delete
   copies after 30 days. Test: `sudo systemctl start zuri-backup` then
   `journalctl -u zuri-backup`.

### GitHub

A CI-only key, so it can be revoked alone (Local):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/zuri-ci -N "" -C "github-actions@zuri-api"
ssh-copy-id -i ~/.ssh/zuri-ci.pub deploy@SERVER_IP
ssh-keyscan -t ed25519 SERVER_IP     # the host key line, for pinning
```

`ELS-Server` → Settings → Environments → `production` (deployment branch:
`main`):

| Kind | Name | Value |
|---|---|---|
| Variable | `API_URL` | `https://api.zuristudios.com` |
| Variable | `SSH_HOST` | the VPS IP |
| Variable | `SSH_USER` | `deploy` |
| Variable | `SSH_KNOWN_HOSTS` | the line `ssh-keyscan` printed |
| Secret | `SSH_PRIVATE_KEY` | the contents of `~/.ssh/zuri-ci` (not `.pub`) |

Then delete `~/.ssh/zuri-ci` locally. The old Docker secrets (`VPS_*`,
`GHCR_PULL_TOKEN`) are no longer used.

### What a release does

`deploy-prod.yml` runs after CI passes on `main`: builds and packages the
release, uploads it, then `deploy/server/deploy.sh` installs dependencies,
backs up the database (`~deploy/zuri-predeploy`, 14 kept), runs
`prisma migrate deploy`, switches `current`, restarts and waits for
`/health`. If the new release doesn't come up, it switches back by itself.

### Running it (Server, as deploy)

| To… | Run |
|---|---|
| see if it's running | `systemctl status zuri-api` |
| follow logs | `journalctl -u zuri-api -f` |
| restart after editing `api.env` | `sudo systemctl restart zuri-api` |
| list / roll back releases | `bash /srv/zuri-api/current/deploy/server/rollback.sh --list` (no flag: one back) |
| Nginx errors | `sudo tail -f /var/log/nginx/zuri-api.error.log` |
| database shell | `sudo -u postgres psql zuri` |

**Shared server:** Zuri and Nichelle share 8 GB. `zuri-api` is capped at
1.5 GB and Postgres is sized for the rest; watch `free -h`. If Nichelle's Redis
password is ever changed, update `REDIS_URL` in `/etc/zuri/api.env` too.

## 3. Database migrations

Schema changes are tracked as Prisma migrations in `prisma/migrations`
(checked: they match `schema.prisma` exactly). `prisma db push` is no longer
used.

- **Changing the schema:** edit `schema.prisma`, then `yarn migrate --name <change>`
  (runs `prisma migrate dev`: writes the migration and applies it to your dev
  database). Commit the migration folder with the code.
- **Releases:** the production workflow runs `prisma migrate deploy`.
- **Check:** `yarn migrate:status`.

**One-time, for databases created with `db push`** (the current dev/test
database): they have the tables but no record of the migrations. Mark the
existing ones as applied (this changes no data), then apply the new ones:

```bash
for m in 00000000000000_baseline 20260926175508_add_payment_attempts_and_ledger \
  20260926202605_add_refunds_and_reschedule 20260926213011_add_pending_reschedule_and_notice \
  20261007120000_add_scheduled_jobs 20261007130000_studio_landing_content \
  20261008090000_subscription_setup_fee 20261008120000_plan_prices_site_settings_billing_charges; do
  npx prisma migrate resolve --applied "$m"
done
yarn migrate:deploy   # applies 20261028120000_storefront_plan and everything newer
```

A brand-new database (like production's) needs only `yarn migrate:deploy`.

### Safe schema changes

Prisma has no "down" migrations, and each release runs the new schema before the
new code starts. So every migration must still work with the code before it:

- **Add first:** new tables and nullable (or defaulted) columns are always safe.
- **Remove later:** stop using a column in one release; drop it in a later one.
- **Rename or change a type in steps:** add the new column, copy, switch the
  code, then drop the old one.

### Backups and restore

- **Nightly:** `zuri-backup.timer` → `/var/backups/zuri` (14 days) and
  `BACKUP_BUCKET`. Check with `journalctl -u zuri-backup`.
- **Before each release:** `~deploy/zuri-predeploy/pre-<sha>.dump`.
- **Contabo auto backup** of the whole server is a further fallback.

To restore (this replaces the current data):

```bash
sudo systemctl stop zuri-api
sudo -u postgres pg_restore -d zuri --clean --if-exists --no-owner --role=zuri /path/to/file.dump
sudo systemctl start zuri-api
```

Try a restore once after going live, into a scratch database
(`sudo -u postgres createdb -O zuri zuri_check`) so you know it works.

## Sessions and cookies

Signed-in sessions are `HttpOnly` cookies on the API's host, one per studio.

- **Production:** site and API must be on the same site (`*.zuristudios.com`).
  Leave `COOKIE_SAMESITE=lax`.
- **Development on Vercel + Render:** these are different sites, so set
  `COOKIE_SAMESITE=none` on Render. Browsers that block third-party cookies may
  still refuse it; a shared parent domain avoids that.
- **Custom domains:** a studio's own domain must forward `/api/*` to the API (in
  CloudFront, a behavior with the API as its origin, no caching, all cookies and
  headers forwarded). The app calls `/api` on the same domain there, so the
  cookie belongs to that domain. Without this, sign-in fails on custom domains.

## Rollback

`bash /srv/zuri-api/current/deploy/server/rollback.sh` on the server puts the
previous release back (code only; the database stays, so keep migrations
additive).
