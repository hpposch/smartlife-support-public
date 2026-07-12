// Vorbereitung für den Portal-UI-Test: legt einen KB-Artikel und einen
// gültigen Magic-Link-Token an und gibt die Login-URL aus.
// (Nur für lokale Tests — im Betrieb kommt der Link per E-Mail.)
import { db } from "../src/lib/db";
import { slugify } from "../src/lib/markdown";
import {
  generatePortalToken,
  hashPortalToken,
  portalTokenExpiry,
} from "../src/lib/portal-token";
import { findOrCreateContact } from "../src/server/contacts";

async function main() {
  const email = process.argv[2] ?? "portal-kunde@example.com";

  const product = await db.product.findFirstOrThrow({ where: { isDefault: true } });
  const category = await db.kbCategory.upsert({
    where: { productId_slug: { productId: product.id, slug: "erste-schritte" } },
    update: {},
    create: { name: "Erste Schritte", slug: "erste-schritte", sortOrder: 0, productId: product.id },
  });
  const title = "Passwort zurücksetzen";
  await db.kbArticle.upsert({
    where: { productId_slug: { productId: product.id, slug: slugify(title) } },
    update: { status: "published" },
    create: {
      title,
      slug: slugify(title),
      categoryId: category.id,
      productId: product.id,
      status: "published",
      visibility: "public",
      publishedAt: new Date(),
      bodyMarkdown: [
        "So setzen Sie Ihr Passwort zurück:",
        "",
        "1. Öffnen Sie die **Anmeldeseite**",
        "2. Klicken Sie auf *Passwort vergessen*",
        "3. Folgen Sie dem Link in der E-Mail",
        "",
        "> Tipp: Prüfen Sie auch den Spam-Ordner.",
      ].join("\n"),
    },
  });

  const contact = await findOrCreateContact(db, email, "Portal Kunde");
  const token = generatePortalToken();
  await db.portalLoginToken.create({
    data: {
      contactId: contact.id,
      tokenHash: hashPortalToken(token),
      expiresAt: portalTokenExpiry(),
    },
  });
  console.log(`http://localhost:3000/portal/auth/${token}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
