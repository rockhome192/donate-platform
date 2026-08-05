-- CreateEnum
CREATE TYPE "MockChargeStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED');

-- CreateTable
CREATE TABLE "MockCharge" (
    "providerRef" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "MockChargeStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockCharge_pkey" PRIMARY KEY ("providerRef")
);
