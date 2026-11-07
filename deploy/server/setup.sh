#!/usr/bin/env bash
#
# Adds the Zuri Studios API to the Contabo VPS that already runs Nichelle.
#
#   scp -r deploy/server deploy@SERVER_IP:/tmp/zuri-setup
#   ssh -t deploy@SERVER_IP 'sudo bash /tmp/zuri-setup/setup.sh'
#
# The server's base (deploy user, SSH keys only, UFW, fail2ban, automatic
# updates, swap, Node 22, Redis, Nginx, Certbot, the PostgreSQL 17 client) was
# set up by nichelle-api's setup.sh, and nothing here changes it. This adds:
#
#   - the `zuri` user (runs the app; no login, cannot edit its code)
#   - PostgreSQL 17 on loopback, with the `zuri` database and role
#   - /srv/zuri-api (releases) and /etc/zuri/api.env (settings)
#   - zuri-api under systemd, the Nginx site, a nightly backup timer
#
# Safe to run again: each step checks before changing anything. Read
# docs/DEPLOYMENT.md first.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DOMAIN="${API_DOMAIN:-api.zuristudios.com}"
APP_DIR=/srv/zuri-api
ENV_DIR=/etc/zuri

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
id deploy >/dev/null 2>&1 || { echo "No deploy user: set the server up with nichelle-api's setup.sh first."; exit 1; }
command -v node >/dev/null && command -v nginx >/dev/null || { echo "Node or Nginx is missing: run nichelle-api's setup.sh first."; exit 1; }

# ─── 1. The app user ─────────────────────────────────────────────────────────
log "Creating the zuri user"
if ! id zuri >/dev/null 2>&1; then
  adduser --system --group --no-create-home --shell /usr/sbin/nologin zuri
fi
usermod -aG zuri deploy   # deploy reads api.env (for migrations) through the group
install -m 440 "${HERE}/sudoers-zuri" /etc/sudoers.d/zuri-deploy
visudo -cf /etc/sudoers.d/zuri-deploy

# ─── 2. PostgreSQL 17 on loopback ────────────────────────────────────────────
log "Installing PostgreSQL 17"
# The PostgreSQL project's apt repo is already configured (nichelle's setup
# added it for pg_dump 17).
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y postgresql-17
# Sized to share an 8 GB server with Nichelle: listens only on loopback.
cat > /etc/postgresql/17/main/conf.d/zuri.conf <<'CONF'
# Managed by zuri deploy/server/setup.sh
listen_addresses = 'localhost'
shared_buffers = 768MB
effective_cache_size = 2GB
work_mem = 16MB
maintenance_work_mem = 256MB
max_connections = 60
CONF
systemctl enable postgresql
systemctl restart postgresql

install -d -m 750 -o root -g zuri "${ENV_DIR}"
DB_PASSWORD_FILE="${ENV_DIR}/db-password"
if [ ! -s "${DB_PASSWORD_FILE}" ]; then
  openssl rand -hex 24 > "${DB_PASSWORD_FILE}"
  chmod 640 "${DB_PASSWORD_FILE}"
  chgrp zuri "${DB_PASSWORD_FILE}"
fi
DB_PASSWORD="$(cat "${DB_PASSWORD_FILE}")"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zuri') THEN
    CREATE ROLE zuri LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE zuri PASSWORD '${DB_PASSWORD}';
  END IF;
END \$\$;
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='zuri'" | grep -q 1 \
  || sudo -u postgres createdb -O zuri zuri

# ─── 3. Directories and settings ─────────────────────────────────────────────
log "Creating application directories"
install -d -m 755 -o deploy -g deploy "${APP_DIR}" "${APP_DIR}/releases"
if [ ! -f "${ENV_DIR}/api.env" ]; then
  # Shares Nichelle's Redis, in its own database (1), so queues never mix.
  REDIS_PASSWORD="$(cat /etc/nichelle/redis-password)"
  install -m 640 -o root -g zuri "${HERE}/api.env.example" "${ENV_DIR}/api.env"
  sed -i -e "s|__DB_PASSWORD__|${DB_PASSWORD}|" -e "s|__REDIS_PASSWORD__|${REDIS_PASSWORD}|" "${ENV_DIR}/api.env"
  echo "Wrote ${ENV_DIR}/api.env from the template. Fill in the secrets before the first deploy."
fi
install -d -m 750 -o zuri -g zuri /var/backups/zuri

# ─── 4. systemd ──────────────────────────────────────────────────────────────
log "Installing systemd services"
for unit in zuri-api.service zuri-backup.service zuri-backup.timer; do
  install -m 644 "${HERE}/${unit}" "/etc/systemd/system/${unit}"
done
systemctl daemon-reload
systemctl enable zuri-api        # started by the first deploy
systemctl enable --now zuri-backup.timer

# ─── 5. Nginx ────────────────────────────────────────────────────────────────
log "Configuring Nginx"
if [ ! -f /etc/nginx/sites-available/zuri-api.conf ]; then
  sed "s/__API_DOMAIN__/${API_DOMAIN}/g" "${HERE}/nginx/zuri-api.conf" > /etc/nginx/sites-available/zuri-api.conf
fi
ln -sf /etc/nginx/sites-available/zuri-api.conf /etc/nginx/sites-enabled/zuri-api.conf
nginx -t
systemctl reload nginx

log "Done"
cat <<NEXT

Next (docs/DEPLOYMENT.md):
  1. Point ${API_DOMAIN} at this server (A record), then:
       sudo certbot --nginx -d ${API_DOMAIN} --redirect -m YOUR_EMAIL --agree-tos -n
  2. Fill in the secrets:  sudoedit ${ENV_DIR}/api.env
  3. Run the production deploy from GitHub Actions.
NEXT
