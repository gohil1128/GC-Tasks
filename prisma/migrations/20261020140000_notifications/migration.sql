-- Notifications: the bell's per-person read watermark, and one row per
-- browser/phone subscribed to Web Push for board changes.

ALTER TABLE "User" ADD COLUMN "notificationReadAt" TIMESTAMP(3);

-- Accounts that already exist are stamped with the migration moment, so
-- the whole history does not arrive as "unread" the day the bell ships.
-- Accounts created later keep NULL, which the feed reads as "unread back
-- to when this account was created".
UPDATE "User" SET "notificationReadAt" = CURRENT_TIMESTAMP;

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The bell's feed is the newest activity across every task.
CREATE INDEX "Activity_createdAt_idx" ON "Activity"("createdAt");
