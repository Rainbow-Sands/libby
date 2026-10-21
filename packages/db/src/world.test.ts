import { expect, test } from "vitest";
import {
  planWorldUpdate,
  slugify,
  type WorldPageState,
  type WorldRecap,
  type WorldUpdate,
} from "./world.ts";
import { linkPageNames, mentionSentences, mentionsBySlug, summaryLine } from "./world-links.ts";

function entry(overrides: Partial<WorldUpdate["pages"][number]>): WorldUpdate["pages"][number] {
  return {
    page: null,
    name: "Someone",
    kind: "npc",
    aliases: [],
    status: null,
    newFacts: [],
    supersededFacts: [],
    holder: null,
    related: [],
    summary: "",
    openThreads: [],
    newFaces: [],
    ...overrides,
  };
}

const venn: WorldPageState = {
  id: "p1",
  slug: "magister-venn",
  kind: "npc",
  content: {
    version: 1,
    name: "Magister Venn",
    aliases: ["Magistra Ven"],
    status: "alive",
    summary: "The former archivist of Hollowmere.",
    facts: [
      {
        id: 1,
        text: "Kept the lower archive.",
        sessionId: "s2",
        at: "0:41:10",
        supersededIn: null,
      },
      { id: 2, text: "Thought to have drowned.", sessionId: "s4", at: null, supersededIn: null },
    ],
    holder: null,
    related: [],
  },
};

const noRecap: WorldRecap = { epicMoments: [], openThreads: [], newFaces: [] };

const empty: WorldUpdate = {
  pages: [],
  possibleDuplicates: [],
  nameCorrections: [],
  epicMoments: [],
};

test("slugs drop articles and punctuation", () => {
  expect(slugify("The Missing Keeper")).toBe("missing-keeper");
  expect(slugify("Ilsa d'Arrow")).toBe("ilsa-d-arrow");
  expect(slugify("!!!")).toBe("page");
  expect(slugify("Élodie of the Vale")).toBe("elodie-of-the-vale");
});

test("adds facts, supersedes old ones and keeps the input untouched", () => {
  const plan = planWorldUpdate(
    [venn],
    {
      ...empty,
      pages: [
        entry({
          page: "magister-venn",
          name: "Magister Venn",
          newFacts: [{ text: "Sent a letter signed V.", at: "0:55:48" }],
          supersededFacts: [2],
          summary: "The former archivist, alive on the Salt Road.",
        }),
      ],
    },
    "s5",
    noRecap,
  );

  expect(plan.pages).toHaveLength(1);
  const [page] = plan.pages;
  expect(page.created).toBe(false);
  expect(page.content.facts.map((fact) => [fact.id, fact.supersededIn])).toEqual([
    [1, null],
    [2, "s5"],
    [3, null],
  ]);
  expect(page.content.facts[2]).toMatchObject({ sessionId: "s5", at: "0:55:48" });
  expect(page.content.summary).toBe("The former archivist, alive on the Salt Road.");
  expect(venn.content.facts).toHaveLength(2);
});

test("resolves loose references through names and aliases instead of duplicating", () => {
  const plan = planWorldUpdate(
    [venn],
    {
      ...empty,
      pages: [
        entry({ name: "magistra ven", newFacts: [{ text: "Fled to the abbey.", at: null }] }),
      ],
    },
    "s5",
    noRecap,
  );
  expect(plan.pages.map((page) => page.slug)).toEqual(["magister-venn"]);
});

test("renames on a corrected spelling and keeps the old name as an alias", () => {
  const plan = planWorldUpdate(
    [venn],
    {
      ...empty,
      pages: [
        entry({
          page: "magister-venn",
          name: "Magister Venn the Elder",
          newFacts: [{ text: "Is older than he looks.", at: null }],
        }),
      ],
    },
    "s5",
    noRecap,
  );
  expect(plan.pages[0].content.name).toBe("Magister Venn the Elder");
  expect(plan.pages[0].content.aliases).toEqual(["Magister Venn", "Magistra Ven"]);
});

test("a page that only appeared writes no revision", () => {
  const plan = planWorldUpdate(
    [venn],
    {
      ...empty,
      pages: [entry({ page: "magister-venn", name: "The magister venn", summary: "Reworded." })],
    },
    "s5",
    noRecap,
  );
  expect(plan.pages).toEqual([]);
});

