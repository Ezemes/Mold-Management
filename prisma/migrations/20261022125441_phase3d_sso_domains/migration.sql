-- AlterTable
ALTER TABLE "public"."SsoConnection" ADD COLUMN     "verifiedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "verifyToken" TEXT NOT NULL DEFAULT '';
