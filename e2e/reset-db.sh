#!/bin/sh
# Recreate a disposable test database, migrate and seed it. Usage: e2e/reset-db.sh postgresql://user:pass@host:5432/pmmm_e2e
set -e
URL="$1"; DB="${URL##*/}"; ADMIN="${URL%/*}/postgres"
psql "$ADMIN" -qc "drop database if exists $DB with (force)" -c "create database $DB"
DATABASE_URL="$URL" npx prisma migrate deploy >/dev/null
DATABASE_URL="$URL" npm run -s db:seed >/dev/null
echo "reset $DB"
