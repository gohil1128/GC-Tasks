-- Photos on ideas and replies. Additive: one new table with foreign keys to
-- "Idea" and "User". Photos are shrunk on the phone before upload (about
-- 1600px, JPEG), so each row holds a few hundred KB. A photo is uploaded
-- before its post exists, so "ideaId" stays null until the post is shared;
-- unattached uploads are cleaned up after a day.

CREATE TABLE "IdeaPhoto" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT,
    "uploaderId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdeaPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IdeaPhoto_ideaId_idx" ON "IdeaPhoto"("ideaId");
CREATE INDEX "IdeaPhoto_uploaderId_ideaId_idx" ON "IdeaPhoto"("uploaderId", "ideaId");

ALTER TABLE "IdeaPhoto" ADD CONSTRAINT "IdeaPhoto_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdeaPhoto" ADD CONSTRAINT "IdeaPhoto_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