test("creates new pages with unique slugs and links related pages and moments", () => {
  const plan = planWorldUpdate(
    [venn],
    {
      pages: [
        entry({
          name: "The Glass Abbess",
          newFacts: [{ text: "Bought the lantern.", at: "2:31:40" }],
          related: ["Venn", "Magister Venn"],
          summary: "A buyer of stolen relics.",
        }),
        entry({
          name: "Magister-Venn",
          kind: "location",
          newFacts: [{ text: "A tower.", at: null }],
        }),
      ],
      possibleDuplicates: [{ first: "Magistra Ven", second: "Glass Abbess", reason: "Both fled." }],
      nameCorrections: [
        { heard: "Glass Abyss", canonical: "The Glass Abbess" },
        { heard: "The glass abbess", canonical: "The Glass Abbess" },
      ],
      epicMoments: [
        { moment: 0, pages: ["Glass Abbess", "Nobody"] },
        { moment: 5, pages: ["Magister Venn"] },
      ],
    },
    "s7",
    {
      ...noRecap,
      epicMoments: [
        { description: "The Abbess paid in gold.", quote: null, speaker: null, at: null },
      ],
    },
  );

  const abbess = plan.pages.find((page) => page.slug === "glass-abbess");
  expect(abbess).toMatchObject({ created: true, kind: "npc" });
  expect(abbess?.content.related).toEqual(["magister-venn"]);
  // The second entry's name collides with Venn's key, but a place is never a
  // person, so it gets its own page.
  expect(plan.pages.map((page) => page.slug).toSorted()).toEqual([
    "glass-abbess",
    "magister-venn-2",
  ]);
  expect(plan.moments).toEqual([
    {
      slug: "glass-abbess",
      position: 0,
      moment: { description: "The Abbess paid in gold.", quote: null, speaker: null, at: null },
    },
  ]);
  expect(plan.report.possibleDuplicates).toEqual([
    { first: "Magister Venn", second: "The Glass Abbess", reason: "Both fled." },
  ]);
  expect(plan.report.nameCorrections).toEqual([
    { heard: "Glass Abyss", canonical: "The Glass Abbess" },
  ]);
});

test("summary line takes the first sentence", () => {
  expect(summaryLine("Former archivist. Sold the lantern.")).toBe("Former archivist.");
  expect(summaryLine("No full stop")).toBe("No full stop");
});

test("links the first mention of each page, longest name first", () => {
  const targets = [
    { slug: "glass-abbess", names: ["The Glass Abbess"] },
    { slug: "hollowmere", names: ["Hollowmere"] },
    { slug: "venn", names: ["Magister Venn", "Venn"] },
  ];
  expect(
    linkPageNames(
      "Under Hollowmere, Venn's logbook named the glass abbess. Hollowmere slept.",
      targets,
    ),
  ).toEqual([
    { text: "Under " },
    { text: "Hollowmere", slug: "hollowmere" },
    { text: ", " },
    { text: "Venn", slug: "venn" },
    { text: "'s logbook named " },
    { text: "the glass abbess", slug: "glass-abbess" },
    { text: ". Hollowmere slept." },
  ]);
  expect(linkPageNames("Hollowmeres and Vennish", targets)).toEqual([
    { text: "Hollowmeres and Vennish" },
  ]);
});

test("linking can continue across several texts", () => {
  const targets = [{ slug: "venn", names: ["Venn"] }];
  const linked = new Set<string>();
  expect(linkPageNames("Venn left.", targets, linked)).toHaveLength(2);
  expect(linkPageNames("Venn returned.", targets, linked)).toEqual([{ text: "Venn returned." }]);
});

test("finds every recap sentence that mentions a page", () => {
  const recap = [
    "## Recap",
    "",
    "The party reached **Hollowmere** at dusk. Magistra Ven had already gone. Nobody slept.",
    "",
    "## Open threads",
    "",
    "- [Find Venn](https://example.test) before the tide turns.",
    "- Venn's desk was dry; Magister Venn kept the ledgers.",
  ].join("\n");
  expect(mentionSentences(recap, ["Magister Venn", "Venn", "Magistra Ven"])).toEqual([
    [
      { text: "Magistra Ven", mention: true },
      { text: " had already gone.", mention: false },
    ],
    [
      { text: "Find ", mention: false },
      { text: "Venn", mention: true },
      { text: " before the tide turns.", mention: false },
    ],
    [
      { text: "Venn", mention: true },
      { text: "'s desk was dry; ", mention: false },
      { text: "Magister Venn", mention: true },
      { text: " kept the ledgers.", mention: false },
    ],
  ]);
  expect(mentionSentences("## Venn\n\nNothing here.", ["Venn"])).toEqual([]);
  expect(mentionSentences("Venn left.", [])).toEqual([]);
});

