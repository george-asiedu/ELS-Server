#!/usr/bin/env bash
#
# Puts the previous release back, by hand. On the server, as deploy:
#   bash /srv/zuri-api/current/deploy/server/rollback.sh          one back
#   bash .../rollback.sh 20261101093000-ab12cd3                     a specific one
#   bash .../rollback.sh --list                                     list releases
# Does not touch the database (see deploy.sh).
set -euo pipefail
APP_DIR=/srv/zuri-api
CURRENT="$(readlink -f "${APP_DIR}/current")"
mapfile -t RELEASES < <(ls -1dt "${APP_DIR}"/releases/*/ | sed 's:/$::')

if [ "${1:-}" = "--list" ]; then
  for r in "${RELEASES[@]}"; do
    [ "${r}" = "${CURRENT}" ] && echo "* $(basename "${r}")  (current)" || echo "  $(basename "${r}")"
  done
  exit 0
fi

TARGET=""
if [ -n "${1:-}" ]; then
  TARGET="${APP_DIR}/releases/$1"
else
  for i in "${!RELEASES[@]}"; do
    if [ "${RELEASES[$i]}" = "${CURRENT}" ] && [ -n "${RELEASES[$((i + 1))]:-}" ]; then
      TARGET="${RELEASES[$((i + 1))]}"
    fi
  done
fi
[ -n "${TARGET}" ] && [ -d "${TARGET}" ] || { echo "No release to roll back to. Try --list."; exit 1; }

echo "Rolling back: $(basename "${CURRENT}") -> $(basename "${TARGET}")"
ln -sfn "${TARGET}" "${APP_DIR}/current.next"
mv -Tf "${APP_DIR}/current.next" "${APP_DIR}/current"
sudo /usr/bin/systemctl restart zuri-api
sleep 3
curl -fsS http://127.0.0.1:5060/health && echo && echo "Done."
