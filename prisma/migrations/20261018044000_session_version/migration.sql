-- Sessions issued before a password reset, password change or deactivation
-- stop working once this number moves on.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
