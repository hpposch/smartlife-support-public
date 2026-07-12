// Wissensdatenbank-Suche: Postgres-Volltext (immer) + optionale semantische
// Suche über Embeddings (nur mit OpenAI-kompatiblem Provider). Beide
// Ergebnislisten werden per Reciprocal Rank Fusion kombiniert.
import type { KbVisibility } from "@prisma/client";
import { db } from "@/lib/db";
import { aiEmbed, isEmbeddingsEnabled } from "./ai-provider";

export interface KbHit {
  id: string;
  title: string;
  slug: string;
  categoryName: string | null;
}

interface SearchOptions {
  productId: string;
  query: string;
  /** true: auch Artikel mit Sichtbarkeit "customers" (eingeloggte Kunden) */
  includeCustomers?: boolean;
  limit?: number;
}

/** Kosinus-Ähnlichkeit zweier normalisierter Vektoren (= Skalarprodukt). */
export function cosine(a: Float32Array, b: number[]): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

/** Reciprocal Rank Fusion: kombiniert Ranglisten ohne Score-Normalisierung. */
export function fuseRankings(rankings: string[][], k = 60): string[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

async function fulltextIds(opts: SearchOptions): Promise<string[]> {
  const visibilities = opts.includeCustomers ? ["public", "customers"] : ["public"];
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT a."id"
    FROM "kb_articles" a
    LEFT JOIN "kb_categories" c ON c."id" = a."category_id"
    WHERE a."product_id" = ${opts.productId}
      AND a."status" = 'published'
      AND a."visibility"::text = ANY(${visibilities})
      AND (c."id" IS NULL OR c."is_hidden" = false)
      AND (
        a."search_tsv" @@ websearch_to_tsquery('german', ${opts.query})
        OR a."search_tsv" @@ websearch_to_tsquery('english', ${opts.query})
      )
    ORDER BY GREATEST(
      ts_rank(a."search_tsv", websearch_to_tsquery('german', ${opts.query})),
      ts_rank(a."search_tsv", websearch_to_tsquery('english', ${opts.query}))
    ) DESC
    LIMIT 50`;
  return rows.map((r) => r.id);
}

async function semanticIds(opts: SearchOptions): Promise<string[]> {
  if (!isEmbeddingsEnabled()) return [];
  const embedded = await aiEmbed([opts.query]).catch(() => null);
  if (!embedded) return [];
  const queryVector = embedded[0];

  const visibilities = opts.includeCustomers ? ["public", "customers"] : ["public"];
  const candidates = await db.$queryRaw<{ id: string; embedding: Buffer }[]>`
    SELECT a."id", a."embedding"
    FROM "kb_articles" a
    LEFT JOIN "kb_categories" c ON c."id" = a."category_id"
    WHERE a."product_id" = ${opts.productId}
      AND a."status" = 'published'
      AND a."visibility"::text = ANY(${visibilities})
      AND (c."id" IS NULL OR c."is_hidden" = false)
      AND a."embedding" IS NOT NULL`;

  return candidates
    .map((row) => ({
      id: row.id,
      score: cosine(
        new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4),
        queryVector
      ),
    }))
    .filter((r) => r.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((r) => r.id);
}

/** Kombinierte Suche; Reihenfolge = Relevanz. */
export async function searchKb(opts: SearchOptions): Promise<KbHit[]> {
  const query = opts.query.trim();
  if (!query) return [];
  const limit = opts.limit ?? 20;

  const [fulltext, semantic] = await Promise.all([fulltextIds(opts), semanticIds(opts)]);
  let ids = fuseRankings([fulltext, semantic]).slice(0, limit);

  // Fallback auf Teilstring-Suche, wenn weder Volltext noch Semantik treffen
  if (ids.length === 0) {
    const visibility = opts.includeCustomers
      ? { visibility: { in: ["public", "customers"] as KbVisibility[] } }
      : { visibility: "public" as const };
    const rows = await db.kbArticle.findMany({
      where: {
        productId: opts.productId,
        status: "published",
        ...visibility,
        AND: [{ OR: [{ categoryId: null }, { category: { isHidden: false } }] }],
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { bodyMarkdown: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: limit,
    });
    ids = rows.map((r) => r.id);
  }
  if (ids.length === 0) return [];

  const articles = await db.kbArticle.findMany({
    where: { id: { in: ids } },
    include: { category: true },
  });
  const byId = new Map(articles.map((a) => [a.id, a]));
  return ids
    .map((id) => byId.get(id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => ({ id: a.id, title: a.title, slug: a.slug, categoryName: a.category?.name ?? null }));
}

/**
 * Embeddings für neue/geänderte Artikel erzeugen (Worker-Job und Import).
 * Läuft in Batches; Fehler (z. B. Server ohne /v1/embeddings) sind nicht fatal.
 */
export async function embedPendingArticles(batchSize = 50): Promise<number> {
  if (!isEmbeddingsEnabled()) return 0;
  const pending = await db.$queryRaw<{ id: string; title: string; body_markdown: string }[]>`
    SELECT "id", "title", "body_markdown"
    FROM "kb_articles"
    WHERE "status" = 'published'
      AND ("embedding" IS NULL OR "embedded_at" < "updated_at")
    ORDER BY "updated_at" DESC
    LIMIT ${batchSize}`;
  if (pending.length === 0) return 0;

  const vectors = await aiEmbed(
    pending.map((a) => `${a.title}\n\n${a.body_markdown.slice(0, 4000)}`)
  ).catch((error) => {
    console.warn(`[kb-index] Embeddings nicht verfügbar: ${String(error).slice(0, 200)}`);
    return null;
  });
  if (!vectors) return 0;

  for (let i = 0; i < pending.length; i++) {
    const buffer = Buffer.from(new Float32Array(vectors[i]).buffer);
    await db.kbArticle.update({
      where: { id: pending[i].id },
      data: { embedding: buffer, embeddedAt: new Date() },
    });
  }
  return pending.length;
}
