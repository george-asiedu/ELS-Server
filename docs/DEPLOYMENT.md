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
  so on). `PORT`, `REDIS_URL`, `SCHEDULER_ENABLED` and `TRUST_PROXY_HOPS` are
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

## 3. Before the first production release: migrations

Development has been using `prisma db push`, which doesn't write migration
files, so `prisma/migrations` may not match `schema.prisma`. Production uses
`prisma migrate deploy` (safe, reviewable). Once, on `develop`:

```bash
# Check whether migrations match the schema
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL"
# If they don't, create one migration that catches up, review it, and commit it
npx prisma migrate dev --name catch_up
```

From then on, change the schema with `prisma migrate dev --name <change>` and
commit the migration with the code.

For a brand-new production database, `migrate deploy` creates everything.
If you copy data from the current database instead, mark the existing
migrations as applied there first (`npx prisma migrate resolve --applied <name>`).

## Rollback

On the server: `cd /opt/zuri && API_IMAGE=ghcr.io/<owner>/els-server:<previous-sha> docker compose -f docker-compose.prod.yml up -d`.
