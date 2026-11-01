#!/usr/bin/env bash
# Datenbank-Tests: setup.sql + Migrationen gegen ein frisches Postgres, danach die Regeltests.
# Lokal: DB_URL=postgres://postgres@localhost/postgres scripts/db-test.sh   (im CI läuft ein Postgres-Container)
set -euo pipefail
cd "$(dirname "$0")/.."
DB_URL="${DB_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
psql "$DB_URL" -q -c "drop database if exists magnum_test" -c "create database magnum_test"
TEST_URL="${DB_URL%/*}/magnum_test"
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f tests-db/neon-stubs.sql
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f db/setup.sql 2>&1 | grep -v NOTICE || true
for f in $(ls db/migrations/*.sql 2>/dev/null | sort); do
  echo "→ $(basename "$f")"; psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f db/setup.sql > /dev/null 2>&1 # mehrfach ausführbar
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f tests-db/regeln.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
