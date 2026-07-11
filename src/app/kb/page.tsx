import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentContact } from "@/lib/portal-session";

export default async function KbHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const contact = await getCurrentContact();

  // Öffentliche Artikel für alle; "customers" zusätzlich für eingeloggte Kunden
  const visibility: Prisma.KbArticleWhereInput = contact
    ? { visibility: { in: ["public", "customers"] } }
    : { visibility: "public" };
  const base: Prisma.KbArticleWhereInput = { status: "published", ...visibility };

  const where: Prisma.KbArticleWhereInput = q?.trim()
    ? {
        ...base,
        OR: [
          { title: { contains: q.trim(), mode: "insensitive" } },
          { bodyMarkdown: { contains: q.trim(), mode: "insensitive" } },
        ],
      }
    : base;

  const [articles, categories] = await Promise.all([
    db.kbArticle.findMany({
      where,
      include: { category: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    db.kbCategory.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  const byCategory = new Map<string, typeof articles>();
  for (const article of articles) {
    const key = article.category?.name ?? "Allgemein";
    byCategory.set(key, [...(byCategory.get(key) ?? []), article]);
  }

  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold">Wie können wir helfen?</h1>
        <form method="GET" className="mx-auto mt-4 flex max-w-lg gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Suchbegriff …"
            className="input"
          />
          <button type="submit" className="btn-primary shrink-0">
            Suchen
          </button>
        </form>
      </div>

      {articles.length === 0 && (
        <p className="text-center text-slate-500">
          {q ? "Keine Artikel gefunden." : "Noch keine Artikel veröffentlicht."}
        </p>
      )}

      <div className="space-y-8">
        {[...byCategory.entries()]
          .sort(([a], [b]) => {
            const ia = categories.findIndex((c) => c.name === a);
            const ib = categories.findIndex((c) => c.name === b);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
          })
          .map(([categoryName, items]) => (
            <section key={categoryName}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {categoryName}
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {items.map((article) => (
                  <li key={article.id}>
                    <Link
                      href={`/kb/${article.slug}`}
                      className="block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium shadow-sm hover:border-blue-300 hover:text-blue-700"
                    >
                      {article.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  );
}
