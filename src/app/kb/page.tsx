import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentContact } from "@/lib/portal-session";
import { currentProduct, productAccent } from "@/lib/product";
import { searchKb } from "@/server/kb-search";

/** Standard-Icon für Kategorien ohne hochgeladenes Icon (in Akzentfarbe). */
function DefaultCategoryIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
      <path
        d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8 13h8M8 16h5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default async function KbHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kategorie?: string }>;
}) {
  const { q, kategorie } = await searchParams;
  const contact = await getCurrentContact();
  const product = await currentProduct();
  const accent = productAccent(product);

  // Öffentliche Artikel für alle; "customers" zusätzlich für eingeloggte Kunden
  const visibility: Prisma.KbArticleWhereInput = contact
    ? { visibility: { in: ["public", "customers"] } }
    : { visibility: "public" };
  const base: Prisma.KbArticleWhereInput = {
    status: "published",
    productId: product.id,
    ...visibility,
    OR: [{ categoryId: null }, { category: { isHidden: false } }],
  };

  const categories = await db.kbCategory.findMany({
    where: { isHidden: false, productId: product.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { articles: { where: { status: "published", ...visibility } } } } },
  });

  const activeCategory = kategorie
    ? categories.find((c) => c.slug === kategorie)
    : null;

  // Artikel-Liste bei Suche (Volltext + optional semantisch) oder Kategorie
  let articles: { id: string; title: string; slug: string; categoryName: string | null }[] = [];
  const showList = !!q?.trim() || !!activeCategory;
  if (q?.trim()) {
    articles = await searchKb({
      productId: product.id,
      query: q,
      includeCustomers: !!contact,
      limit: 100,
    });
  } else if (activeCategory) {
    const rows = await db.kbArticle.findMany({
      where: { AND: [base, { categoryId: activeCategory.id }] },
      include: { category: true },
      orderBy: { title: "asc" },
      take: 500,
    });
    articles = rows.map((a) => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
      categoryName: a.category?.name ?? null,
    }));
  }

  // Suchen protokollieren — "Suchen ohne Treffer" zeigen Doku-Lücken (Reporting)
  if (q?.trim()) {
    await db.kbSearchQuery
      .create({
        data: { productId: product.id, query: q.trim().slice(0, 200), results: articles.length },
      })
      .catch(() => {});
  }

  return (
    <div>
      {/* Hero mit einstellbarer Produktfarbe (Verwaltung → Produkte) */}
      <div
        className="px-4 py-14 text-center"
        style={{
          background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 55%, #0f172a))`,
        }}
      >
        <h1 className="text-3xl font-semibold text-white">Wie können wir helfen?</h1>
        <p className="mt-2 text-sm text-white/70">
          Durchsuchen Sie die {product.name}-Wissensdatenbank
        </p>
        <form method="GET" className="mx-auto mt-6 flex max-w-xl gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Suchbegriff eingeben …"
            className="input h-12 rounded-lg border-0 bg-white px-4 text-base shadow-lg"
          />
          <button
            type="submit"
            className="h-12 shrink-0 rounded-lg bg-slate-900/80 px-5 text-sm font-medium text-white shadow-lg hover:bg-slate-900"
          >
            Suchen
          </button>
        </form>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10">
        {showList ? (
          <div>
            <p className="mb-4 text-sm text-slate-500">
              <Link href="/kb" className="hover:underline" style={{ color: accent }}>
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
                    className="block rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-300 hover:shadow"
                  >
                    <span className="text-sm font-medium">{article.title}</span>
                    {q && article.categoryName && (
                      <span className="mt-0.5 block text-xs text-slate-400">{article.categoryName}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories
              .filter((cat) => cat._count.articles > 0)
              .map((cat) => (
                <Link
                  key={cat.id}
                  href={`/kb?kategorie=${cat.slug}`}
                  className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full"
                    style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, white)` }}
                  >
                    {cat.iconKey ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/${cat.iconKey}`} alt="" className="h-6 w-6 object-contain" />
                    ) : (
                      <DefaultCategoryIcon color={accent} />
                    )}
                  </span>
                  <span>
                    <h2 className="font-medium group-hover:underline">{cat.name}</h2>
                    <p className="mt-0.5 text-sm text-slate-400">{cat._count.articles} Artikel</p>
                  </span>
                </Link>
              ))}
            {categories.every((cat) => cat._count.articles === 0) && (
              <p className="col-span-full text-center text-slate-500">Noch keine Artikel veröffentlicht.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
