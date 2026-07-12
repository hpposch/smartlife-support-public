-- AlterTable
ALTER TABLE "kb_categories" ADD COLUMN     "icon_key" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "accent_color" TEXT,
ADD COLUMN     "logo_key" TEXT;
