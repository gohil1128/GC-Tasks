-- Ideas: a Reddit-style page of opinions and ideas, threaded replies and
-- upvotes. Separate from the board: no task, label or revision row is touched.
--
-- An idea and all its replies share one table. A top-level idea has neither
-- parent nor root; a reply points at the post it answers (parentId) and at
-- the idea it sits under (rootId), so a thread is read in one query.
-- Deleting a post cascades to everything beneath it, but the service only
-- removes a post outright once nothing is left under it.

CREATE TABLE "Idea" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "rootId" TEXT,
    "authorId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdeaVote" (
    "ideaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdeaVote_pkey" PRIMARY KEY ("ideaId","userId")
);

CREATE INDEX "Idea_parentId_idx" ON "Idea"("parentId");

CREATE INDEX "Idea_rootId_idx" ON "Idea"("rootId");

CREATE INDEX "IdeaVote_userId_idx" ON "IdeaVote"("userId");

ALTER TABLE "Idea" ADD CONSTRAINT "Idea_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Idea" ADD CONSTRAINT "Idea_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Idea" ADD CONSTRAINT "Idea_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IdeaVote" ADD CONSTRAINT "IdeaVote_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IdeaVote" ADD CONSTRAINT "IdeaVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
