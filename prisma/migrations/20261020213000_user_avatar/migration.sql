-- The animal chai club: each person picks an illustrated animal avatar.
-- Nullable on purpose: "not picked yet" derives a stable animal from the
-- account id at render time, so existing accounts need no backfill.
ALTER TABLE "User" ADD COLUMN "avatar" TEXT;
