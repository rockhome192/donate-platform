-- Partial index for the /missed query, hand-written because Prisma's schema
-- language cannot express a WHERE clause on an index.
--
-- The query, run on EVERY overlay connect and reconnect:
--   SELECT * FROM "Donation"
--   WHERE "streamerId" = $1 AND status = 'PAID' AND "alertedAt" IS NULL;
--
-- Neither declared index helps: Donation_streamerId_createdAt_idx has no
-- status/alertedAt, and Donation_status_expiresAt_idx leads with the wrong
-- column. Without this, a flaky connection means a full scan of every donation
-- that streamer has ever received.
--
-- Partial rather than composite on purpose: a row leaves the index the moment
-- ack sets alertedAt, so this stays at roughly the number of un-shown alerts
-- (normally 0-5) no matter how large the table grows.

CREATE INDEX "Donation_pending_alert_idx"
  ON "Donation" ("streamerId")
  WHERE status = 'PAID' AND "alertedAt" IS NULL;
