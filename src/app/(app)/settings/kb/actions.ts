"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { slugify } from "@/lib/markdown";

const schema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  categoryId: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  visibility: z.enum(["public", "customers", "internal"]),
  productId: z.string().min(1),
});

// Slugs sind pro Produkt eindeutig
async function uniqueSlug(title: string, productId: string, existingId?: string): Promise<string> {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; ; i++) {
    const clash = await db.kbArticle.findUnique({
      where: { productId_slug: { productId, slug } },
    });
    if (!clash || clash.id === existingId) return slug;
    slug = `${base}-${i}`;
  }
}

export async function saveArticle(formData: FormData) {
  const admin = await requireAdmin();
  const input = schema.parse({
    id: formData.get("id") || undefined,
    title: formData.get("title"),
    body: formData.get("body"),
    categoryId: formData.get("categoryId") ?? "",
    status: formData.get("status"),
    visibility: formData.get("visibility"),
    productId: formData.get("productId"),
  });

  const data = {
    title: input.title,
    bodyMarkdown: input.body,
    categoryId: input.categoryId || null,
    status: input.status,
    visibility: input.visibility,
    productId: input.productId,
  };

  if (input.id) {
    const existing = await db.kbArticle.findUniqueOrThrow({ where: { id: input.id } });
    await db.kbArticle.update({
      where: { id: input.id },
      data: {
        ...data,
        slug: await uniqueSlug(input.title, input.productId, input.id),
        publishedAt:
          input.status === "published" && !existing.publishedAt
            ? new Date()
            : existing.publishedAt,
      },
    });
    redirect(`/settings/kb/${input.id}?saved=1`);
  } else {
    const article = await db.kbArticle.create({
      data: {
        ...data,
        slug: await uniqueSlug(input.title, input.productId),
        authorId: admin.id,
        publishedAt: input.status === "published" ? new Date() : null,
      },
    });
    redirect(`/settings/kb/${article.id}?saved=1`);
  }
}
