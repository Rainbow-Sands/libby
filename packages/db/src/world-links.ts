// Name matching and text linking for world pages. Kept free of database and
// schema imports so the web app's browser code can use it.

export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// The first sentence of a summary, for lists and hover cards.
export function summaryLine(summary: string): string {
  const match = /^.+?[.!?](?=\s|$)/.exec(summary.trim());
  return match ? match[0] : summary.trim();
}

export interface LinkTarget {
  slug: string;
  names: string[];
}

export type LinkedText = ({ text: string; slug?: undefined } | { text: string; slug: string })[];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One regex matching every name of the targets, longest first so "the Glass
// Abbess" beats "Glass", with word boundaries and no case. Null when there
// is nothing long enough to match.
function namePattern(
  targets: LinkTarget[],
): { pattern: RegExp; slugByName: Map<string, string> } | null {
  const names = targets
    .flatMap((target) =>
      target.names.flatMap((name) => {
        const trimmed = name.trim();
        const bare = trimmed.replace(/^(the|a|an)\s+/i, "");
        return [trimmed, bare].map((variant) => ({ name: variant, slug: target.slug }));
      }),
    )
    .filter((entry) => entry.name.length >= 3)
    .toSorted((a, b) => b.name.length - a.name.length);
  if (names.length === 0) return null;

  const slugByName = new Map<string, string>();
  for (const entry of names) {
    const key = entry.name.toLowerCase();
    if (!slugByName.has(key)) slugByName.set(key, entry.slug);
  }
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${[...slugByName.keys()].map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  return { pattern, slugByName };
}

// Splits text into plain runs and runs naming a page, linking the first
// mention of each page. Matching ignores case and requires word boundaries.
export function linkPageNames(
  text: string,
  targets: LinkTarget[],
  linked: Set<string> = new Set(),
): LinkedText {
  const matcher = text ? namePattern(targets) : null;
  if (!matcher) return [{ text }];

  const result: LinkedText = [];
  let last = 0;
  for (const match of text.matchAll(matcher.pattern)) {
    const slug = matcher.slugByName.get(match[0].toLowerCase());
    if (!slug || linked.has(slug)) continue;
    linked.add(slug);
    if (match.index > last) result.push({ text: text.slice(last, match.index) });
    result.push({ text: match[0], slug });
    last = match.index + match[0].length;
  }
  if (last < text.length) result.push({ text: text.slice(last) });
  return result;
}

// A sentence that mentions a page, split so the mentions can be highlighted.
export type MentionSentence = { text: string; mention: boolean }[];

// Markdown reduced to the plain text of each block: headings are dropped,
// since they name sections rather than mention anything.
function markdownLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/, "")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, "$2")
        .trim(),
    )
    .filter(Boolean);
}

// Every sentence of a markdown recap that mentions one of the names, in
// order, with each mention marked.
export function mentionSentences(markdown: string, names: string[]): MentionSentence[] {
  const matcher = namePattern([{ slug: "", names }]);
  if (!matcher || !markdown) return [];
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

  const result: MentionSentence[] = [];
  for (const line of markdownLines(markdown)) {
    for (const { segment } of segmenter.segment(line)) {
      const sentence = segment.trim();
      const parts: MentionSentence = [];
      let last = 0;
      for (const match of sentence.matchAll(matcher.pattern)) {
        if (match.index > last)
          parts.push({ text: sentence.slice(last, match.index), mention: false });
        parts.push({ text: match[0], mention: true });
        last = match.index + match[0].length;
      }
      if (parts.length === 0) continue;
      if (last < sentence.length) parts.push({ text: sentence.slice(last), mention: false });
      result.push(parts);
    }
  }
  return result;
}
