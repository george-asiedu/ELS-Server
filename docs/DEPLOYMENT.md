# Deploying the API

| Branch    | Environment | Hosting                     |
|-----------|-------------|-----------------------------|
| `develop` | Development | Render                      |
| `main`    | Production  | Contabo VPS (EU), Docker    |

Every push runs **CI** (`.github/workflows/ci.yml`: lint, build). The deploy
workflow for that branch runs only if CI passes.

The API runs its scheduler and email queue in the same process, so
production is one `api` container plus Redis (for the queue) and Caddy (HTTPS).

## 1. Development: Render

1. In the Render service: **Settings → Branch:** `develop`, and turn
   **Auto-Deploy off** (the workflow deploys after CI).
2. **Settings → Deploy Hook:** copy the URL.
3. GitHub environment **development**: secret `RENDER_DEPLOY_HOOK_URL`.
4. Point the dev service at a **separate dev database** (not production's).

## 2. Production: Contabo VPS

### One-time server setup (Ubuntu)

```bash
# As root
adduser deploy && usermod -aG sudo deploy
curl -fsSL https://get.docker.com | sh && usermod -aG docker deploy
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
mkdir -p /opt/zuri && chown deploy:deploy /opt/zuri
```

- Add the deploy user's SSH key: generate a key pair just for GitHub,
  put the public key in `/home/deploy/.ssh/authorized_keys`.
- Create `/opt/zuri/.env` with the production values from `.env.example`
  (production `DATABASE_URL`, Paystack **live** keys, `ROOT_DOMAIN=zuristudios.com`,
  `CLIENT_URL=https://zuristudios.com`, AWS media bucket, Plunk, JWT secrets, and
  so on). Optional: `OPENAI_API_KEY` turns on the image maker in the studio admin
  (`AI_IMAGES_PER_MONTH`, default 20 per studio). `PORT`, `REDIS_URL`, `SCHEDULER_ENABLED` and `TRUST_PROXY_HOPS` are
  set by the compose file. `chmod 600 /opt/zuri/.env`.
- DNS: `api.zuristudios.com` → the VPS IP. Caddy gets the certificate on
  first start.

### GitHub

Environment **production**:

| Secret            | Value                                                        |
|-------------------|--------------------------------------------------------------|
| `VPS_HOST`        | the VPS IP or hostname                                       |
| `VPS_USER`        | `deploy`                                                     |
| `VPS_SSH_KEY`     | the private key matching the server's authorized key        |
| `GHCR_PULL_TOKEN` | a GitHub token with `read:packages` (lets the server pull the image) |

### What a release does

`deploy-prod.yml` builds the Docker image, pushes it to GitHub Container
Registry, copies `deploy/docker-compose.prod.yml` and `deploy/Caddyfile` to
`/opt/zuri`, runs `prisma migrate deploy`, then restarts with the new image.
If the migration fails, the old version keeps running.

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

Each production release saves `/opt/zuri/backups/pre-<sha>.dump` first (latest 14
kept). To undo a bad migration, restore into a new Neon branch to check it, or
fix it forward with a new migration. Neon's point-in-time restore is the
fallback. Check the Postgres image version in `deploy-prod.yml` is not older
than the Neon server's, and that `DATABASE_URL` is Neon's direct (not pooled) URL
for migrations.

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

On the server: `cd /opt/zuri && API_IMAGE=ghcr.io/<owner>/els-server:<previous-sha> docker compose -f docker-compose.prod.yml up -d`.
