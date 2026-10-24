import { expect, test } from "vitest";
import {
  planWorldUpdate,
  slugify,
  type WorldPageState,
  type WorldRecap,
  type WorldUpdate,
} from "./world.ts";
import {
  recapFieldLinker,
  linkPageNames,
  recapLinkFields,
  recapLinkIndex,
  recapLinkSentences,
  summaryLine,
  type RecapLink,
} from "./world-links.ts";
import type { RecapSections } from "./session-notes.ts";

function entry(overrides: Partial<WorldUpdate["pages"][number]>): WorldUpdate["pages"][number] {
  return {
    page: null,
    name: "Someone",
    kind: "npc",
    aliases: [],
    references: [],
    status: null,
    questStatus: null,
    newFacts: [],
    supersededFacts: [],
    holder: null,
    holderGone: false,
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
    references: [],
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
      "Under Hollowmere, Venn's logbook named the Glass Abbess. Hollowmere slept.",
      targets,
    ),
  ).toEqual([
    { text: "Under " },
    { text: "Hollowmere", slug: "hollowmere" },
    { text: ", " },
    { text: "Venn", slug: "venn" },
    { text: "'s logbook named " },
    { text: "the Glass Abbess", slug: "glass-abbess" },
    { text: ". Hollowmere slept." },
  ]);
  expect(linkPageNames("Hollowmeres and Vennish", targets)).toEqual([
    { text: "Hollowmeres and Vennish" },
  ]);
});

test("only links proper names, matching their capitals, that one page owns", () => {
  const targets = [
    { slug: "children", names: ["Theodore and Myrtle", "the children"] },
    { slug: "mother", names: ["Mother"] },
    { slug: "vargas", names: ["Vargas", "the Burgomaster"] },
    { slug: "wachter", names: ["Lady Wachter", "the Burgomaster"] },
  ];
  expect(
    linkPageNames(
      "Her children vanished, her mother said, and the Burgomaster shrugged at Mother.",
      targets,
    ),
  ).toEqual([
    { text: "Her children vanished, her mother said, and the Burgomaster shrugged at " },
    { text: "Mother", slug: "mother" },
    { text: "." },
  ]);
});

test("linking can continue across several texts", () => {
  const targets = [{ slug: "venn", names: ["Venn"] }];
  const linked = new Set<string>();
  expect(linkPageNames("Venn left.", targets, linked)).toHaveLength(2);
  expect(linkPageNames("Venn returned.", targets, linked)).toEqual([{ text: "Venn returned." }]);
});

const sections: RecapSections = {
  recap: "Lady **Wachter** said her children vanished. The children, **Theodore** and Myrtle, hid.",
  leftOff: "The children wait at the mill.",
  openThreads: [
    { title: "Lasting Strength damage", status: "open", note: "Untouched.", at: null },
    { title: "Find the children", status: "new", note: "They hid.", at: null },
  ],
  loot: [{ item: "Silver key", holder: "Myrtle", note: "", at: null }],
  epicMoments: [],
  newFaces: [{ name: "Theodore and Myrtle", kind: "npc" }],
  rulings: [],
};

test("recap fields list every linkable part in reading order", () => {
  expect(recapLinkFields(sections).map((field) => field.field)).toEqual([
    "recap",
    "leftOff",
    "openThreads.0",
    "openThreads.1",
    "loot.0.item",
    "loot.0.holder",
    "newFaces.0",
  ]);
});

test("a link must name an occurrence the field really has", () => {
  expect(recapLinkIndex(sections.recap, "children", 1)).toBe(26);
  expect(recapLinkIndex(sections.recap, "children", 2)).toBe(49);
  expect(recapLinkIndex(sections.recap, "children", 3)).toBe(-1);
  expect(recapLinkIndex(sections.recap, "The children", 1)).toBe(45);
  expect(recapLinkIndex(sections.recap, "Wachter", 1)).toBe(7);
  expect(recapLinkIndex(sections.recap, "Theo", 1)).toBe(-1);
  expect(recapLinkIndex(sections.recap, "children", 0)).toBe(-1);
});

test("links only the occurrences the model chose, counting across pieces", () => {
  const links: RecapLink[] = [
    { field: "recap", phrase: "Theodore", occurrence: 1, slug: "children" },
    { field: "recap", phrase: "The children", occurrence: 1, slug: "children" },
  ];
  const link = recapFieldLinker(links, new Set());
  // Markdown hands bold text over separately.
  expect(link("Lady ")).toEqual([{ text: "Lady " }]);
  expect(link("Wachter")).toEqual([{ text: "Wachter" }]);
  expect(link(" said her children vanished. The children, ")).toEqual([
    { text: " said her children vanished. " },
    { text: "The children", slug: "children" },
    { text: ", " },
  ]);
  // The page is already linked, so its second mention stays plain.
  expect(link("Theodore")).toEqual([{ text: "Theodore" }]);

  const second = recapFieldLinker([
    { field: "recap", phrase: "children", occurrence: 2, slug: "children" },
  ]);
  expect(second("her children and the children")).toEqual([
    { text: "her children and the " },
    { text: "children", slug: "children" },
  ]);
});

