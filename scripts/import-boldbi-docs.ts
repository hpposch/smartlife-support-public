// Import der Bold-BI-Dokumentation in die Wissensdatenbank — mit Rebranding:
//   "Bold BI"   → smartlife BI
//   "Syncfusion" → smartlife
//
//   git clone --depth 1 https://github.com/boldbi/bold-bi-docs.git /tmp/bold-bi-docs
//   npx tsx scripts/import-boldbi-docs.ts /tmp/bold-bi-docs [--limit N] [--dry-run] [--prune]
//
// Der Import ist idempotent (Slug aus dem Dateipfad): erneutes Ausführen
// aktualisiert bestehende Artikel. Bilder werden in die Datei-Ablage kopiert
// (DATA_DIR/kb-assets) und über /kb-assets/... ausgeliefert; interne
// Doc-Links werden auf die entsprechenden KB-Artikel umgeschrieben.
// Technische Bezeichner (z. B. boldbi-embed.js, cdn.boldbi.com) bleiben
// unverändert, damit Code-Beispiele funktionsfähig bleiben.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";
import { env } from "../src/lib/env";

const BRAND_PRODUCT = "smartlife BI"; // ersetzt "Bold BI"
const BRAND_COMPANY = "smartlife"; //    ersetzt "Syncfusion"
const BRAND_WEBSITE = "https://www.smartlifebi.com"; // ersetzt www.boldbi.com / syncfusion.com

interface ParsedDoc {
  relPath: string; //   docs/working-with-dashboards/edit-existing-dashboard.md
  sitePath: string; //  /working-with-dashboards/edit-existing-dashboard/
  canonical: string | null;
  title: string;
  body: string;
  category: string;
  slug: string;
}

// ---------------------------------------------------------------------------
// Parsing & Rebranding (pur, testbar)
// ---------------------------------------------------------------------------

export function splitFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: raw.slice(match[0].length) };
}

/** Titel: erste H1 im Text, sonst Frontmatter-Titel ohne SEO-Suffix ("… | Bold BI Docs"). */
export function extractTitle(meta: Record<string, string>, body: string): string {
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const raw = meta.title ?? "Artikel";
  return raw.split("|")[0].trim();
}

export function rebrand(text: string): string {
  return text
    .replace(/Bold\s+BI/gi, BRAND_PRODUCT)
    .replace(/Syncfusion/gi, BRAND_COMPANY);
}

/**
 * Externe Bold-BI-/Syncfusion-URLs umschreiben (läuft VOR dem Text-Rebranding,
 * damit URLs gezielt statt wortweise ersetzt werden):
 *   help.boldbi.com/<pfad>  → /kb/<slug> (wenn der Artikel importiert wurde)
 *   support.boldbi.com/*    → /kb (unser Hilfe-Center)
 *   www.boldbi.com/*        → BRAND_WEBSITE
 *   *.syncfusion.com/*      → BRAND_WEBSITE
 * Funktionale URLs (cdn.boldbi.com, demo-/Beispiel-Instanzen) bleiben stehen,
 * damit Code-Beispiele lauffähig bleiben.
 */
