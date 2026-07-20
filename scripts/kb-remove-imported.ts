// Entfernt die per import-boldbi-docs.ts importierten DOKU-Artikel aus der
// Support-Wissensdatenbank (erkennbar am Hash-Suffix der Slugs) — die Doku
// lebt jetzt im eigenständigen Help-Portal (docker/build-help.sh).
// Manuell angelegte KB-Artikel bleiben unangetastet.
//
// Aufruf: npx tsx scripts/kb-remove-imported.ts [produkt-kürzel] [--ja]
import { db } from "../src/lib/db";

async function main() {
  const productKey = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
  const confirmed = process.argv.includes("--ja");

  const product = productKey
    ? await db.product.findUnique({ where: { key: productKey } })
    : ((await db.product.findFirst({ where: { isDefault: true } })) ?? undefined);
  if (!product) {
    console.error(productKey ? `Unbekanntes Produkt: ${productKey}` : "Kein Produkt gefunden");
    process.exit(1);
  }

  const imported = await db.kbArticle.findMany({
    where: { productId: product.id },
    select: { id: true, slug: true, title: true },
  });
  const targets = imported.filter((a) => /-[0-9a-f]{6}$/.test(a.slug));
  console.log(`Produkt ${product.name}: ${targets.length} importierte Doku-Artikel gefunden`);
  if (targets.length === 0) return;

  if (!confirmed) {
    for (const article of targets.slice(0, 5)) console.log(`  - ${article.title}`);
    if (targets.length > 5) console.log(`  … und ${targets.length - 5} weitere`);
    console.log("\nZum Löschen erneut mit --ja aufrufen.");
    return;
  }

  await db.kbArticle.deleteMany({ where: { id: { in: targets.map((a) => a.id) } } });
  const removedCats = await db.kbCategory.deleteMany({
    where: { productId: product.id, articles: { none: {} } },
  });
  console.log(`${targets.length} Artikel gelöscht, ${removedCats.count} leere Kategorien entfernt.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
