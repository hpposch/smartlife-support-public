// Baut aus dem bold-bi-docs-Repo ein EIGENSTÄNDIGES Help-Portal (statische
// Doku-Site im Stil von help.smartlifebi.com) — getrennt von der Support-
// Wissensdatenbank. Ausliefern mit scripts/help-server.ts (Port 3001).
//
// Aufruf:
//   npx tsx scripts/build-help-site.ts /pfad/zu/bold-bi-docs [--out DIR]
//
// - Rebranding: „Bold BI“ → „smartlife BI“, „Syncfusion“ → „smartlife“
// - URLs folgen den Original-Pfaden (canonical bzw. Ordnerstruktur),
//   interne Links und help.boldbi.com-Links zeigen auf die eigene Site
// - Sidebar-Navigation aus der Ordnerstruktur, Titel-Suche, Bilder inklusive
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const SITE_NAME = process.env.HELP_SITE_NAME ?? "smartlife BI";
const ACCENT = process.env.HELP_ACCENT ?? "#7c3aed";
const SUPPORT_URL = process.env.HELP_SUPPORT_URL ?? "";
const BRAND_WEBSITE = "https://www.smartlifebi.com";

function rebrand(text: string): string {
  return text.replace(/Bold\s+BI/gi, "smartlife BI").replace(/Syncfusion/gi, "smartlife");
}

function titleCase(input: string): string {
  return rebrand(
    input
      .split("-")
      .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
  );
}

function slugifyAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

interface Doc {
  relPath: string; // z. B. docs/getting-started/foo.md
  sitePath: string; // /getting-started/foo
  canonical: string | null;
  url: string; // finale URL mit Slash am Ende
  section: string; // Ordner der obersten Ebene
  title: string;
  description: string;
  body: string;
}

function splitFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^"|"$/g, "");
  }
  return { meta, body: raw.slice(match[0].length) };
}

function extractTitle(meta: Record<string, string>, body: string, fallback: string): string {
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return rebrand(h1[1].trim());
  if (meta.title) return rebrand(meta.title.split("|")[0].trim());
  return titleCase(fallback);
}

const norm = (p: string) => "/" + p.replace(/^\/+|\/+$/g, "");

async function main() {
  const repoDir = process.argv[2];
  if (!repoDir) {
    console.error("Aufruf: npx tsx scripts/build-help-site.ts <pfad-zum-bold-bi-docs> [--out DIR]");
    process.exit(1);
  }
  const outArg = process.argv.indexOf("--out");
  const outDir = path.resolve(
    outArg > -1 ? process.argv[outArg + 1] : (process.env.HELP_SITE_DIR ?? "./data/help-site")
  );

  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(path.join(repoDir, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await walk(rel)));
      else if (entry.name.endsWith(".md")) out.push(rel);
    }
    return out;
  }
  const files = [...(await walk("docs")), ...(await walk("api"))].sort();
  console.log(`${files.length} Markdown-Dateien gefunden`);

  // Pass 1: parsen, URLs und Link-Karte aufbauen
  const docs: Doc[] = [];
  const linkMap = new Map<string, string>();
  for (const relPath of files) {
    const raw = await readFile(path.join(repoDir, relPath), "utf8");
    const { meta, body } = splitFrontMatter(raw);
    const bare = relPath.replace(/^docs\//, "").replace(/\.md$/, "");
    const sitePath = norm(bare);
    const canonical = meta.canonical ? norm(meta.canonical) : null;
    const url = (canonical ?? sitePath) + "/";
    const parts = bare.split("/");
    const section = relPath.startsWith("api/") ? "api" : parts.length > 1 ? parts[0] : "allgemein";
    const doc: Doc = {
      relPath,
      sitePath,
      canonical,
      url,
      section,
      title: extractTitle(meta, body, path.basename(bare)),
      description: rebrand(meta.description ?? ""),
      body,
    };
    docs.push(doc);
    linkMap.set(sitePath, url);
    if (canonical) linkMap.set(canonical, url);
  }

  // Navigation: Abschnitte nach Ordnern
  const sections = new Map<string, Doc[]>();
  for (const doc of docs) {
    if (!sections.has(doc.section)) sections.set(doc.section, []);
    sections.get(doc.section)!.push(doc);
  }
  for (const list of sections.values()) list.sort((a, b) => a.title.localeCompare(b.title, "de"));
  const sectionNames = [...sections.keys()].sort((a, b) =>
    a === "allgemein" ? -1 : b === "allgemein" ? 1 : a.localeCompare(b)
  );

  // Markdown-Renderer mit Überschriften-Ankern
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth, text }) {
    const id = slugifyAnchor(text);
    return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>`;
  };

  const assets = new Set<string>();

  function rewriteLinks(markdown: string, currentDir: string): string {
    // Bilder: /static/assets/... → /assets/...
    let out = markdown.replace(/(\]\(|src=")\/static\/assets\//g, (_m, prefix) => {
      return `${prefix}/assets/`;
    });
    // Asset-Verweise einsammeln
    for (const m of out.matchAll(/(?:\]\(|src=")\/assets\/([^)"\s#?]+)/g)) assets.add(m[1]);

    // Links auflösen: absolute Site-Pfade, help.boldbi.com, relative Pfade
    out = out.replace(
      /\]\(\s*([^)\s]+?)(\s+"[^"]*")?\)/g,
      (match, href: string, title = "") => {
        let target = href;
        const anchorIndex = target.indexOf("#");
        const anchor = anchorIndex > -1 ? target.slice(anchorIndex) : "";
        if (anchorIndex > -1) target = target.slice(0, anchorIndex);
        if (!target) return match; // reiner Anker

        const external = target.match(/^https?:\/\/(help|www|support)\.boldbi\.com(\/[^\s]*)?$/i);
        if (external) {
          const host = external[1].toLowerCase();
          if (host === "help") target = external[2] ?? "/";
          else if (host === "support") return `](${SUPPORT_URL || BRAND_WEBSITE}${anchor})`;
          else return `](${BRAND_WEBSITE}${anchor})`;
        } else if (/^[a-z]+:/i.test(target) || target.startsWith("/assets/")) {
          return match; // sonstige externe Links und Bilder unverändert
        }

        let resolved: string;
        if (target.startsWith("/")) {
          resolved = norm(target);
        } else {
          resolved = norm(path.posix.join(currentDir, target.replace(/\.md$/, "")));
        }
        const known = linkMap.get(resolved) ?? linkMap.get(resolved.replace(/\/$/, ""));
        return `](${known ?? resolved + "/"}${anchor}${title})`;
      }
    );
    return out;
  }

  function renderPage(doc: Doc): string {
    const currentDir = path.posix.dirname(doc.sitePath);
    const markdown = rebrand(rewriteLinks(doc.body, currentDir));
    const html = sanitizeHtml(marked.parse(markdown, { async: false, gfm: true, renderer }) as string, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "details", "summary"]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: ["href", "name", "target", "rel"],
        img: ["src", "alt", "width", "height", "loading"],
        "*": ["id", "class"],
      },
    });

    const nav = sectionNames
      .map((name) => {
        const open = name === doc.section ? " open" : "";
        const items = sections
          .get(name)!
          .map(
            (d) =>
              `<li${d.url === doc.url ? ' class="aktiv"' : ""}><a href="${d.url}">${d.title}</a></li>`
          )
          .join("");
        return `<details${open}><summary>${name === "api" ? "API-Referenz" : titleCase(name)}</summary><ul>${items}</ul></details>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${doc.title} — ${SITE_NAME} Dokumentation</title>
