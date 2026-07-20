// Rebranding-Nachbearbeitung für das Help-Portal:
// Läuft über die FERTIGE Ausgabe des offiziellen bold-bi-docs-Builds
// (gulp production-build → gatsby build → public/) und tauscht Namen,
// Links, Logos und Favicons — die Original-Build-Pipeline bleibt unberührt.
//
//   npx tsx scripts/rebrand-help-site.ts <site-verzeichnis>
//
// Da die Site eine Gatsby/React-App ist, stehen die Texte nicht nur im HTML,
// sondern auch in page-data.json und den JS-Bundles — alle drei werden gepatcht.
//
//   HELP_SUPPORT_URL   Ziel für support.boldbi.com-Links (Standard: APP_URL
//                      bzw. http://localhost:3000 — das eigene Support-Portal)
import { readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const BRAND_PRODUCT = "smartlife BI"; // ersetzt "Bold BI"
const BRAND_COMPANY = "smartlife"; // ersetzt "Syncfusion"
const BRAND_WEBSITE = "https://www.smartlifebi.com"; // ersetzt www.boldbi.com / syncfusion.com
const SUPPORT_URL = (process.env.HELP_SUPPORT_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const LOGO_PNG = path.join(import.meta.dirname, "assets", "smartlife-logo.png");

// Dateiendungen, in denen Text ersetzt wird (Gatsby verteilt Inhalte auf alle drei)
const TEXT_EXT = new Set([".html", ".js", ".json", ".css", ".xml", ".txt", ".webmanifest", ".map"]);

const SITE_DIR = process.argv[2];
if (!SITE_DIR || !existsSync(path.join(SITE_DIR, "index.html"))) {
  console.error("Aufruf: rebrand-help-site.ts <site-verzeichnis>  (erwartet die gatsby-Ausgabe, z. B. public/)");
  process.exit(1);
}
const ROOT = path.resolve(SITE_DIR);

function rebrand(content: string): string {
  return (
    content
      // Tracking raus: Google-Tag-Manager-Snippets (Script + Noscript-Iframe)
      .replace(/<script[^>]*>[^<]*googletagmanager\.com[^<]*<\/script>/gi, "")
      .replace(/<noscript><iframe[^>]*googletagmanager\.com[^>]*><\/iframe><\/noscript>/gi, "")
      // … auch in den JS-Bundles: das gtag-Script steckt im React-Layout und
      // würde nach der Hydration erneut eingefügt — die URL wird daher überall
      // durch ein leeres data:-Script ersetzt (lädt nichts, sendet nichts)
      .replace(/https?:\/\/(www\.)?googletagmanager\.com[^"'\s)]*/gi, "data:text/javascript,")
      // Links: Doku-eigene Links werden wurzel-relativ (gleiche Domain wie das Portal),
      // Support-Links zeigen auf das eigene Support-Portal, Website-Links auf die eigene Website.
      // cdn.boldbi.com bleibt (lauffähige SDK-/Beispiel-Verweise).
      .replace(/https?:\/\/help\.boldbi\.com/gi, "")
      .replace(/https?:\/\/(www\.)?support\.boldbi\.com/gi, SUPPORT_URL)
      .replace(/https?:\/\/(www\.)?boldbi\.com/gi, BRAND_WEBSITE)
      .replace(/https?:\/\/(www\.)?syncfusion\.com/gi, BRAND_WEBSITE)
      // Namen: erst der Produktname (enthält "Bold"), dann der Firmenname
      .replace(/Bold\s+BI/gi, BRAND_PRODUCT)
      .replace(/Syncfusion/gi, BRAND_COMPANY)
  );
}

// Logo-SVGs: Original ist 124×44 (Icon + Schriftzug). Ersatz: eingebettetes
// smartlife-Logo (PNG als data-URI) + Schriftzug als SVG-Text.
function logoSvg(textColor: string): string {
  const png = readFileSync(LOGO_PNG).toString("base64");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="124" height="44" viewBox="0 0 124 44" fill="none">
<image x="0" y="2" width="40" height="40" href="data:image/png;base64,${png}"/>
<text x="48" y="29" font-family="'Segoe UI',system-ui,sans-serif" font-size="16" font-weight="600" fill="${textColor}">${BRAND_COMPANY}</text>
</svg>
`;
}

let patched = 0;
let files = 0;
function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    files++;
    if (!TEXT_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    const before = readFileSync(full, "utf8");
    const after = rebrand(before);
    if (after !== before) {
      writeFileSync(full, after);
      patched++;
    }
  }
}

walk(ROOT);

// Logos ersetzen (Header hell/dunkel)
let logos = 0;
for (const [file, color] of [
  ["img/boldbi-logo.svg", "#283A5E"],
  ["img/boldbi-logo-dark.svg", "#ffffff"],
] as const) {
  const target = path.join(ROOT, file);
  if (existsSync(target)) {
    writeFileSync(target, logoSvg(color));
    logos++;
  }
}

// Favicons: smartlife-Logo-PNG über alle favicon-Dateien legen
// (PNG-Daten in .ico funktionieren in allen aktuellen Browsern)
for (const entry of readdirSync(ROOT)) {
  if (/^favicon.*\.(ico|png)$/i.test(entry) && statSync(path.join(ROOT, entry)).isFile()) {
    copyFileSync(LOGO_PNG, path.join(ROOT, entry));
    logos++;
  }
}

console.log(
  `Rebranding fertig: ${patched} von ${files} Dateien angepasst, ${logos} Logos/Favicons ersetzt (Support-Link: ${SUPPORT_URL})`
);

// Kontrolle: kein "Bold BI" mehr in den HTML-Seiten
let leftovers = 0;
function check(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) check(full);
    else if (entry.name.endsWith(".html") && /Bold\s+BI/i.test(readFileSync(full, "utf8"))) leftovers++;
  }
}
check(ROOT);
if (leftovers) console.warn(`⚠ ${leftovers} HTML-Dateien enthalten noch "Bold BI"`);
