#!/usr/bin/env bash
#
# Nightly database backup (zuri-backup.timer). Keeps 14 days in
# /var/backups/zuri and, when BACKUP_BUCKET is set, copies each to S3 so losing
# the server never means losing the data.
#
# Restore (into a scratch database first, to check it):
#   pg_restore --dbname="<URL>" --clean --if-exists --no-owner zuri-<stamp>.dump
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"

DIR=/var/backups/zuri
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
FILE="${DIR}/zuri-${STAMP}.dump"

pg_dump "${DATABASE_URL}" --format=custom --no-owner --no-privileges --file="${FILE}"
echo "Backup written: ${FILE} ($(du -h "${FILE}" | cut -f1))"

if [ -n "${BACKUP_BUCKET:-}" ]; then
  aws s3 cp "${FILE}" "s3://${BACKUP_BUCKET}/postgres/zuri-${STAMP}.dump" \
    --sse AES256 --storage-class STANDARD_IA --only-show-errors
  echo "Copied to s3://${BACKUP_BUCKET}/postgres/zuri-${STAMP}.dump"
fi

find "${DIR}" -name 'zuri-*.dump' -mtime +14 -delete
