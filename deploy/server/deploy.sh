#!/usr/bin/env bash
#
# Activates one release of the API. GitHub Actions uploads the build and this
# script, then runs as deploy:
#
#   bash ~/incoming-zuri/deploy.sh <sha> ~/incoming-zuri/release-<sha>.tgz
#
#   1. unpack into /srv/zuri-api/releases/<time>-<sha>
#   2. install dependencies (the lockfile, exactly)
#   3. back up the database, then run migrations
#   4. point `current` at the new release (one atomic rename)
#   5. restart and wait for /health; if it fails, switch back
#
# A rollback changes code, not the database, so keep migrations additive.

set -euo pipefail

SHA="${1:?usage: deploy.sh <sha> <tarball>}"
TARBALL="${2:?usage: deploy.sh <sha> <tarball>}"
APP_DIR=/srv/zuri-api
ENV_FILE=/etc/zuri/api.env
KEEP=5
HEALTH_URL=http://127.0.0.1:5060/health

log() { printf '\n==> %s\n' "$*"; }

[ -r "${ENV_FILE}" ] || { echo "Cannot read ${ENV_FILE}: is deploy in the zuri group?"; exit 1; }
grep -qE '^JWT_SECRET=.+' "${ENV_FILE}" || { echo "${ENV_FILE} still has empty secrets. Fill it in first."; exit 1; }

RELEASE="${APP_DIR}/releases/$(date -u +%Y%m%d%H%M%S)-${SHA:0:7}"
PREVIOUS="$(readlink -f "${APP_DIR}/current" 2>/dev/null || true)"

log "Unpacking ${SHA:0:7}"
umask 022
mkdir -p "${RELEASE}"
tar -xzf "${TARBALL}" -C "${RELEASE}"

log "Installing dependencies"
cd "${RELEASE}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Dev dependencies too: the Prisma CLI runs the migrations. The generated
# Prisma client (with its engine) comes with the release from CI.
corepack yarn install --frozen-lockfile --production=false --non-interactive

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a
export NODE_ENV=production

log "Backing up the database"
mkdir -p "${HOME}/zuri-predeploy"
pg_dump "${DATABASE_URL}" --format=custom --no-owner --file="${HOME}/zuri-predeploy/pre-${SHA:0:7}.dump"
ls -1t "${HOME}"/zuri-predeploy/pre-*.dump | tail -n +15 | xargs -r rm --

log "Migrating the database"
node_modules/.bin/prisma migrate deploy

log "Switching to the new release"
ln -sfn "${RELEASE}" "${APP_DIR}/current.next"
mv -Tf "${APP_DIR}/current.next" "${APP_DIR}/current"

healthy() {
  for _ in $(seq 1 30); do
    curl -fsS "${HEALTH_URL}" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

sudo /usr/bin/systemctl restart zuri-api
if healthy; then
  log "Live: $(curl -fsS "${HEALTH_URL}")"
else
  echo "::error::The new release did not become healthy."
  journalctl -u zuri-api -n 40 --no-pager || true
  if [ -n "${PREVIOUS}" ] && [ -d "${PREVIOUS}" ]; then
    log "Rolling back to ${PREVIOUS}"
    ln -sfn "${PREVIOUS}" "${APP_DIR}/current.next"
    mv -Tf "${APP_DIR}/current.next" "${APP_DIR}/current"
    sudo /usr/bin/systemctl restart zuri-api
    healthy && echo "Rolled back; the previous release is serving." || echo "::error::Rollback is unhealthy too: journalctl -u zuri-api"
  fi
  exit 1
fi

log "Pruning old releases (keeping ${KEEP})"
ls -1dt "${APP_DIR}"/releases/*/ | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$(readlink -f "${old}")" = "$(readlink -f "${APP_DIR}/current")" ] || rm -rf -- "${old}"
done
rm -f -- "${TARBALL}"
