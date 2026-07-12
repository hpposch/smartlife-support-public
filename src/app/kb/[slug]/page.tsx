import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";
import { renderMarkdown } from "@/lib/markdown";
import { getCurrentContact } from "@/lib/portal-session";
import { currentProduct, productAccent } from "@/lib/product";

export default async function KbArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const contact = await getCurrentContact();
  const product = await currentProduct();
  const accent = productAccent(product);

  const article = await db.kbArticle.findUnique({
    where: { productId_slug: { productId: product.id, slug } },
    include: { category: true },
  });
  if (!article || article.status !== "published") notFound();
  if (article.category?.isHidden) notFound();
  if (article.visibility === "internal") notFound();
  if (article.visibility === "customers" && !contact) notFound();

  return (
    <article className="mx-auto max-w-2xl px-4 py-8">
      <p className="mb-2 text-xs text-slate-400">
        <Link href="/kb" className="hover:underline">
          Hilfe-Center
        </Link>
        {article.category && ` › ${article.category.name}`}
      </p>
      <h1 className="mb-2 text-2xl font-semibold">{article.title}</h1>
      <p className="mb-6 text-xs text-slate-400">
        Aktualisiert am {formatDateTime(article.updatedAt)}
      </p>
      <div
        className="kb-article"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(article.bodyMarkdown) }}
      />
      <div className="mt-10 rounded-lg border border-slate-200 bg-white p-4 text-center text-sm shadow-sm">
        <p className="text-slate-600">Hat dieser Artikel nicht geholfen?</p>
        <Link
          href={contact ? "/portal/new" : "/portal/login"}
          className="btn-primary mt-2"
          style={{ backgroundColor: accent }}
        >
          Anfrage an den Support stellen
        </Link>
      </div>
    </article>
  );
}
