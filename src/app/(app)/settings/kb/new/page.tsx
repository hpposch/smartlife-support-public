import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { ArticleForm } from "../article-form";
import { saveArticle } from "../actions";

export default async function NewArticlePage() {
  await requireAdmin();
  const [categories, products] = await Promise.all([
    db.kbCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    db.product.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-lg font-semibold">Neuer Artikel</h1>
      <ArticleForm categories={categories} products={products} action={saveArticle} />
    </div>
  );
}
