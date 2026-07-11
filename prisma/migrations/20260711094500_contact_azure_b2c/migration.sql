-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "azure_b2c_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "contacts_azure_b2c_id_key" ON "contacts"("azure_b2c_id");

