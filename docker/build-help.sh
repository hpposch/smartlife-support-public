#!/usr/bin/env bash
# Baut das eigenständige Help-Portal im All-in-One-Container — mit der
# ORIGINAL-Build-Pipeline des bold-bi-docs-Repos (gulp build + gatsby build),
# danach läuft nur noch das Rebranding-Skript über die fertige HTML-Ausgabe.
#
# Vorbereitung: bold-bi-docs-Repo beim Start als Volume einhängen, z. B.
#   docker run … -v C:\Development\bold-bi-docs:/import/bold-bi-docs:ro …
# Aufruf (auch für Doku-Updates einfach wiederholen):
#   docker exec smartlife-support bash docker/build-help.sh /import/bold-bi-docs
set -euo pipefail

DOCS_DIR="${1:?Aufruf: build-help.sh <pfad-zum-bold-bi-docs-repo>}"
BUILD_DIR="${HELP_BUILD_DIR:-/data/help-build}"
export HELP_SITE_DIR="${HELP_SITE_DIR:-/data/help-site}"

# "Support kontaktieren"-Links im Help-Portal: Portal-URL des Support-Systems,
# per HELP_SUPPORT_URL überschreibbar
if [ -z "${HELP_SUPPORT_URL:-}" ] && [ -f /data/app.env ]; then
  # shellcheck disable=SC1091
  set -a; . /data/app.env; set +a
  export HELP_SUPPORT_URL="${APP_URL:-}"
fi

# 1) Repo in ein beschreibbares Build-Verzeichnis kopieren (der Mount ist
#    read-only; gulp/gatsby schreiben in ./static, ./src/pages, ./public, …).
#    node_modules bleibt zwischen Läufen erhalten — nur der Repo-Inhalt wird erneuert.
echo "Kopiere Doku-Repo nach ${BUILD_DIR} …"
mkdir -p "$BUILD_DIR"
find "$BUILD_DIR" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
tar -C "$DOCS_DIR" --exclude=./node_modules --exclude=./.cache --exclude=./public --exclude=./.git -cf - . \
  | tar -C "$BUILD_DIR" -xf -

cd "$BUILD_DIR"

# gatsby-node.js verweist auf "Layout.js", die Datei heißt "layout.js" —
# auf Windows egal, auf Linux nicht
if [ -f src/templates/layout.js ] && [ ! -f src/templates/Layout.js ]; then
  cp src/templates/layout.js src/templates/Layout.js
fi

# 2) Abhängigkeiten des Doku-Repos installieren (einmalig, dann nur bei Änderungen)
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installiere Doku-Build-Abhängigkeiten (einmalig, dauert einige Minuten) …"
  npm install --no-audit --no-fund
fi

# 3) Original-Produktionsbuild: gulp build (clean/copy/toc/site-variables) + gatsby build
#    Achtung: gulp ignoriert den gatsby-Exit-Code — Erfolg daher am Ergebnis prüfen
echo "Baue Doku-Site (gulp production-build) …"
npm run production-build
if [ ! -s public/index.html ]; then
  echo "FEHLER: gatsby build hat keine Site erzeugt — Log oben prüfen." >&2
  exit 1
fi

# 4) Fertige Site übernehmen und Rebranding anwenden (Namen, Links, Logos, Favicons)
echo "Übernehme Site nach ${HELP_SITE_DIR} und wende Rebranding an …"
rm -rf "${HELP_SITE_DIR}.neu"
cp -a public "${HELP_SITE_DIR}.neu"
cd /app 2>/dev/null || cd "$OLDPWD"
npx tsx scripts/rebrand-help-site.ts "${HELP_SITE_DIR}.neu"
rm -rf "$HELP_SITE_DIR"
mv "${HELP_SITE_DIR}.neu" "$HELP_SITE_DIR"

echo
echo "Help-Portal aktualisiert — erreichbar auf Port ${HELP_PORT:-3001}."
