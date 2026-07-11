-- CreateEnum
CREATE TYPE "KbStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "KbVisibility" AS ENUM ('public', 'customers', 'internal');

-- CreateTable
CREATE TABLE "portal_login_tokens" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_login_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "kb_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" TEXT NOT NULL,
    "category_id" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "status" "KbStatus" NOT NULL DEFAULT 'draft',
    "visibility" "KbVisibility" NOT NULL DEFAULT 'public',
    "author_id" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_login_tokens_token_hash_key" ON "portal_login_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "portal_login_tokens_contact_id_idx" ON "portal_login_tokens"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "kb_categories_slug_key" ON "kb_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "kb_articles_slug_key" ON "kb_articles"("slug");

-- CreateIndex
CREATE INDEX "kb_articles_status_visibility_idx" ON "kb_articles"("status", "visibility");

-- AddForeignKey
ALTER TABLE "portal_login_tokens" ADD CONSTRAINT "portal_login_tokens_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "kb_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
