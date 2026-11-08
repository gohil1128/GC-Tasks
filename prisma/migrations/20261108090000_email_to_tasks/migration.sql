-- Email to tasks. Additive: three new tables and one enum. Nothing existing
-- changes. The mailbox row is a singleton (id = 1); the ledger keeps a bare
-- Gmail id for every email read, so none is turned into a task twice.

-- CreateEnum
CREATE TYPE "MailMessageStatus" AS ENUM ('TASK', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "MailConnection" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "accountEmail" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "connectedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "statusNote" TEXT,
    "scannedThrough" TIMESTAMP(3) NOT NULL,
    "lastScanAt" TIMESTAMP(3),
    "nightlyDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "gmailId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL DEFAULT '',
    "status" "MailMessageStatus" NOT NULL,
    "reason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailScanRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "listed" INTEGER NOT NULL DEFAULT 0,
    "read" INTEGER NOT NULL DEFAULT 0,
    "tasks" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,

    CONSTRAINT "MailScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailMessage_accountEmail_threadId_idx" ON "MailMessage"("accountEmail", "threadId");

-- CreateIndex
CREATE INDEX "MailMessage_taskId_idx" ON "MailMessage"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "MailMessage_accountEmail_gmailId_key" ON "MailMessage"("accountEmail", "gmailId");

-- CreateIndex
CREATE INDEX "MailScanRun_startedAt_idx" ON "MailScanRun"("startedAt");

-- AddForeignKey
ALTER TABLE "MailConnection" ADD CONSTRAINT "MailConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

