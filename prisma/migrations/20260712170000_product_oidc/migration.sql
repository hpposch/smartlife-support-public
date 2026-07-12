
-- AlterTable
ALTER TABLE "products" ADD COLUMN     "oidc_authority" TEXT,
ADD COLUMN     "oidc_client_id" TEXT,
ADD COLUMN     "oidc_secret_ref" TEXT;

