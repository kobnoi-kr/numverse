-- AlterTable
ALTER TABLE "user_cosmetics" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_cosmetics_expires_at_idx" ON "user_cosmetics"("expires_at");
