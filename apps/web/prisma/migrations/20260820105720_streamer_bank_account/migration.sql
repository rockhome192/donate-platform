-- AlterTable
ALTER TABLE "Streamer" ADD COLUMN     "bankAccountLast4" VARCHAR(4),
ADD COLUMN     "bankAccountName" VARCHAR(120),
ADD COLUMN     "bankCode" VARCHAR(3);
