#!/usr/bin/env bash
# Baut das eigenständige Help-Portal (Doku-Site) im All-in-One-Container.
# Vorbereitung: bold-bi-docs-Repo beim Start als Volume einhängen, z. B.
#   docker run … -v C:\Development\bold-bi-docs:/import/bold-bi-docs:ro …
# Aufruf (auch für Doku-Updates einfach wiederholen):
#   docker exec smartlife-support bash docker/build-help.sh /import/bold-bi-docs
set -euo pipefail

DOCS_DIR="${1:?Aufruf: build-help.sh <pfad-zum-bold-bi-docs-repo>}"
export HELP_SITE_DIR="${HELP_SITE_DIR:-/data/help-site}"
# "Support kontaktieren"-Link im Help-Portal: Portal-URL des Standard-Produkts,
# per HELP_SUPPORT_URL überschreibbar
if [ -z "${HELP_SUPPORT_URL:-}" ] && [ -f /data/app.env ]; then
  # shellcheck disable=SC1091
  set -a; . /data/app.env; set +a
  export HELP_SUPPORT_URL="${APP_URL:-}"
fi

npx tsx scripts/build-help-site.ts "$DOCS_DIR"
echo
echo "Help-Portal aktualisiert — erreichbar auf Port ${HELP_PORT:-3001}."
