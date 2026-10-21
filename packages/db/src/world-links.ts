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

// Splits text into plain runs and runs naming a page, linking the first
// mention of each page. Longer names win, so "the Glass Abbess" beats
// "Glass". Matching ignores case and requires word boundaries.
export function linkPageNames(
  text: string,
  targets: LinkTarget[],
  linked: Set<string> = new Set(),
): LinkedText {
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
  if (names.length === 0 || !text) return [{ text }];

  const slugByName = new Map<string, string>();
  for (const entry of names) {
    const key = entry.name.toLowerCase();
    if (!slugByName.has(key)) slugByName.set(key, entry.slug);
  }
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${[...slugByName.keys()].map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );

  const result: LinkedText = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const slug = slugByName.get(match[0].toLowerCase());
    if (!slug || linked.has(slug)) continue;
    linked.add(slug);
    if (match.index > last) result.push({ text: text.slice(last, match.index) });
    result.push({ text: match[0], slug });
    last = match.index + match[0].length;
  }
  if (last < text.length) result.push({ text: text.slice(last) });
  return result;
}
