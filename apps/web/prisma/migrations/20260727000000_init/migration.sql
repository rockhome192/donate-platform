-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STREAMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "DonationStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('OMISE', 'SLIP', 'MOCK');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('CLEAN', 'FLAGGED', 'HIDDEN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'STREAMER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Streamer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" VARCHAR(300),
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "minAmount" INTEGER NOT NULL DEFAULT 2000,
    "maxAmount" INTEGER NOT NULL DEFAULT 10000000,
    "overlayToken" TEXT NOT NULL,
    "tokenRotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Streamer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSetting" (
    "id" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "template" VARCHAR(120) NOT NULL DEFAULT '{name} โดเนท {amount} บาท',
    "durationMs" INTEGER NOT NULL DEFAULT 6000,
    "soundUrl" TEXT,
    "imageUrl" TEXT,
    "ttsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "minAlertAmount" INTEGER NOT NULL DEFAULT 2000,
    "profanityFilter" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AlertSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Donation" (
    "id" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "donorName" VARCHAR(40) NOT NULL,
    "message" VARCHAR(200) NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "status" "DonationStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentProvider" NOT NULL,
    "providerRef" TEXT,
    "slipTransRef" TEXT,
    "moderation" "ModerationStatus" NOT NULL DEFAULT 'CLEAN',
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SIMULATED',
    "note" TEXT NOT NULL DEFAULT 'DEMO — no real funds transferred',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Streamer_userId_key" ON "Streamer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Streamer_slug_key" ON "Streamer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Streamer_overlayToken_key" ON "Streamer"("overlayToken");

-- CreateIndex
CREATE UNIQUE INDEX "AlertSetting_streamerId_key" ON "AlertSetting"("streamerId");

-- CreateIndex
CREATE INDEX "Donation_streamerId_createdAt_idx" ON "Donation"("streamerId", "createdAt");

-- CreateIndex
CREATE INDEX "Donation_status_expiresAt_idx" ON "Donation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Donation_provider_providerRef_key" ON "Donation"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "Donation_slipTransRef_key" ON "Donation"("slipTransRef");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_receivedAt_idx" ON "WebhookEvent"("provider", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_attempts_idx" ON "WebhookEvent"("processedAt", "attempts");

-- AddForeignKey
ALTER TABLE "Streamer" ADD CONSTRAINT "Streamer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertSetting" ADD CONSTRAINT "AlertSetting_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

