/*
  Splitting pasted text into plain runs and links, for descriptions and
  comments: somebody pastes a supplier URL or a Maps link and it should be
  tappable where it lands, not a string to copy by hand.

  Only http(s) and bare www. hosts linkify — never javascript:, data:, or
  a bare domain with no scheme, so a pasted "example.com" in prose stays
  prose. Trailing sentence punctuation is not part of the link ("see
  https://x.co/a." links the URL, keeps the full stop as text), and a
  closing bracket only joins the URL when it opened inside it.
*/

export type TextPart = { text: string; href?: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING_PUNCT = /[.,;:!?]+$/;

function cleanMatch(raw: string): { url: string; tail: string } {
  let url = raw;
  let tail = "";
  const punct = url.match(TRAILING_PUNCT);
  if (punct) {
    tail = punct[0] + tail;
    url = url.slice(0, -punct[0].length);
  }
  // A closer that never opened inside the URL belongs to the sentence
  // around it: "(see https://x.co/a)" — keep ")" as text. A balanced pair
  // from a Wikipedia-style URL stays whole.
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
  ] as const) {
    while (url.endsWith(close) && !url.slice(0, -1).includes(open)) {
      tail = close + tail;
      url = url.slice(0, -1);
    }
  }
  return { url, tail };
}

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const index = match.index ?? 0;
    const { url, tail } = cleanMatch(match[0]);
    if (!url) continue;
    if (index > last) parts.push({ text: text.slice(last, index) });
    parts.push({ text: url, href: url.startsWith("www.") ? `https://${url}` : url });
    if (tail) parts.push({ text: tail });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length > 0 ? parts : [{ text }];
}
