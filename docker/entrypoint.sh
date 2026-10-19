#!/bin/sh
# Migrate PostgreSQL before starting the single Web instance.
set -e

: "${DATABASE_URL:?DATABASE_URL must point to PostgreSQL}"
: "${HUOBAO_PROXY_SECRET:?HUOBAO_PROXY_SECRET is required}"

cd /app/backend
node_modules/.bin/tsx scripts/migrate-postgres.ts
exec node_modules/.bin/tsx src/index.ts