<meta name="description" content="${doc.description.replace(/"/g, "&quot;")}">
<link rel="icon" href="/assets/logo.png">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<header>
  <a class="marke" href="/"><img src="/assets/logo.png" alt=""> ${SITE_NAME} <span>Dokumentation</span></a>
  <div class="suche"><input id="suche" type="search" placeholder="Dokumentation durchsuchen …" autocomplete="off"><div id="treffer"></div></div>
  ${SUPPORT_URL ? `<a class="support" href="${SUPPORT_URL}">Support kontaktieren</a>` : ""}
</header>
<div class="layout">
  <nav>${nav}</nav>
  <main>
    <article>${html}</article>
    <footer>© ${SITE_NAME} — <a href="/">Dokumentation</a>${SUPPORT_URL ? ` · <a href="${SUPPORT_URL}">Support</a>` : ""}</footer>
  </main>
</div>
<script src="/assets/suche.js" defer></script>
</body>
</html>`;
  }

  // Seiten schreiben
  let written = 0;
  for (const doc of docs) {
    const target = path.join(outDir, doc.url, "index.html");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderPage(doc));
    if (++written % 200 === 0) console.log(`  … ${written} Seiten`);
  }

  // Startseite: auf Getting Started bzw. erste Sektion verweisen
  const start =
    docs.find((d) => d.section === "getting-started") ?? docs[0];
  const home = docs.find((d) => d.url === "/overview/about-bold-bi/") ?? start;
  await writeFile(
    path.join(outDir, "index.html"),
    `<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${home.url}">`
  );

  // 404
  await writeFile(
    path.join(outDir, "404.html"),
    `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Nicht gefunden — ${SITE_NAME}</title><link rel="stylesheet" href="/assets/site.css"></head><body><main style="max-width:40rem;margin:4rem auto;text-align:center"><h1>404</h1><p>Diese Seite existiert nicht (mehr).</p><p><a href="/">Zur Dokumentation</a></p></main></body></html>`
  );

  // Assets kopieren
  await mkdir(path.join(outDir, "assets"), { recursive: true });
  let copied = 0;
  let missing = 0;
  for (const asset of assets) {
    const source = path.join(repoDir, "static", "assets", asset);
    const target = path.join(outDir, "assets", asset);
    try {
      await stat(source);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      copied++;
    } catch {
      missing++;
    }
  }
  await copyFile(
    path.join(path.dirname(new URL(import.meta.url).pathname), "assets", "smartlife-logo.png"),
    path.join(outDir, "assets", "logo.png")
  ).catch(() => {});

  // Suche (Titel-Index) + CSS
  await writeFile(
    path.join(outDir, "assets", "suchindex.json"),
    JSON.stringify(docs.map((d) => ({ t: d.title, p: d.url, s: d.section })))
  );
  await writeFile(path.join(outDir, "assets", "suche.js"), SEARCH_JS);
  await writeFile(path.join(outDir, "assets", "site.css"), CSS.replaceAll("__ACCENT__", ACCENT));

  console.log(
    `Fertig: ${written} Seiten, ${sectionNames.length} Abschnitte, ${copied} Bilder` +
      (missing ? `, ${missing} Bildverweise ohne Datei` : "") +
      `\nAusgabe: ${outDir}`
  );
}

