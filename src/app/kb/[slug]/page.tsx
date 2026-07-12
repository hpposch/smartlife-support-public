import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";
import { renderMarkdown } from "@/lib/markdown";
import { getCurrentContact } from "@/lib/portal-session";
import { currentProduct, productAccent } from "@/lib/product";
import { rateLimit } from "@/lib/ratelimit";

/** Anonymes Feedback („War dieser Artikel hilfreich?“), gedrosselt pro IP+Artikel. */
async function submitFeedback(formData: FormData) {
  "use server";
  const articleId = String(formData.get("articleId"));
  const helpful = formData.get("helpful") === "1";
  const slug = String(formData.get("slug"));
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const { allowed } = await rateLimit("kb-feedback", `${ip}:${articleId}`, {
    max: 2,
    windowSeconds: 86_400,
  });
  if (allowed) {
    await db.kbFeedback.create({ data: { articleId, helpful } }).catch(() => {});
  }
  redirect(`/kb/${slug}?feedback=1`);
}

export default async function KbArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ feedback?: string }>;
}) {
  const { slug } = await params;
  const { feedback } = await searchParams;
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
        {feedback ? (
          <p className="text-slate-600">Vielen Dank für Ihr Feedback!</p>
        ) : (
          <form action={submitFeedback} className="flex items-center justify-center gap-3">
            <input type="hidden" name="articleId" value={article.id} />
            <input type="hidden" name="slug" value={article.slug} />
            <span className="text-slate-600">War dieser Artikel hilfreich?</span>
            <button type="submit" name="helpful" value="1" className="btn-secondary" title="Ja">
              👍 Ja
            </button>
            <button type="submit" name="helpful" value="0" className="btn-secondary" title="Nein">
              👎 Nein
            </button>
          </form>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-center text-sm shadow-sm">
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
