import * as React from "react";
import { splitLinks } from "@/lib/linkify";

/**
  User text with its pasted URLs rendered as real links (see lib/linkify
  for what counts as a link). Plain React children throughout — the text
  itself is never treated as markup. Links open in a new tab: following
  one is a side trip away from the board, not a navigation.
*/
export function LinkifiedText({ text }: { text: string }) {
  const parts = splitLinks(text);
  return (
    <>
      {parts.map((part, i) =>
        part.href ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium break-all text-brand-ink underline decoration-brand-ink/40 underline-offset-2 hover:decoration-brand-ink"
          >
            {part.text}
          </a>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        ),
      )}
    </>
  );
}
