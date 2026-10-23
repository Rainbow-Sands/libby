// Name matching and text linking for world pages. Kept free of database and
// schema imports so the web app's browser code can use it.

import type { RecapSections } from "./session-notes.ts";

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
  // Names grouped by their lowercased first word, longest first.
  byFirstWord: Map<string, { name: string; slug: string }[]>;
}

const WORD = /[\p{L}\p{N}]+/gu;
const FIRST_WORD = /^[\p{L}\p{N}]+/u;
const WORD_CHAR = /[\p{L}\p{N}]/uy;
const CAPITAL = /\p{Lu}/u;

// Pages link every piece of their text against the same targets, so the
// matcher is built once per targets array rather than once per piece.
const matchers = new WeakMap<LinkTarget[], NameMatcher | null>();

function cachedNameMatcher(targets: LinkTarget[]): NameMatcher | null {
  if (!matchers.has(targets)) matchers.set(targets, nameMatcher(targets));
  return matchers.get(targets) ?? null;
}

// The names text can safely be linked by without knowing what it means: each
// name with and without a leading article, only when it is capitalized like a
// proper name and no other target answers to it. "the children" and a
// "Burgomaster" two pages share never link. Null when nothing is left.
function nameMatcher(targets: LinkTarget[]): NameMatcher | null {
  const owners = new Map<string, Set<string>>();
  const names = targets.flatMap((target) =>
    target.names.flatMap((name) => {
      const trimmed = name.trim();
      const bare = trimmed.replace(/^(the|a|an)\s+/i, "");
      const key = nameKey(trimmed);
      if (key) owners.set(key, (owners.get(key) ?? new Set()).add(target.slug));
      if (bare.length < 3 || !CAPITAL.test(bare[0])) return [];
      return [...new Set([trimmed, bare])].map((variant) => ({
        name: variant,
        key,
        slug: target.slug,
      }));
    }),
  );
  const byFirstWord = new Map<string, { name: string; slug: string }[]>();
  const seen = new Set<string>();
  for (const entry of names.toSorted((a, b) => b.name.length - a.name.length)) {
    const first = FIRST_WORD.exec(entry.name)?.[0]?.toLowerCase();
    if (!first || seen.has(entry.name) || (owners.get(entry.key)?.size ?? 0) > 1) continue;
    seen.add(entry.name);
    const group = byFirstWord.get(first) ?? [];
    group.push({ name: entry.name, slug: entry.slug });
    byFirstWord.set(first, group);
  }
  return byFirstWord.size > 0 ? { byFirstWord } : null;
}

// Whether text has no word character just before start and just after end.
function wordBounded(text: string, start: number, end: number): boolean {
  if (start > 0) {
    WORD_CHAR.lastIndex = start - 1;
    if (WORD_CHAR.test(text)) return false;
  }
  WORD_CHAR.lastIndex = end;
  return !WORD_CHAR.test(text);
}

// Each name in the text, left to right, longest first at each word, matching
// case exactly and requiring word boundaries, so "the Glass Abbess" beats
// "Glass", "Venn" does not match inside "Vennish", and "Mother" does not match
// "her mother". An article before a name may be lowercase.
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
      const end = word.index + candidate.name.length;
      const found = text.slice(word.index, end);
      const article = /^(the|a|an)\s/i.exec(candidate.name)?.[0].length ?? 0;
      if (
        found.slice(0, article).toLowerCase() !== candidate.name.slice(0, article).toLowerCase() ||
        found.slice(article) !== candidate.name.slice(article) ||
        !wordBounded(text, word.index, end)
      ) {
        continue;
      }
      yield { index: word.index, text: found, slug: candidate.slug };
      next = end;
      break;
    }
  }
}

// Splits text into plain runs and runs naming a page, linking the first
// mention of each page. Used for page summaries and facts, which carry no
// links of their own, so it only trusts unambiguous proper names.
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

// ── Recap links ──────────────────────────────────────────────────────────────
// A recap is linked by the model that knows who each phrase means, after the
// world update, rather than by matching names: "Her children vanished" is not
// about the children who have a page. Each link names a field of the recap,
// the exact phrase, and which occurrence of that phrase in the field it is.

export interface RecapLink {
  field: string;
  phrase: string;
  // 1 for the first time the phrase appears in the field.
  occurrence: number;
  slug: string;
}

export interface RecapField {
  field: string;
  text: string;
}

// Every part of a recap that links to pages, in reading order. The recap
// itself is markdown; the rest is plain text.
export function recapLinkFields(sections: RecapSections): RecapField[] {
  return [
    { field: "recap", text: sections.recap },
    { field: "leftOff", text: sections.leftOff },
    ...sections.epicMoments.map((moment, i) => ({
      field: `epicMoments.${i}`,
      text: moment.description,
    })),
    ...sections.openThreads.map((thread, i) => ({ field: `openThreads.${i}`, text: thread.title })),
    ...sections.loot.flatMap((item, i) => [
      { field: `loot.${i}.item`, text: item.item },
      ...(item.holder ? [{ field: `loot.${i}.holder`, text: item.holder }] : []),
    ]),
    ...sections.newFaces.map((face, i) => ({ field: `newFaces.${i}`, text: face.name })),
  ].filter((entry) => entry.text.trim());
}

