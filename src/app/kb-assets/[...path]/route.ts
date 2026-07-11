// Öffentliche Auslieferung der Wissensdatenbank-Bilder aus der Datei-Ablage
// (DATA_DIR/kb-assets, befüllt durch scripts/import-boldbi-docs.ts).
import { NextRequest, NextResponse } from "next/server";
import { readStoredFile } from "@/lib/storage";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const key = ["kb-assets", ...segments].join("/");
  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  try {
    const data = await readStoredFile(key); // resolveKey verhindert Path-Traversal
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
        // SVG kann Skripte enthalten — nie im Seitenkontext ausführen
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
}