test("finds mentions of every page at once, giving overlaps to the longest name", () => {
  const mentions = mentionsBySlug(
    "They searched the Hollowmere Archive. Hollowmere slept, as did Venn.",
    [
      { slug: "town", names: ["Hollowmere"] },
      { slug: "archive", names: ["Hollowmere Archive"] },
      { slug: "venn", names: ["Venn"] },
    ],
  );
  expect(mentions.get("archive")).toEqual([
    [
      { text: "They searched the ", mention: false },
      { text: "Hollowmere Archive", mention: true },
      { text: ".", mention: false },
    ],
  ]);
  expect(mentions.get("town")).toEqual([
    [
      { text: "Hollowmere", mention: true },
      { text: " slept, as did Venn.", mention: false },
    ],
  ]);
  expect(mentions.get("venn")?.[0]).toEqual([
    { text: "Hollowmere slept, as did ", mention: false },
    { text: "Venn", mention: true },
    { text: ".", mention: false },
  ]);
});

test("recap threads and new faces become names of the pages they belong to", () => {
  const plan = planWorldUpdate(
    [],
    {
      ...empty,
      pages: [
        entry({ name: "Missing gear and amnesia", kind: "quest", openThreads: [0, 5] }),
        entry({ name: "Madam Eva", newFaces: [0] }),
      ],
    },
    "s8",
    {
      epicMoments: [],
      openThreads: [
        { title: "Missing gear and Xerxes's memory gap", status: "new", note: "", at: null },
      ],
      newFaces: [{ name: "Madame Eva the seer", kind: "npc" }],
    },
  );

  expect(plan.pages.map((page) => [page.content.name, page.content.aliases])).toEqual([
    ["Missing gear and amnesia", ["Missing gear and Xerxes's memory gap"]],
    ["Madam Eva", ["Madame Eva the seer"]],
  ]);
});

test("a quest named after a character never takes over the character's page", () => {
  const xerxes: WorldPageState = {
    ...venn,
    id: "p2",
    slug: "xerxes",
    kind: "character",
    content: { ...venn.content, name: "Xerxes", aliases: ["Xerces"], status: "alive" },
  };
  const plan = planWorldUpdate(
    [xerxes],
    {
      ...empty,
      pages: [
        entry({
          page: "xerxes",
          name: "Xerxes's missing past",
          kind: "quest",
          aliases: ["Xerxes"],
          status: "open",
          openThreads: [0],
        }),
      ],
    },
    "s9",
    {
      ...noRecap,
      openThreads: [{ title: "Xerxes's memory gap", status: "new", note: "", at: null }],
    },
  );

  expect(
    plan.pages.map((page) => [page.slug, page.kind, page.content.name, page.content.aliases]),
  ).toEqual([["xerxes-s-missing-past", "quest", "Xerxes's missing past", ["Xerxes's memory gap"]]]);
});

test("a place never takes over an item that was named after it", () => {
  const wine: WorldPageState = {
    ...venn,
    id: "p3",
    slug: "champagne-de-l-estompe",
    kind: "item",
    content: { ...venn.content, name: "Champagne de l'Estompe", aliases: ["Wizard of Wines"] },
  };
  const plan = planWorldUpdate(
    [wine],
    {
      ...empty,
      pages: [
        entry({
          page: "champagne-de-l-estompe",
          name: "Wizard of Wines",
          kind: "location",
          newFacts: [{ text: "The region's principal winery.", at: null }],
        }),
      ],
    },
    "s10",
    noRecap,
  );

  expect(plan.pages.map((page) => [page.slug, page.kind, page.content.name])).toEqual([
    ["wizard-of-wines", "location", "Wizard of Wines"],
  ]);
});

test("an NPC who turns out to be a player character keeps their page", () => {
  const plan = planWorldUpdate(
    [venn],
    {
      ...empty,
      pages: [
        entry({
          page: "magister-venn",
          name: "Magister Venn",
          kind: "character",
          newFacts: [{ text: "Joined the party.", at: null }],
        }),
      ],
    },
    "s11",
    noRecap,
  );
  expect(plan.pages.map((page) => page.slug)).toEqual(["magister-venn"]);
});
