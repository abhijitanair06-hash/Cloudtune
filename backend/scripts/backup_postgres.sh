#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run from any directory. The backend/.env file is parsed through python-dotenv
# rather than sourced as shell because CORS_ORIGINS is JSON-formatted.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${BACKEND_DIR}"

BACKUP_DIR="${BACKUP_DIR:-${BACKEND_DIR}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

DB_URL="$(python -c 'from dotenv import dotenv_values; print(dotenv_values(".env").get("DATABASE_URL", ""))')"
if [[ -z "${DB_URL}" ]]; then
  echo "DATABASE_URL is missing from backend/.env" >&2
  exit 1
fi

# SQLAlchemy's asyncpg driver prefix is not understood by pg_dump.
PG_URL="${DB_URL/postgresql+asyncpg:\/\/\/postgresql://}"
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is not installed. Install the PostgreSQL client tools first." >&2
  exit 1
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="${BACKUP_DIR}/cloudtune_${TIMESTAMP}.dump"

pg_dump "${PG_URL}" --format=custom --no-owner --no-acl --file "${OUTPUT}"
chmod 600 "${OUTPUT}"
sha256sum "${OUTPUT}" > "${OUTPUT}.sha256"
chmod 600 "${OUTPUT}.sha256"

find "${BACKUP_DIR}" -maxdepth 1 -type f \
  \( -name 'cloudtune_*.dump' -o -name 'cloudtune_*.dump.sha256' \) \
  -mtime "+${RETENTION_DAYS}" -delete

echo "Backup completed: ${OUTPUT}"
