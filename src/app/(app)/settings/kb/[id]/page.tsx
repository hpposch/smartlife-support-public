import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { ArticleForm } from "../article-form";
import { saveArticle } from "../actions";

export default async function EditArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved } = await searchParams;
  const [article, categories] = await Promise.all([
    db.kbArticle.findUnique({ where: { id } }),
    db.kbCategory.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  if (!article) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-lg font-semibold">Artikel bearbeiten</h1>
      {saved && (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Gespeichert.
        </p>
      )}
      <ArticleForm article={article} categories={categories} action={saveArticle} />
    </div>
  );
}