const SEARCH_JS = `
fetch("/assets/suchindex.json").then((r) => r.json()).then((index) => {
  const input = document.getElementById("suche");
  const box = document.getElementById("treffer");
  if (!input || !box) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    box.innerHTML = "";
    if (q.length < 2) return;
    const hits = index.filter((e) => e.t.toLowerCase().includes(q)).slice(0, 12);
    for (const hit of hits) {
      const a = document.createElement("a");
      a.href = hit.p;
      a.textContent = hit.t;
      box.appendChild(a);
    }
    if (!hits.length) box.innerHTML = '<span class="leer">Keine Treffer</span>';
  });
  document.addEventListener("click", (e) => { if (!box.contains(e.target) && e.target !== input) box.innerHTML = ""; });
});
`;

const CSS = `
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1e293b;background:#f8fafc}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1.5rem;padding:.6rem 1.25rem;background:#fff;border-bottom:1px solid #e2e8f0}
.marke{display:flex;align-items:center;gap:.5rem;font-weight:600;color:#0f172a;text-decoration:none;white-space:nowrap}
.marke img{height:26px}
.marke span{color:__ACCENT__}
.suche{position:relative;flex:1;max-width:34rem}
.suche input{width:100%;padding:.5rem .8rem;border:1px solid #cbd5e1;border-radius:.5rem;font-size:.9rem}
#treffer{position:absolute;left:0;right:0;top:110%;background:#fff;border:1px solid #e2e8f0;border-radius:.5rem;box-shadow:0 10px 24px rgba(15,23,42,.12);overflow:hidden}
#treffer a{display:block;padding:.45rem .8rem;font-size:.85rem;color:#1e293b;text-decoration:none}
#treffer a:hover{background:#f1f5f9}
#treffer .leer{display:block;padding:.45rem .8rem;font-size:.85rem;color:#94a3b8}
.support{margin-left:auto;background:__ACCENT__;color:#fff;text-decoration:none;font-size:.85rem;padding:.45rem .9rem;border-radius:.5rem;white-space:nowrap}
.layout{display:grid;grid-template-columns:280px 1fr;max-width:1200px;margin:0 auto;gap:2rem;padding:1.25rem}
nav{position:sticky;top:64px;align-self:start;max-height:calc(100vh - 80px);overflow:auto;font-size:.85rem;padding-right:.5rem}
nav details{margin-bottom:.35rem}
nav summary{cursor:pointer;font-weight:600;padding:.3rem .4rem;border-radius:.4rem;color:#0f172a}
nav summary:hover{background:#eef2f7}
nav ul{list-style:none;margin:.15rem 0 .4rem;padding-left:.9rem;border-left:1px solid #e2e8f0}
nav li a{display:block;padding:.22rem .4rem;color:#475569;text-decoration:none;border-radius:.35rem}
nav li a:hover{color:#0f172a;background:#eef2f7}
nav li.aktiv a{color:__ACCENT__;font-weight:600}
main{min-width:0}
article{background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;padding:2rem 2.25rem;line-height:1.65;font-size:.95rem}
article h1{margin-top:0;font-size:1.6rem}
article h2{margin-top:2rem;padding-top:.75rem;border-top:1px solid #f1f5f9;font-size:1.2rem}
article img{max-width:100%;border:1px solid #e2e8f0;border-radius:.5rem}
article pre{background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:.5rem;overflow:auto;font-size:.85rem}
article code{background:#f1f5f9;padding:.1rem .3rem;border-radius:.25rem;font-size:.85em}
article pre code{background:none;padding:0}
article a{color:__ACCENT__}
article table{border-collapse:collapse;width:100%;font-size:.88rem}
article th,article td{border:1px solid #e2e8f0;padding:.45rem .6rem;text-align:left}
article th{background:#f8fafc}
footer{margin:1.25rem 0;text-align:center;font-size:.8rem;color:#94a3b8}
footer a{color:#64748b}
@media(max-width:900px){.layout{grid-template-columns:1fr}nav{position:static;max-height:none}}
`;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
