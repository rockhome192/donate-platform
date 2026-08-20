-- CreateEnum
CREATE TYPE "PromptPayType" AS ENUM ('PHONE', 'NATIONAL_ID');

-- AlterTable
ALTER TABLE "Streamer" ADD COLUMN     "promptPayId" VARCHAR(20),
ADD COLUMN     "promptPayType" "PromptPayType";