export function rewriteExternalUrls(body: string, linkMap: Map<string, string>): string {
  return body
    .replace(/https?:\/\/help\.boldbi\.com(\/[a-z0-9/._-]*?)\/?(#[^)\s"'<>]*)?(?=[)\s"'<>]|$)/gi, (_full, urlPath, fragment) => {
      const slug = linkMap.get(String(urlPath).replace(/\/$/, ""));
      // Nicht auflösbare Doku-Pfade (im Repo entfernt) → Hilfe-Center-Startseite
      return slug ? `/kb/${slug}${fragment ?? ""}` : "/kb";
    })
    .replace(/https?:\/\/support\.boldbi\.com[^)\s"'<>]*/gi, "/kb")
    .replace(/https?:\/\/(www\.)?boldbi\.com[^)\s"'<>]*/gi, BRAND_WEBSITE)
    .replace(/https?:\/\/[a-z0-9.-]*syncfusion\.com[^)\s"'<>]*/gi, BRAND_WEBSITE);
}

/** Stabiler, eindeutiger Slug aus dem Repo-Pfad. */
export function slugForPath(relPath: string): string {
  const base = relPath
    .replace(/\.md$/, "")
    .replace(/^docs\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
  const hash = createHash("sha256").update(relPath).digest("hex").slice(0, 6);
  return `${base}-${hash}`;
}

export function categoryName(relPath: string): string {
  const parts = relPath.replace(/^(docs|api)\//, "").split("/");
  // Dateien direkt auf Root-Ebene haben keinen Kategorie-Ordner
  if (parts.length === 1) return "Allgemein";
  const name = parts[0]
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return rebrand(name);
}

/**
 * Bild-URLs (/static/assets/...) auf /kb-assets/... und interne Doc-Links
 * auf /kb/<slug> umschreiben. Gatsby-Größensuffixe (#width=60%) entfernen.
 */
export function rewriteLinks(
  body: string,
  linkMap: Map<string, string>,
  collectAsset: (assetPath: string) => void
): string {
  // Markdown- und HTML-Bildpfade
  let out = body.replace(/(\]\(|src=")(\/static\/assets\/[^)"#\s]+)(#[^)"\s]*)?/g, (_, prefix, asset) => {
    collectAsset(asset);
    return `${prefix}${asset.replace("/static/assets/", "/kb-assets/")}`;
  });

  // Interne Doc-Links → KB-Artikel (Fragmente bleiben erhalten)
  out = out.replace(/\]\((\/[a-z0-9][a-z0-9/._-]*?)\/?(#[^)]*)?\)/g, (full, linkPath, fragment) => {
    if (linkPath.startsWith("/kb-assets/") || linkPath.startsWith("/static/")) return full;
    const slug = linkMap.get(linkPath.replace(/\/$/, ""));
    return slug ? `](/kb/${slug}${fragment ?? ""})` : full;
  });

  return out;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

async function main() {
  const repoDir = process.argv[2];
  if (!repoDir) {
    console.error("Aufruf: npx tsx scripts/import-boldbi-docs.ts <pfad-zum-bold-bi-docs-clone> [--limit N] [--dry-run]");
    process.exit(1);
  }
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
  const dryRun = process.argv.includes("--dry-run");
  const prune = process.argv.includes("--prune");

  const { readdir } = await import("node:fs/promises");
  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(path.join(repoDir, dir), { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await walk(rel)));
      else if (entry.name.endsWith(".md")) out.push(rel);
    }
    return out;
  }
  const files = [...(await walk("docs")), ...(await walk("api"))].sort();
  console.log(`${files.length} Markdown-Dateien gefunden${limit < Infinity ? `, importiere ${limit}` : ""}`);

  // Pass 1: parsen + Link-Karte aufbauen (Site-Pfad und canonical → Slug)
  const parsed: ParsedDoc[] = [];
  const linkMap = new Map<string, string>();
  for (const relPath of files.slice(0, limit)) {
    const raw = await readFile(path.join(repoDir, relPath), "utf8");
    const { meta, body } = splitFrontMatter(raw);
    const slug = slugForPath(relPath);
    const sitePath = "/" + relPath.replace(/^docs\//, "").replace(/\.md$/, "");
    const canonical = meta.canonical ? "/" + meta.canonical.replace(/^\/|\/$/g, "") : null;
    parsed.push({
      relPath,
      sitePath,
      canonical,
      title: rebrand(extractTitle(meta, body)).slice(0, 300),
      body,
      category: categoryName(relPath),
      slug,
    });
    linkMap.set(sitePath, slug);
    if (canonical) linkMap.set(canonical, slug);
  }

  // Pass 2: Kategorien anlegen, Artikel schreiben, Bilder sammeln
  const { slugify } = await import("../src/lib/markdown");
  const categoryIds = new Map<string, string>();
  const assets = new Set<string>();
  let created = 0;
  let updated = 0;

  for (const doc of parsed) {
    if (!categoryIds.has(doc.category) && !dryRun) {
      const cat = await db.kbCategory.upsert({
        where: { slug: slugify(doc.category) },
        update: {},
        create: { name: doc.category, slug: slugify(doc.category) },
      });
      categoryIds.set(doc.category, cat.id);
    }

    const bodyMarkdown = rebrand(
      rewriteExternalUrls(
        rewriteLinks(doc.body, linkMap, (asset) => assets.add(asset)),
        linkMap
      )
    );

    if (dryRun) continue;
    const existing = await db.kbArticle.findUnique({ where: { slug: doc.slug } });
    await db.kbArticle.upsert({
      where: { slug: doc.slug },
      update: { title: doc.title, bodyMarkdown, categoryId: categoryIds.get(doc.category) },
      create: {
        slug: doc.slug,
        title: doc.title,
        bodyMarkdown,
        categoryId: categoryIds.get(doc.category),
        status: "published",
        visibility: "public",
        publishedAt: new Date(),
      },
    });
    existing ? updated++ : created++;
    if ((created + updated) % 100 === 0) console.log(`  … ${created + updated} Artikel`);
  }

  // Pass 3: referenzierte Bilder in die Datei-Ablage kopieren
  let copied = 0;
  let missing = 0;
  if (!dryRun) {
    for (const asset of assets) {
      const source = path.join(repoDir, asset.replace(/^\//, ""));
      const target = path.join(
        path.resolve(env.dataDir),
        "kb-assets",
        asset.replace("/static/assets/", "")
      );
      try {
        await stat(source);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(source, target);
        copied++;
      } catch {
        missing++;
      }
    }
  }

  // Verwaiste importierte Artikel: existieren in der KB, aber nicht mehr im
  // Repo (Doku-Seite wurde entfernt/verschoben). Erkennbar am Hash-Suffix
  // unserer Import-Slugs. Ohne --prune nur melden, mit --prune löschen.
  if (!dryRun && limit === Infinity) {
    const currentSlugs = new Set(parsed.map((doc) => doc.slug));
    const imported = await db.kbArticle.findMany({
      select: { id: true, slug: true, title: true },
    });
    const orphans = imported.filter(
      (a) => /-[0-9a-f]{6}$/.test(a.slug) && !currentSlugs.has(a.slug)
    );
    if (orphans.length > 0) {
      if (prune) {
        await db.kbArticle.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
        console.log(`${orphans.length} verwaiste Artikel gelöscht (--prune)`);
      } else {
        console.log(
          `${orphans.length} Artikel existieren nicht mehr im Repo (mit --prune löschen):`
        );
        for (const orphan of orphans.slice(0, 10)) console.log(`  - ${orphan.title}`);
        if (orphans.length > 10) console.log(`  … und ${orphans.length - 10} weitere`);
      }
    }
  }

  // Leere Kategorien entfernen (z. B. nach Umbenennungen aus früheren Läufen)
  if (!dryRun) {
    const removed = await db.kbCategory.deleteMany({ where: { articles: { none: {} } } });
    if (removed.count > 0) console.log(`${removed.count} leere Kategorie(n) entfernt`);
  }

  console.log(
    `Fertig: ${created} neu, ${updated} aktualisiert, ${categoryIds.size} Kategorien, ` +
      `${copied} Bilder kopiert${missing ? `, ${missing} Bildverweise ohne Datei` : ""}`
  );
}

// Nur ausführen, wenn direkt aufgerufen (Funktionen sind für Tests exportiert)
if (process.argv[1]?.includes("import-boldbi-docs")) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