// Where each word-bounded occurrence of phrase starts in text, left to right.
function phraseIndexes(text: string, phrase: string): number[] {
  const indexes: number[] = [];
  if (!phrase) return indexes;
  for (let from = 0; ; ) {
    const index = text.indexOf(phrase, from);
    if (index < 0) return indexes;
    if (wordBounded(text, index, index + phrase.length)) {
      indexes.push(index);
      from = index + phrase.length;
    } else {
      from = index + 1;
    }
  }
}

// Where a link's phrase starts in its field, or -1 when the field does not
// hold that occurrence of it.
export function recapLinkIndex(text: string, phrase: string, occurrence: number): number {
  if (!phrase.trim() || occurrence < 1) return -1;
  return phraseIndexes(text, phrase)[occurrence - 1] ?? -1;
}

// Links one field of a recap, which the caller may hand over in several
// pieces (markdown splits bold text from the rest). Occurrences count across
// the pieces, so they match the field's whole text. When `linked` is given,
// only each page's first mention links, and the set records it.
export function recapFieldLinker(
  links: RecapLink[],
  linked: Set<string> | null = null,
): (text: string) => LinkedText {
  const counts = new Map<string, number>();
  return (text) => {
    const matches: { index: number; end: number; slug: string }[] = [];
    for (const phrase of new Set(links.map((link) => link.phrase))) {
      const before = counts.get(phrase) ?? 0;
      const indexes = phraseIndexes(text, phrase);
      counts.set(phrase, before + indexes.length);
      indexes.forEach((index, i) => {
        const link = links.find(
          (candidate) => candidate.phrase === phrase && candidate.occurrence === before + i + 1,
        );
        if (link) matches.push({ index, end: index + phrase.length, slug: link.slug });
      });
    }

    const result: LinkedText = [];
    let last = 0;
    for (const match of matches.toSorted((a, b) => a.index - b.index || b.end - a.end)) {
      if (match.index < last || linked?.has(match.slug)) continue;
      linked?.add(match.slug);
      if (match.index > last) result.push({ text: text.slice(last, match.index) });
      result.push({ text: text.slice(match.index, match.end), slug: match.slug });
      last = match.end;
    }
    if (last < text.length || result.length === 0) result.push({ text: text.slice(last) });
    return result;
  };
}

// A sentence that mentions a page, split so the mentions can be highlighted.
export type MentionSentence = { text: string; mention: boolean }[];

// Formatting a recap's markdown carries, which a quoted sentence drops.
function plain(text: string): string {
  return text.replace(/\*\*|__|[*`]/g, "");
}

// The sentence of each link's phrase, keyed by the link's index, with every
// phrase of that page in the sentence marked. Links to fields that only carry
// an earlier session's thread forward, and loot holders, have no sentence.
export function recapLinkSentences(
  sections: RecapSections,
  links: RecapLink[],
): (MentionSentence | null)[] {
  const fields = new Map(recapLinkFields(sections).map((entry) => [entry.field, entry.text]));
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const sentenceOf = (text: string, index: number) => {
    let offset = 0;
    for (const line of text.split("\n")) {
      if (index < offset + line.length + 1) {
        for (const { segment, index: start } of segmenter.segment(line)) {
          if (index - offset < start + segment.length) {
            return { start: offset + start, end: offset + start + segment.length };
          }
        }
      }
      offset += line.length + 1;
    }
    return { start: 0, end: text.length };
  };
  const sentenceField = (field: string) => {
    const thread = /^openThreads\.(\d+)$/.exec(field);
    if (thread) return sections.openThreads[Number(thread[1])]?.status !== "open";
    return !/^loot\.\d+\.holder$/.test(field);
  };

  return links.map((link) => {
    const text = fields.get(link.field);
    if (text === undefined || !sentenceField(link.field)) return null;
    const index = phraseIndexes(text, link.phrase)[link.occurrence - 1];
    if (index === undefined) return null;
    const sentence = sentenceOf(text, index);
    const marks = links
      .filter((other) => other.field === link.field && other.slug === link.slug)
      .map((other) => {
        const at = phraseIndexes(text, other.phrase)[other.occurrence - 1];
        return at === undefined ? null : { start: at, end: at + other.phrase.length };
      })
      .filter(
        (mark): mark is { start: number; end: number } =>
          mark !== null && mark.start >= sentence.start && mark.end <= sentence.end,
      )
      .toSorted((a, b) => a.start - b.start);
    const parts: MentionSentence = [];
    let last = sentence.start;
    for (const mark of marks) {
      if (mark.start < last) continue;
      if (mark.start > last) parts.push({ text: text.slice(last, mark.start), mention: false });
      parts.push({ text: text.slice(mark.start, mark.end), mention: true });
      last = mark.end;
    }
    if (last < sentence.end) parts.push({ text: text.slice(last, sentence.end), mention: false });
    const cleaned = parts
      .map((part) => ({ ...part, text: plain(part.text) }))
      .filter((part) => part.text);
    if (cleaned.length) {
      cleaned[0].text = cleaned[0].text.replace(/^\s*(?:[-+]|\d+[.)]|>)?\s*/, "");
      cleaned[cleaned.length - 1].text = cleaned.at(-1)!.text.trimEnd();
    }
    return cleaned.filter((part) => part.text);
  });
}
