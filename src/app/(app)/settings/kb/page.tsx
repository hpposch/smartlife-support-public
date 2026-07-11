import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";
import { slugify } from "@/lib/markdown";

const STATUS_LABELS = { draft: "Entwurf", published: "Veröffentlicht", archived: "Archiviert" };
const VISIBILITY_LABELS = { public: "Öffentlich", customers: "Nur Kunden", internal: "Intern" };

async function createCategory(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const max = await db.kbCategory.aggregate({ _max: { sortOrder: true } });
  await db.kbCategory.create({
    data: { name, slug: slugify(name), sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath("/settings/kb");
}

export default async function KbAdminPage() {
  await requireAdmin();
  const [articles, categories] = await Promise.all([
    db.kbArticle.findMany({
      include: { category: true, author: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.kbCategory.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Wissensdatenbank</h1>
        <Link href="/settings/kb/new" className="btn-primary">
          Neuer Artikel
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-2">Titel</th>
              <th className="px-4 py-2">Kategorie</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Sichtbarkeit</th>
              <th className="px-4 py-2">Aktualisiert</th>
            </tr>
          </thead>
          <tbody>
            {articles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Noch keine Artikel.
                </td>
              </tr>
            )}
            {articles.map((article) => (
              <tr key={article.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2">
                  <Link
                    href={`/settings/kb/${article.id}`}
                    className="font-medium hover:text-blue-700"
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Kategorien</h2>
        <ul className="mb-3 flex flex-wrap gap-2">
          {categories.map((cat) => (
            <li key={cat.id} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
              {cat.name}
            </li>
          ))}
          {categories.length === 0 && <li className="text-sm text-slate-400">Noch keine.</li>}
        </ul>
        <form action={createCategory} className="flex gap-2">
          <input name="name" required placeholder="Neue Kategorie" className="input max-w-xs" />
          <button type="submit" className="btn-secondary shrink-0">
            Hinzufügen
          </button>
        </form>
      </div>
    </div>
  );
}
