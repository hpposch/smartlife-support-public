-- Mehrprodukt-Betrieb: Tickets, Wissensdatenbank und Postfächer gehören zu
-- einem Produkt; das Portal wählt das Produkt über die aufgerufene Domain.
-- Bestandsdaten werden dem neu angelegten Default-Produkt zugeordnet.

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "portal_url" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "products_key_key" ON "products"("key");
CREATE UNIQUE INDEX "products_domain_key" ON "products"("domain");

-- Default-Produkt für alle Bestandsdaten
INSERT INTO "products" ("id", "key", "name", "is_default")
VALUES (gen_random_uuid(), 'smartlifebi', 'smartlife BI', true);

-- Spalten zunächst NULL-bar anlegen, Bestandsdaten zuordnen, dann NOT NULL
ALTER TABLE "tickets"       ADD COLUMN "product_id" TEXT;
ALTER TABLE "mailboxes"     ADD COLUMN "product_id" TEXT;
ALTER TABLE "kb_categories" ADD COLUMN "product_id" TEXT;
ALTER TABLE "kb_articles"   ADD COLUMN "product_id" TEXT;

UPDATE "tickets"       SET "product_id" = (SELECT "id" FROM "products" WHERE "is_default");
UPDATE "mailboxes"     SET "product_id" = (SELECT "id" FROM "products" WHERE "is_default");
UPDATE "kb_categories" SET "product_id" = (SELECT "id" FROM "products" WHERE "is_default");
UPDATE "kb_articles"   SET "product_id" = (SELECT "id" FROM "products" WHERE "is_default");

ALTER TABLE "tickets"       ALTER COLUMN "product_id" SET NOT NULL;
ALTER TABLE "mailboxes"     ALTER COLUMN "product_id" SET NOT NULL;
ALTER TABLE "kb_categories" ALTER COLUMN "product_id" SET NOT NULL;
ALTER TABLE "kb_articles"   ALTER COLUMN "product_id" SET NOT NULL;

-- KB-Slugs sind ab jetzt pro Produkt eindeutig (statt global)
DROP INDEX "kb_articles_slug_key";
DROP INDEX "kb_categories_slug_key";
CREATE UNIQUE INDEX "kb_articles_product_id_slug_key" ON "kb_articles"("product_id", "slug");
CREATE UNIQUE INDEX "kb_categories_product_id_slug_key" ON "kb_categories"("product_id", "slug");

CREATE INDEX "tickets_product_id_status_idx" ON "tickets"("product_id", "status");

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
