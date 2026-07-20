#!/usr/bin/env bash
# Startskript für das All-in-One-Image (Dockerfile.all-in-one):
# PostgreSQL, Redis, Migrationen + Seed, Worker und Web-App in EINEM Container.
# Alle veränderlichen Daten liegen unter /data (als Volume mounten).
set -euo pipefail

PG_BIN=/usr/lib/postgresql/16/bin
export PGDATA="${PGDATA:-/data/postgres}"
export DATA_DIR="${DATA_DIR:-/data/app}"
export BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
export HELP_SITE_DIR="${HELP_SITE_DIR:-/data/help-site}"
export HELP_PORT="${HELP_PORT:-3001}"
REDIS_DIR=/data/redis

DB_USER=smartlife
DB_PASSWORD="${POSTGRES_PASSWORD:-smartlife}"
DB_NAME=smartlife_support
export DATABASE_URL="${DATABASE_URL:-postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export APP_URL="${APP_URL:-http://localhost:3000}"

mkdir -p "$DATA_DIR" "$BACKUP_DIR" "$REDIS_DIR" /run/postgresql
chown postgres:postgres /run/postgresql

# SESSION_SECRET: falls nicht gesetzt, einmal erzeugen und im Volume behalten,
# damit Logins einen Container-Neustart überleben
if [ -z "${SESSION_SECRET:-}" ]; then
  if [ ! -s /data/session-secret ]; then
    umask 077
    openssl rand -hex 32 > /data/session-secret
    umask 022
  fi
  SESSION_SECRET="$(cat /data/session-secret)"
  export SESSION_SECRET
fi

# Effektive Verbindungsdaten für docker-exec-Aufrufe bereitstellen
# (z. B. docker/import-kb.sh) — exec-Sitzungen erben die Variablen sonst nicht
umask 077
cat > /data/app.env <<ENV
DATABASE_URL='${DATABASE_URL}'
REDIS_URL='${REDIS_URL}'
DATA_DIR='${DATA_DIR}'
BACKUP_DIR='${BACKUP_DIR}'
APP_URL='${APP_URL}'
ENV
umask 022

# --- PostgreSQL ---
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "Initialisiere PostgreSQL-Datenverzeichnis unter $PGDATA …"
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
  su postgres -s /bin/bash -c \
    "$PG_BIN/initdb -D '$PGDATA' --encoding=UTF8 --auth-local=trust --auth-host=scram-sha-256"
fi
chown -R postgres:postgres "$PGDATA"

su postgres -s /bin/bash -c \
  "$PG_BIN/pg_ctl start -w -D '$PGDATA' -l '$PGDATA/server.log' -o '-c listen_addresses=localhost'"

su postgres -s /bin/bash -c "psql -v ON_ERROR_STOP=1" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SQL
if ! su postgres -s /bin/bash -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\"" | grep -q 1; then
  su postgres -s /bin/bash -c "createdb -O ${DB_USER} ${DB_NAME}"
fi

# --- Redis ---
redis-server --daemonize yes --dir "$REDIS_DIR" --save 60 1 --appendonly no \
  --bind 127.0.0.1 --port 6379 --logfile /data/redis.log
until redis-cli -h 127.0.0.1 ping >/dev/null 2>&1; do sleep 0.2; done

# --- Schema + Grunddaten ---
npx prisma migrate deploy
npm run db:seed

# --- Sauberes Herunterfahren bei docker stop ---
WEB_PID=""
WORKER_PID=""
HELP_PID=""
stop_services() {
  echo "Fahre herunter …"
  # Web/Worker laufen per setsid in eigenen Prozessgruppen → ganze Gruppe beenden,
  # sonst überleben die npm-Enkelprozesse (sh → tsx → node)
  [ -n "$WEB_PID" ] && { kill -- "-$WEB_PID" 2>/dev/null || kill "$WEB_PID" 2>/dev/null; } || true
  [ -n "$WORKER_PID" ] && { kill -- "-$WORKER_PID" 2>/dev/null || kill "$WORKER_PID" 2>/dev/null; } || true
  [ -n "$HELP_PID" ] && { kill -- "-$HELP_PID" 2>/dev/null || kill "$HELP_PID" 2>/dev/null; } || true
  # Warten, bis beide sich sauber beendet haben (der Worker schließt seine
  # Queues und braucht dafür Redis) — erst DANACH Redis/Postgres stoppen
  for _ in $(seq 1 20); do
    kill -0 "$WEB_PID" 2>/dev/null || kill -0 "$WORKER_PID" 2>/dev/null || break
    sleep 0.5
  done
  [ -n "$WEB_PID" ] && kill -9 -- "-$WEB_PID" 2>/dev/null || true
  [ -n "$WORKER_PID" ] && kill -9 -- "-$WORKER_PID" 2>/dev/null || true
  redis-cli -h 127.0.0.1 shutdown 2>/dev/null || true
  su postgres -s /bin/bash -c "$PG_BIN/pg_ctl stop -w -D '$PGDATA' -m fast" || true
}
trap 'trap - TERM INT; stop_services; exit 0' TERM INT

# --- Worker + Web-App + Help-Portal (eigene Prozessgruppen, s. stop_services) ---
setsid npm run worker &
WORKER_PID=$!
setsid npm run start &
WEB_PID=$!
# Eigenständiges Help-Portal (Doku-Site) parallel auf Port 3001
setsid npx tsx scripts/help-server.ts &
HELP_PID=$!

echo "smartlife Support läuft auf ${APP_URL} (Login: ${SEED_ADMIN_EMAIL:-admin@smartlife.software})"
echo "Help-Portal (Doku) läuft auf Port ${HELP_PORT} — Site bauen: docker/build-help.sh"

# Beendet sich einer der beiden Prozesse, Container mit Fehler beenden
EXIT_CODE=0
wait -n "$WORKER_PID" "$WEB_PID" || EXIT_CODE=$?
echo "Ein Prozess hat sich unerwartet beendet (Exit ${EXIT_CODE})."
trap - TERM INT
stop_services
exit 1