test("mention sentences quote the sentence, drop formatting and skip carried threads", () => {
  const links: RecapLink[] = [
    { field: "recap", phrase: "The children", occurrence: 1, slug: "children" },
    { field: "recap", phrase: "Theodore", occurrence: 1, slug: "children" },
    { field: "recap", phrase: "Wachter", occurrence: 1, slug: "wachter" },
    { field: "openThreads.0", phrase: "Lasting Strength", occurrence: 1, slug: "strength" },
    { field: "openThreads.1", phrase: "the children", occurrence: 1, slug: "children" },
    { field: "loot.0.holder", phrase: "Myrtle", occurrence: 1, slug: "children" },
  ];
  const [children, theodore, wachter, carried, thread, holder] = recapLinkSentences(
    sections,
    links,
  );
  expect(children).toEqual([
    { text: "The children", mention: true },
    { text: ", ", mention: false },
    { text: "Theodore", mention: true },
    { text: " and Myrtle, hid.", mention: false },
  ]);
  expect(theodore).toEqual(children);
  expect(wachter).toEqual([
    { text: "Lady ", mention: false },
    { text: "Wachter", mention: true },
    { text: " said her children vanished.", mention: false },
  ]);
  expect(carried).toBeNull();
  expect(thread).toEqual([
    { text: "Find ", mention: false },
    { text: "the children", mention: true },
  ]);
  expect(holder).toBeNull();
});

test("references never match a page and never become names", () => {
  const children: WorldPageState = {
    ...venn,
    id: "p4",
    slug: "theodore-and-myrtle",
    content: {
      ...venn.content,
      name: "Theodore and Myrtle",
      aliases: [],
      references: ["the children"],
    },
  };
  const plan = planWorldUpdate(
    [children],
    {
      ...empty,
      pages: [
        entry({
          name: "the children",
          newFacts: [{ text: "Lady Wachter's children vanished.", at: null }],
        }),
        entry({
          page: "theodore-and-myrtle",
          name: "Theodore and Myrtle",
          aliases: ["the children", "Theo and Myrtle"],
          newFacts: [{ text: "Hid in the mill.", at: null }],
        }),
      ],
    },
    "s12",
    noRecap,
  );
  expect(
    plan.pages.map((page) => [page.slug, page.content.aliases, page.content.references]),
  ).toEqual([
    ["children", [], []],
    ["theodore-and-myrtle", ["Theo and Myrtle"], ["the children"]],
  ]);
  expect(plan.report.possibleDuplicates).toEqual([
    {
      first: "the children",
      second: "Theodore and Myrtle",
      reason: 'Theodore and Myrtle is also referred to as "the children".',
    },
  ]);
});

test("a name two pages share matches neither", () => {
  const captain = (slug: string, name: string): WorldPageState => ({
    ...venn,
    id: slug,
    slug,
    content: { ...venn.content, name, aliases: ["Captain"], references: [] },
  });
  const plan = planWorldUpdate(
    [captain("hale", "Captain Hale"), captain("morrow", "Captain Morrow")],
    {
      ...empty,
      pages: [entry({ name: "Captain", newFacts: [{ text: "Sank.", at: null }] })],
    },
    "s13",
    noRecap,
  );
  expect(plan.pages.map((page) => [page.slug, page.created])).toEqual([["captain", true]]);
});

test("recap threads become names of their quests, and new faces find their pages", () => {
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
    ["Madam Eva", []],
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

test("a quest takes its status from questStatus, and other pages from status", () => {
  const plan = planWorldUpdate(
    [],
    {
      ...empty,
      pages: [
        entry({
          name: "Find the children",
          kind: "quest",
          status: "completed",
          questStatus: "resolved",
        }),
        entry({ name: "Doru", status: "Undead", questStatus: "resolved" }),
      ],
    },
    "s5",
    noRecap,
  );
  expect(plan.pages.map((page) => page.content.status)).toEqual(["resolved", "undead"]);
});

test("an item's holder changes, stays when not given, and clears when nobody carries it", () => {
  const lantern: WorldPageState = {
    id: "p9",
    slug: "silver-lantern",
    kind: "item",
    content: {
      version: 1,
      name: "Silver lantern",
      aliases: [],
      references: [],
      status: null,
      summary: "",
      facts: [],
      holder: "Ismark",
      related: [],
    },
  };
  const holder = (overrides: Partial<WorldUpdate["pages"][number]>) =>
    planWorldUpdate(
      [lantern],
      {
        ...empty,
        pages: [
          entry({
            page: "silver-lantern",
            name: "Silver lantern",
            kind: "item",
            newFacts: [{ text: "Changed hands.", at: null }],
            ...overrides,
          }),
        ],
      },
      "s5",
      noRecap,
    ).pages[0].content.holder;

  expect(holder({ holder: "Ireena" })).toBe("Ireena");
  expect(holder({})).toBe("Ismark");
  expect(holder({ holderGone: true })).toBeNull();
});
