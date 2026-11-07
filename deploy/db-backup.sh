#!/bin/sh
# Nightly database backup (runs in the "backup" container). Keeps 14 days on
# the server and, when BACKUP_S3_BUCKET is set, copies each one to that bucket
# so a lost server doesn't mean lost data. Use a PRIVATE bucket: never the media
# bucket, which is served to the public through CloudFront.
set -eu
if [ -n "${BACKUP_S3_BUCKET:-}" ] && ! command -v aws >/dev/null; then
  apk add --no-cache aws-cli >/dev/null
fi
while true; do
  stamp=$(date -u +%Y%m%d-%H%M)
  file="/backups/nightly-$stamp.dump"
  if pg_dump -h db -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" -f "$file"; then
    echo "Backup written: $file"
    if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
      aws s3 cp "$file" "s3://$BACKUP_S3_BUCKET/zuri-db/$(basename "$file")" --only-show-errors \
        && echo "Backup copied to S3" || echo "S3 copy FAILED"
    fi
  else
    echo "Backup FAILED"
    rm -f "$file"
  fi
  find /backups -name 'nightly-*.dump' -mtime +14 -delete
  sleep 86400
done
