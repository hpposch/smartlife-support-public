-- CreateTable
CREATE TABLE "kb_feedback" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_search_queries" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "results" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_search_queries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kb_feedback_article_id_idx" ON "kb_feedback"("article_id");

-- CreateIndex
CREATE INDEX "kb_search_queries_product_id_created_at_idx" ON "kb_search_queries"("product_id", "created_at");

-- AddForeignKey
ALTER TABLE "kb_feedback" ADD CONSTRAINT "kb_feedback_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "kb_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
