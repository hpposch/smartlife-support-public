
-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "custom_fields" JSONB;

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_product_id_key_key" ON "custom_fields"("product_id", "key");

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
