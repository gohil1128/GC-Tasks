-- Self sign-up by email. Additive: three new tables, plus one foreign key
-- to "User". Nothing existing is altered.
--
--   SignupRequest — a sign-up waiting for its emailed code. Only an HMAC of
--                   the code is stored; one row per address.
--   BoardSetting  — a single row (id = 1) of owner switches; today, whether
--                   sign-ups are open. No row reads as the defaults (open).
--   TeamEvent     — team happenings for the owners' bell ("joined"), which
--                   the task-bound Activity table cannot hold.

CREATE TABLE "SignupRequest" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignupRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignupRequest_email_key" ON "SignupRequest"("email");

CREATE TABLE "BoardSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "signupsOpen" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BoardSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamEvent_pkey" PRIMARY KEY ("id")
);

-- The bell reads the newest events, like Activity_createdAt_idx.
CREATE INDEX "TeamEvent_createdAt_idx" ON "TeamEvent"("createdAt");

ALTER TABLE "TeamEvent" ADD CONSTRAINT "TeamEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
