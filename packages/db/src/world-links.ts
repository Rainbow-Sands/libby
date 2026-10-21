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

interface NameMatcher {
  // Lowercased names grouped by their first word, longest first.
  byFirstWord: Map<string, { key: string; slug: string }[]>;
}

const WORD = /[\p{L}\p{N}]+/gu;
const FIRST_WORD = /^[\p{L}\p{N}]+/u;
const WORD_CHAR = /[\p{L}\p{N}]/uy;

// Pages link every piece of their text against the same targets, so the
// matcher is built once per targets array rather than once per piece.
const matchers = new WeakMap<LinkTarget[], NameMatcher | null>();

function cachedNameMatcher(targets: LinkTarget[]): NameMatcher | null {
  if (!matchers.has(targets)) matchers.set(targets, nameMatcher(targets));
  return matchers.get(targets) ?? null;
}

// Every name of the targets, with and without a leading article. Null when
// there is nothing long enough to match.
function nameMatcher(targets: LinkTarget[]): NameMatcher | null {
  const byFirstWord = new Map<string, { key: string; slug: string }[]>();
  const seen = new Set<string>();
  const names = targets
    .flatMap((target) =>
      target.names.flatMap((name) => {
        const trimmed = name.trim();
        const bare = trimmed.replace(/^(the|a|an)\s+/i, "");
        return [trimmed, bare].map((variant) => ({
          key: variant.toLowerCase(),
          slug: target.slug,
        }));
      }),
    )
    .filter((entry) => entry.key.length >= 3)
    .toSorted((a, b) => b.key.length - a.key.length);
  for (const entry of names) {
    const first = FIRST_WORD.exec(entry.key)?.[0];
    if (!first || seen.has(entry.key)) continue;
    seen.add(entry.key);
    const group = byFirstWord.get(first) ?? [];
    group.push(entry);
    byFirstWord.set(first, group);
  }
  return byFirstWord.size > 0 ? { byFirstWord } : null;
}

// Each name in the text, left to right, longest first at each word, ignoring
// case and requiring word boundaries, so "the Glass Abbess" beats "Glass"
// and "Venn" does not match inside "Vennish".
function* findNames(
  text: string,
  matcher: NameMatcher,
): Generator<{ index: number; text: string; slug: string }> {
  let next = 0;
  for (const word of text.matchAll(WORD)) {
    if (word.index < next) continue;
    const candidates = matcher.byFirstWord.get(word[0].toLowerCase());
    if (!candidates) continue;
    for (const candidate of candidates) {
      const end = word.index + candidate.key.length;
      if (text.slice(word.index, end).toLowerCase() !== candidate.key) continue;
      WORD_CHAR.lastIndex = end;
      if (WORD_CHAR.test(text)) continue;
      yield { index: word.index, text: text.slice(word.index, end), slug: candidate.slug };
      next = end;
      break;
    }
  }
}

// Splits text into plain runs and runs naming a page, linking the first
// mention of each page.
export function linkPageNames(
  text: string,
  targets: LinkTarget[],
  linked: Set<string> = new Set(),
): LinkedText {
  const matcher = text ? cachedNameMatcher(targets) : null;
  if (!matcher) return [{ text }];

  const result: LinkedText = [];
  let last = 0;
  for (const match of findNames(text, matcher)) {
    if (linked.has(match.slug)) continue;
    linked.add(match.slug);
    if (match.index > last) result.push({ text: text.slice(last, match.index) });
    result.push({ text: match.text, slug: match.slug });
    last = match.index + match.text.length;
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

// Every sentence of a markdown recap that mentions each page, in order and
// keyed by slug, with that page's mentions marked. Overlapping names go to
// the longest, so "the Hollowmere Archive" mentions the archive, not the town.
export function mentionsBySlug(
  markdown: string,
  targets: LinkTarget[],
): Map<string, MentionSentence[]> {
  const result = new Map<string, MentionSentence[]>();
  const matcher = markdown ? nameMatcher(targets) : null;
  if (!matcher) return result;
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

  for (const line of markdownLines(markdown)) {
    for (const { segment } of segmenter.segment(line)) {
      const sentence = segment.trim();
      const matches = [...findNames(sentence, matcher)];
      for (const slug of new Set(matches.map((match) => match.slug))) {
        const parts: MentionSentence = [];
        let last = 0;
        for (const match of matches) {
          if (match.slug !== slug) continue;
          if (match.index > last) {
            parts.push({ text: sentence.slice(last, match.index), mention: false });
          }
          parts.push({ text: match.text, mention: true });
          last = match.index + match.text.length;
        }
        if (last < sentence.length) parts.push({ text: sentence.slice(last), mention: false });
        const sentences = result.get(slug) ?? [];
        sentences.push(parts);
        result.set(slug, sentences);
      }
    }
  }
  return result;
}

// Every sentence of a markdown recap that mentions one of the names.
export function mentionSentences(markdown: string, names: string[]): MentionSentence[] {
  return mentionsBySlug(markdown, [{ slug: "page", names }]).get("page") ?? [];
}
