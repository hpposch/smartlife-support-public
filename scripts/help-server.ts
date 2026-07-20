// Statischer Server für das eigenständige Help-Portal (Doku-Site) —
// läuft PARALLEL zum Support-System auf einem eigenen Port.
//
//   HELP_PORT      Port (Standard 3001)
//   HELP_SITE_DIR  Verzeichnis der gebauten Site (Standard ./data/help-site,
//                  im All-in-One-Container /data/help-site)
//
// Bauen der Site: Original-Pipeline des Doku-Repos (npm run production-build),
// danach scripts/rebrand-help-site.ts — im Container: docker/build-help.sh
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const PORT = Number(process.env.HELP_PORT ?? 3001);
const ROOT = path.resolve(process.env.HELP_SITE_DIR ?? "./data/help-site");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const PLACEHOLDER = `<!DOCTYPE html><html lang="de"><meta charset="utf-8"><title>Help-Portal</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6">
<h1>Help-Portal noch nicht gebaut</h1>
<p>Die Doku-Site wurde noch nicht generiert. Im All-in-One-Container:</p>
<pre style="background:#f1f5f9;padding:1rem;border-radius:.5rem">docker exec smartlife-support bash docker/build-help.sh /import/bold-bi-docs</pre>
</body></html>`;

function send(res: import("node:http").ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

createServer(async (req, res) => {
  try {
    if (!existsSync(path.join(ROOT, "index.html"))) {
      return send(res, 200, "text/html; charset=utf-8", PLACEHOLDER);
    }
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let filePath = path.resolve(ROOT, "." + urlPath);
    if (!filePath.startsWith(ROOT)) return send(res, 403, "text/plain", "Forbidden");

    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      info = await stat(filePath).catch(() => null);
    }
    if (!info) {
      // /pfad ohne Slash → /pfad/index.html probieren
      const alt = path.join(filePath, "index.html");
      info = await stat(alt).catch(() => null);
      if (info) filePath = alt;
    }
    if (!info) {
      const notFound = path.join(ROOT, "404.html");
      if (existsSync(notFound)) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        return createReadStream(notFound).pipe(res);
      }
      return send(res, 404, "text/plain", "Nicht gefunden");
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers: Record<string, string> = {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    };

    // Range-Requests (Video-Player spulen damit): bytes=start-end
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2]) && (ext === ".mp4" || ext === ".webm")) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        res.writeHead(416, { "Content-Range": `bytes */${info.size}` });
        return res.end();
      }
      res.writeHead(206, {
        ...headers,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Content-Length": String(end - start + 1),
      });
      return createReadStream(filePath, { start, end }).pipe(res);
    }

    res.writeHead(200, {
      ...headers,
      "Accept-Ranges": "bytes",
      "Content-Length": String(info.size),
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error("[help]", error);
    send(res, 500, "text/plain", "Serverfehler");
  }
}).listen(PORT, () => {
  console.log(`Help-Portal auf http://localhost:${PORT} (Site: ${ROOT})`);
});
