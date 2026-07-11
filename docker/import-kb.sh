#!/usr/bin/env bash
# Wissensdatenbank-Import im laufenden All-in-One-Container — inkl. Rebranding
# und Logo-Ersetzung in den Screenshots.
#
# Vorbereitung: bold-bi-docs-Repo auf dem Host clonen und beim Container-Start
# read-only einhängen, z. B.
#   docker run … -v C:\Development\bold-bi-docs:/import/bold-bi-docs:ro …
#
# Aufruf (auch für spätere Updates der Doku einfach wiederholen):
#   docker exec smartlife-support bash docker/import-kb.sh /import/bold-bi-docs
#   docker exec smartlife-support bash docker/import-kb.sh /import/bold-bi-docs --prune
set -euo pipefail

if [ ! -f /data/app.env ]; then
  echo "Fehler: /data/app.env fehlt — dieses Skript ist für den All-in-One-Container gedacht." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. /data/app.env
set +a

DOCS_DIR="${1:?Aufruf: import-kb.sh <pfad-zum-bold-bi-docs-repo> [weitere Import-Optionen wie --prune]}"
shift || true

npx tsx scripts/import-boldbi-docs.ts "$DOCS_DIR" "$@"

echo
echo "Ersetze Bold-BI-Logos in den importierten Screenshots …"
python3 scripts/replace-logo.py \
  --assets "$DATA_DIR/kb-assets" \
  --logo scripts/assets/smartlife-logo.png

echo
echo "Wissensdatenbank-Import abgeschlossen."
