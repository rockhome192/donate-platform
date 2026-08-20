/*
  Warnings:

  - You are about to drop the column `promptPayType` on the `Streamer` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Streamer" DROP COLUMN "promptPayType";

-- DropEnum
DROP TYPE "PromptPayType";
