"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/shell/brand-logo";

/*
  Anything a page throws that it did not expect — the database briefly out of
  reach is the usual one. Server Actions return their expected failures as
  values, so reaching this is genuinely unexpected; retrying often clears it.

  The digest is what the server logged the real error under, so somebody can
  find it without the message (which can carry internals) ever reaching here.
*/
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="w-full max-w-md rounded-bento border border-border bg-card p-8 text-center shadow-card">
        <BrandLogo className="mb-6" imgClassName="h-12" />
        <h1 className="display text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This page didn&apos;t load. Trying again usually sorts it out.
        </p>
        {error.digest && <p className="mt-3 text-2xs text-muted-foreground">Reference {error.digest}</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            {/* A full load on purpose, not a client navigation: whatever broke may live in the client's state. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/">Back to the board</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
