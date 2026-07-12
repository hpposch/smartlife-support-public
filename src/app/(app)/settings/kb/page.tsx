import Link from "next/link";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { saveUploadedImage } from "@/lib/branding";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";
import { slugify } from "@/lib/markdown";

const PAGE_SIZE = 50;
const STATUS_LABELS = { draft: "Ausgeblendet", published: "Veröffentlicht", archived: "Archiviert" };
const VISIBILITY_LABELS = { public: "Öffentlich", customers: "Nur Kunden", internal: "Intern" };

async function createCategory(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const productId = String(formData.get("productId") ?? "");
  if (!name || !productId) return;
  const max = await db.kbCategory.aggregate({ _max: { sortOrder: true } });
  await db.kbCategory.create({
    data: { name, slug: slugify(name), productId, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath("/settings/kb");
}

async function toggleCategoryHidden(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const category = await db.kbCategory.findUniqueOrThrow({ where: { id } });
  await db.kbCategory.update({ where: { id }, data: { isHidden: !category.isHidden } });
  revalidatePath("/settings/kb");
  revalidatePath("/kb");
}

/** Kategorie-Icon hochladen bzw. entfernen (Karte im Hilfe-Center). */
async function setCategoryIcon(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  if (formData.get("removeIcon") === "1") {
    await db.kbCategory.update({ where: { id }, data: { iconKey: null } });
  } else {
    const iconKey = await saveUploadedImage(formData.get("icon"), `cat-${id.slice(0, 8)}`);
    if (iconKey) await db.kbCategory.update({ where: { id }, data: { iconKey } });
  }
  revalidatePath("/settings/kb");
  revalidatePath("/kb");
}

/** Artikel ausblenden (→ Entwurf) bzw. wieder veröffentlichen. */
async function toggleArticleHidden(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const article = await db.kbArticle.findUniqueOrThrow({ where: { id } });
  await db.kbArticle.update({
    where: { id },
    data:
      article.status === "published"
        ? { status: "draft" }
        : { status: "published", publishedAt: article.publishedAt ?? new Date() },
  });
  revalidatePath("/settings/kb");
  revalidatePath("/kb");
}

export default async function KbAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; page?: string; produkt?: string }>;
}) {
  await requireAdmin();
  const { q, cat, page: pageParam, produkt } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const where: Prisma.KbArticleWhereInput = {
    ...(q?.trim() ? { title: { contains: q.trim(), mode: "insensitive" } } : {}),
    ...(cat ? { categoryId: cat } : {}),
    ...(produkt ? { productId: produkt } : {}),
  };

  const [articles, total, categories, products] = await Promise.all([
    db.kbArticle.findMany({
      where,
      include: { category: true },
      orderBy: { title: "asc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.kbArticle.count({ where }),
    db.kbCategory.findMany({
      where: produkt ? { productId: produkt } : undefined,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { articles: true } }, product: true },
    }),
    db.product.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          Wissensdatenbank <span className="text-sm font-normal text-slate-500">({total} Artikel)</span>
        </h1>
        <Link href="/settings/kb/new" className="btn-primary">
          Neuer Artikel
        </Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Kategorien</h2>
        <p className="mb-3 text-xs text-slate-500">
          Ausgeblendete Kategorien verschwinden mit allen Artikeln aus dem Hilfe-Center.
        </p>
        <ul className="mb-3 flex flex-wrap gap-2">
          {categories.map((category) => (
            <li
              key={category.id}
              className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${
                category.isHidden
                  ? "border-slate-200 bg-slate-100 text-slate-400"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {category.iconKey && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/${category.iconKey}`} alt="" className="h-4 w-4 object-contain" />
              )}
              <span className={category.isHidden ? "line-through" : ""}>
                {category.name} ({category._count.articles})
                {products.length > 1 && (
                  <span className="ml-1 text-slate-400">· {category.product.name}</span>
                )}
              </span>
              <form action={toggleCategoryHidden}>
                <input type="hidden" name="id" value={category.id} />
                <button type="submit" className="text-blue-700 hover:underline">
                  {category.isHidden ? "Einblenden" : "Ausblenden"}
                </button>
              </form>
              <form action={setCategoryIcon} className="flex items-center gap-1">
                <input type="hidden" name="id" value={category.id} />
                <label className="cursor-pointer text-blue-700 hover:underline">
                  Icon
                  <input
                    type="file"
                    name="icon"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    className="hidden"
                  />
                </label>
                <button type="submit" className="text-slate-400 hover:text-blue-700" title="Icon speichern">
                  ↑
                </button>
                {category.iconKey && (
                  <button
                    type="submit"
                    name="removeIcon"
                    value="1"
                    className="text-slate-400 hover:text-red-600"
                    title="Icon entfernen"
                  >
                    ×
                  </button>
                )}
              </form>
            </li>
          ))}
          {categories.length === 0 && <li className="text-sm text-slate-400">Noch keine.</li>}
        </ul>
        <form action={createCategory} className="flex gap-2">
          <input name="name" required placeholder="Neue Kategorie" className="input max-w-xs" />
          <select name="productId" required className="input w-auto">
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-secondary shrink-0">
            Hinzufügen
          </button>
        </form>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder="Titel durchsuchen …" className="input w-72" />
        <select name="produkt" defaultValue={produkt ?? ""} className="input w-auto">
          <option value="">Alle Produkte</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select name="cat" defaultValue={cat ?? ""} className="input w-auto">
          <option value="">Alle Kategorien</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-secondary">
          Filtern
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-2">Titel</th>
              <th className="px-4 py-2">Kategorie</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Sichtbarkeit</th>
              <th className="px-4 py-2">Aktualisiert</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {articles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Keine Artikel gefunden.
                </td>
              </tr>
            )}
            {articles.map((article) => (
              <tr key={article.id} className="border-b border-slate-100 last:border-0">
                <td className="max-w-md px-4 py-2">
                  <Link
                    href={`/settings/kb/${article.id}`}
                    className={`font-medium hover:text-blue-700 ${article.status !== "published" ? "text-slate-400" : ""}`}
                  >
                    {article.title}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-600">{article.category?.name ?? "—"}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      article.status === "published"
                        ? "text-emerald-600"
                        : article.status === "draft"
                          ? "text-amber-600"
                          : "text-slate-400"
                    }
                  >
                    {STATUS_LABELS[article.status]}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-600">{VISIBILITY_LABELS[article.visibility]}</td>
                <td className="px-4 py-2 text-slate-500">{formatDateTime(article.updatedAt)}</td>
                <td className="px-4 py-2 text-right">
                  <form action={toggleArticleHidden}>
                    <input type="hidden" name="id" value={article.id} />
                    <button type="submit" className="text-xs text-blue-700 hover:underline">
                      {article.status === "published" ? "Ausblenden" : "Veröffentlichen"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          Seite {page} von {totalPages}
          {page > 1 && (
            <Link className="btn-secondary" href={{ query: { q, cat, produkt, page: page - 1 } }}>
              Zurück
            </Link>
          )}
          {page < totalPages && (
            <Link className="btn-secondary" href={{ query: { q, cat, produkt, page: page + 1 } }}>
              Weiter
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
