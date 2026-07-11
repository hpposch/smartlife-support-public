import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentContact } from "@/lib/portal-session";

export default async function KbHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kategorie?: string }>;
}) {
  const { q, kategorie } = await searchParams;
  const contact = await getCurrentContact();

  // Öffentliche Artikel für alle; "customers" zusätzlich für eingeloggte Kunden
  const visibility: Prisma.KbArticleWhereInput = contact
    ? { visibility: { in: ["public", "customers"] } }
    : { visibility: "public" };
  const base: Prisma.KbArticleWhereInput = {
    status: "published",
    ...visibility,
    OR: [{ categoryId: null }, { category: { isHidden: false } }],
  };

  const categories = await db.kbCategory.findMany({
    where: { isHidden: false },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { articles: { where: { status: "published", ...visibility } } } } },
  });

  const activeCategory = kategorie
    ? categories.find((c) => c.slug === kategorie)
    : null;

  // Artikel-Liste nur bei Suche oder gewählter Kategorie
  const where: Prisma.KbArticleWhereInput | null = q?.trim()
    ? {
        AND: [
          base,
          {
            OR: [
              { title: { contains: q.trim(), mode: "insensitive" } },
              { bodyMarkdown: { contains: q.trim(), mode: "insensitive" } },
            ],
          },
        ],
      }
    : activeCategory
      ? { AND: [base, { categoryId: activeCategory.id }] }
      : null;

  const articles = where
    ? await db.kbArticle.findMany({
        where,
        include: { category: true },
        orderBy: { title: "asc" },
        take: 500,
      })
    : [];

  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold">Wie können wir helfen?</h1>
        <form method="GET" className="mx-auto mt-4 flex max-w-lg gap-2">
          <input name="q" defaultValue={q ?? ""} placeholder="Suchbegriff …" className="input" />
          <button type="submit" className="btn-primary shrink-0">
            Suchen
          </button>
        </form>
      </div>

      {where ? (
        <div>
          <p className="mb-4 text-sm text-slate-500">
            <Link href="/kb" className="text-blue-700 hover:underline">
              ← Alle Kategorien
            </Link>
            <span className="ml-3">
              {activeCategory && !q ? activeCategory.name : `Suche nach „${q}“`} — {articles.length}{" "}
              Artikel
            </span>
          </p>
          {articles.length === 0 && <p className="text-center text-slate-500">Keine Artikel gefunden.</p>}
          <ul className="grid gap-2 sm:grid-cols-2">
            {articles.map((article) => (
              <li key={article.id}>
                <Link
                  href={`/kb/${article.slug}`}
                  className="block rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-blue-300"
                >
                  <span className="text-sm font-medium hover:text-blue-700">{article.title}</span>
                  {q && article.category && (
                    <span className="mt-0.5 block text-xs text-slate-400">{article.category.name}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories
            .filter((cat) => cat._count.articles > 0)
            .map((cat) => (
              <Link
                key={cat.id}
                href={`/kb?kategorie=${cat.slug}`}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300"
              >
                <h2 className="font-medium">{cat.name}</h2>
                <p className="mt-1 text-sm text-slate-400">{cat._count.articles} Artikel</p>
              </Link>
            ))}
          {categories.every((cat) => cat._count.articles === 0) && (
            <p className="col-span-full text-center text-slate-500">Noch keine Artikel veröffentlicht.</p>
          )}
        </div>
      )}
    </div>
  );
}
