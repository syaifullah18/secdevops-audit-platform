#!/bin/sh
# Runs once on first start of an empty data directory (postgres image entrypoint).
# 1. Applies the Drizzle SQL migrations mounted at /sdap/drizzle (evaluation only; production
#    installs run migrations from the release process).
# 2. Creates a read-only role for Grafana's PostgreSQL datasource.
set -eu

for f in /sdap/drizzle/*.sql; do
  [ -e "$f" ] || continue
  echo "applying migration $f"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --file "$f"
done

: "${GRAFANA_PG_PASSWORD:?GRAFANA_PG_PASSWORD must be set}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set "grafana_pw=$GRAFANA_PG_PASSWORD" --set "dbname=$POSTGRES_DB" <<'SQL'
CREATE ROLE sdap_grafana_ro LOGIN PASSWORD :'grafana_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE :"dbname" TO sdap_grafana_ro;
GRANT USAGE ON SCHEMA public TO sdap_grafana_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sdap_grafana_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO sdap_grafana_ro;
ALTER ROLE sdap_grafana_ro SET default_transaction_read_only = on;
ALTER ROLE sdap_grafana_ro SET statement_timeout = '15s';
SQL
