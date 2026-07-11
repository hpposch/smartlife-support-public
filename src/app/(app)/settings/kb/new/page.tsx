import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { ArticleForm } from "../article-form";
import { saveArticle } from "../actions";

export default async function NewArticlePage() {
  await requireAdmin();
  const categories = await db.kbCategory.findMany({ orderBy: { sortOrder: "asc" } });
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-lg font-semibold">Neuer Artikel</h1>
      <ArticleForm categories={categories} action={saveArticle} />
    </div>
  );
}
