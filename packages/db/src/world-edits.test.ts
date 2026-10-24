import { expect, test } from "vitest";
import {
  planWorldEdit,
  previewWorldEdit,
  type EditPage,
  type EditWorld,
  type WorldEdit,
} from "./world-edits.ts";
import type { RecapSections } from "./session-notes.ts";
import { planWorldUpdate, type WorldPageContent } from "./world.ts";

function content(overrides: Partial<WorldPageContent>): WorldPageContent {
  return {
    version: 1,
    name: "Someone",
    aliases: [],
    references: [],
    status: null,
    summary: "",
    facts: [],
    holder: null,
    related: [],
    ...overrides,
  };
}

const wine: EditPage = {
  id: "p1",
  slug: "champagne-de-l-estompe",
  kind: "item",
  createdInSessionId: "s1",
  removed: false,
  mergedInto: null,
  revisions: [
    {
      sessionId: "s1",
      content: content({
        name: "Champagne de l'Estompe",
        aliases: ["Wizard of Wines"],
        facts: [
          {
            id: 1,
            text: "A bottle from the pantry.",
            sessionId: "s1",
            at: null,
            supersededIn: null,
          },
        ],
        holder: "Chief Janus",
      }),
    },
    {
      sessionId: "s5",
      content: content({
        name: "Wizard of Wines",
        aliases: ["Champagne de l'Estompe", "Wizard of Lines"],
        facts: [
          {
            id: 1,
            text: "A bottle from the pantry.",
            sessionId: "s1",
            at: null,
            supersededIn: null,
          },
          {
            id: 2,
            text: "The region's principal winery.",
            sessionId: "s5",
            at: null,
            supersededIn: null,
          },
        ],
        holder: "Chief Janus",
        related: ["kreshk"],
      }),
    },
  ],
};

const world: EditWorld = {
  pages: [wine],
  slugs: new Set(["champagne-de-l-estompe", "kreshk"]),
  sessionOrder: ["s1", "s2", "s3", "s4", "s5", "s6"],
  links: [
    {
      revisionId: "r9",
      pageSlug: "kreshk",
      pageName: "Kreshk",
      related: ["champagne-de-l-estompe"],
    },
  ],
};

test("splitting a page moves facts and names onto a new page from the session they appeared", () => {
  const edit: WorldEdit = {
    summary: "Separate the winery from the wine.",
    remember: "The Wizard of Wines is a winery, not the wine.",
    changes: [
      {
        op: "rename",
        page: "champagne-de-l-estompe",
        name: "Champagne de l'Estompe",
        keepOldName: false,
      },
      { op: "removeAlias", page: "champagne-de-l-estompe", alias: "Wizard of Wines" },
      {
        op: "split",
        page: "champagne-de-l-estompe",
        name: "Wizard of Wines",
        kind: "location",
        facts: [2],
        aliases: ["Wizard of Lines"],
        summary: "The region's principal winery.",
      },
    ],
  };
  const planned = planWorldEdit(world, edit.changes);
  expect(planned.errors).toEqual([]);

  const [kept, created] = planned.pages;
  expect(
    kept.revisions.map((r) => [r.content.name, r.content.aliases, r.content.facts.length]),
  ).toEqual([
    ["Champagne de l'Estompe", [], 1],
    ["Champagne de l'Estompe", [], 1],
  ]);
  expect(created).toMatchObject({
    id: null,
    slug: "wizard-of-wines",
    kind: "location",
    createdInSessionId: "s5",
  });
  expect(created.revisions[0].content).toMatchObject({
    name: "Wizard of Wines",
    aliases: ["Wizard of Lines"],
    facts: [{ id: 1, text: "The region's principal winery." }],
  });
  // The original world is left untouched for the preview's "before".
  expect(world.pages[0].revisions[1].content.name).toBe("Wizard of Wines");

  const preview = previewWorldEdit(world, edit, planned);
  expect(preview.pages.map((p) => [p.name, p.change, p.fromSessionId])).toEqual([
    ["Champagne de l'Estompe", "edited", "s1"],
    ["Wizard of Wines", "new", "s5"],
  ]);
  expect(preview.pages[0].rows.find((row) => row.label === "Name")).toEqual({
    label: "Name",
    removed: ["Wizard of Wines"],
    added: ["Champagne de l'Estompe"],
  });
  expect(preview.fromSessionId).toBe("s1");
  expect(preview.remember).toBe("The Wizard of Wines is a winery, not the wine.");
});

test("merging folds a duplicate's facts and names in and relinks other pages", () => {
  const duplicate: EditPage = {
    id: "p2",
    slug: "the-vintner",
    kind: "location",
    createdInSessionId: "s3",
    removed: false,
    mergedInto: null,
    revisions: [
      {
        sessionId: "s3",
        content: content({
          name: "The Vintner",
          facts: [
            { id: 1, text: "Run by the Martikovs.", sessionId: "s3", at: null, supersededIn: null },
          ],
          related: ["champagne-de-l-estompe"],
        }),
      },
    ],
  };
  const merging: EditWorld = {
    ...world,
    pages: [wine, duplicate],
    links: [
      {
        revisionId: "r9",
        pageSlug: "kreshk",
        pageName: "Kreshk",
        related: ["the-vintner", "abbey"],
      },
    ],
  };
  const planned = planWorldEdit(merging, [
    { op: "merge", page: "The Vintner", into: "champagne-de-l-estompe" },
  ]);
  expect(planned.errors).toEqual([]);
  const into = planned.pages.find((p) => p.slug === "champagne-de-l-estompe")!;
  expect(into.revisions.map((r) => r.sessionId)).toEqual(["s1", "s3", "s5"]);
  expect(into.revisions[1].content.facts.map((f) => [f.id, f.text])).toEqual([
    [1, "A bottle from the pantry."],
    [3, "Run by the Martikovs."],
  ]);
  expect(into.revisions[1].content.aliases).toContain("The Vintner");
  expect(into.revisions[1].content.related).toEqual([]);
  expect(planned.pages.find((p) => p.slug === "the-vintner")).toMatchObject({
    removed: true,
    mergedInto: "champagne-de-l-estompe",
  });
  expect(planned.links.get("r9")).toEqual(["champagne-de-l-estompe", "abbey"]);
});

test("changes that name a missing page or fact are reported instead of applied", () => {
  const planned = planWorldEdit(world, [
    { op: "editFact", page: "champagne-de-l-estompe", fact: 7, text: "x" },
    { op: "setStatus", page: "Nowhere", status: "gone" },
  ]);
  expect(planned.errors).toEqual([
    "Change 1 (editFact): Wizard of Wines has no fact #7.",
    'Change 2 (setStatus): no page is called "Nowhere".',
  ]);
});

test("status, holder and new facts only change the page as it stands now", () => {
  const planned = planWorldEdit(world, [
    { op: "setHolder", page: "Wizard of Wines", holder: "Ronan" },
    { op: "addFact", page: "Wizard of Wines", text: "Drunk at the feast." },
  ]);
  const [first, last] = planned.pages[0].revisions;
  expect(first.content.holder).toBe("Chief Janus");
  expect(last.content.holder).toBe("Ronan");
  expect(last.content.facts.at(-1)).toMatchObject({
    id: 3,
    text: "Drunk at the feast.",
    sessionId: "s5",
  });
});

test("naming a reference makes it a name, and removing one drops it", () => {
  const children: EditPage = {
    id: "p9",
    slug: "theodore-and-myrtle",
    kind: "npc",
    createdInSessionId: "s1",
    removed: false,
    mergedInto: null,
    revisions: [
      {
        sessionId: "s1",
        content: content({
          name: "Theodore and Myrtle",
          references: ["the children", "the twins"],
        }),
      },
    ],
  };
  const planned = planWorldEdit({ ...world, pages: [...world.pages, children] }, [
    { op: "addAlias", page: "theodore-and-myrtle", alias: "the twins" },
    { op: "removeAlias", page: "theodore-and-myrtle", alias: "the children" },
  ]);
  expect(planned.errors).toEqual([]);
  const after = planned.pages.find((p) => p.slug === "theodore-and-myrtle")!.revisions[0].content;
  expect(after.aliases).toEqual(["the twins"]);
  expect(after.references).toEqual([]);
});

test("a quest's status is one of the quest statuses", () => {
  const quest: EditPage = {
    ...wine,
    id: "q1",
    slug: "find-the-children",
    kind: "quest",
    revisions: [{ sessionId: "s1", content: content({ name: "Find the children" }) }],
  };
  const quests: EditWorld = { ...world, pages: [quest], links: [] };
  const set = (status: string) =>
    planWorldEdit(quests, [{ op: "setStatus", page: "find-the-children", status }]);

  expect(set("Resolved").pages[0].revisions[0].content.status).toBe("resolved");
  expect(set("completed").errors).toEqual([
    'Change 1 (setStatus): a quest\'s status is open or resolved, not "completed".',
  ]);
});

test("names and facts a person removed stay out of later sessions", () => {
  const edited = planWorldEdit(world, [
    { op: "removeAlias", page: "Wizard of Wines", alias: "Wizard of Lines" },
    { op: "removeFact", page: "Wizard of Wines", fact: 1 },
    { op: "editFact", page: "Wizard of Wines", fact: 2, text: "The valley's only winery." },
  ]);
  expect(edited.errors).toEqual([]);
  const page = edited.pages[0];
  const now = page.revisions.at(-1)!.content;
  expect(now.removed).toEqual({
    names: ["Wizard of Lines"],
    facts: ["A bottle from the pantry.", "The region's principal winery."],
  });

  const next = planWorldUpdate(
    [{ id: "p1", slug: page.slug, kind: page.kind, content: now }],
    {
      pages: [
        {
          page: page.slug,
          name: "Wizard of Lines",
          kind: "item",
          aliases: ["Wizard of Lines"],
          references: [],
          status: null,
          questStatus: null,
          newFacts: [
            { text: "a bottle from the pantry.", at: null },
            { text: "The region's principal winery.", at: null },
            { text: "Stolen by the druids.", at: null },
          ],
          supersededFacts: [],
          holder: null,
          holderGone: false,
          related: [],
          summary: "",
          openThreads: [],
          newFaces: [],
        },
      ],
      epicMoments: [],
      possibleDuplicates: [],
      nameCorrections: [],
    },
    "s6",
    { epicMoments: [], openThreads: [], newFaces: [] },
  ).pages[0].content;
  expect(next.name).toBe("Wizard of Wines");
  expect(next.aliases).toEqual(["Champagne de l'Estompe"]);
  expect(next.facts.map((fact) => fact.text)).toEqual([
    "The valley's only winery.",
    "Stolen by the druids.",
  ]);

  const restored = planWorldEdit(
    { ...world, pages: [{ ...page, revisions: [{ sessionId: "s5", content: now }] }] },
    [{ op: "addAlias", page: "Wizard of Wines", alias: "Wizard of Lines" }],
  );
  expect(restored.pages[0].revisions[0].content.removed?.names).toEqual([]);
});

function recap(sessionId: string, overrides: Partial<RecapSections>) {
  return {
    sessionId,
    sections: {
      recap: "",
      leftOff: "",
      openThreads: [],
      loot: [],
      epicMoments: [],
      newFaces: [],
      rulings: [],
      ...overrides,
    } satisfies RecapSections,
  };
}

test("a recap fix replaces the quoted words in one field", () => {
  const recaps = [
    recap("s2", {
      recap: "When the ghouls rushed the gate, Ismark struck down the first. Ismark then rested.",
      epicMoments: [
        { description: "Ismark fells the ghoul.", quote: null, speaker: null, at: null },
      ],
    }),
  ];
  const edit = (changes: WorldEdit["changes"]) => {
    const planned = planWorldEdit({ ...world, recaps }, changes);
    return {
      planned,
      preview: previewWorldEdit(world, { summary: "", remember: null, changes }, planned),
    };
  };

  const { planned, preview } = edit([
    {
      op: "editRecap",
      session: "2",
      field: "recap",
      find: "Ismark struck",
      replace: "Ireena struck",
    },
    { op: "editRecap", session: "s2", field: "epicMoments.0", find: "Ismark", replace: "Ireena" },
  ]);
  expect(planned.errors).toEqual([]);
  expect(planned.recaps[0].sections.recap).toBe(
    "When the ghouls rushed the gate, Ireena struck down the first. Ismark then rested.",
  );
  expect(planned.recaps[0].sections.epicMoments[0].description).toBe("Ireena fells the ghoul.");
  expect(recaps[0].sections.recap).toContain("Ismark struck");
  expect(preview.recaps).toEqual([
    {
      find: null,
      replace: null,
      sessionIds: ["s2"],
      rows: [
        {
          sessionId: "s2",
          field: "recap",
          label: "Recap",
          before: "When the ghouls rushed the gate, ",
          removed: "Ismark struck",
          added: "Ireena struck",
          after: " down the first. Ismark then rested.",
        },
        {
          sessionId: "s2",
          field: "epicMoments.0",
          label: "Epic moment",
          before: "",
          removed: "Ismark",
          added: "Ireena",
          after: " fells the ghoul.",
        },
      ],
    },
  ]);
  expect(preview.fromSessionId).toBe("s2");

  expect(
    edit([{ op: "editRecap", session: "s2", field: "recap", find: "Ismark", replace: "Ireena" }])
      .planned.errors,
  ).toEqual([
    'Change 1 (editRecap): "Ismark" appears 2 times in recap; quote more of the sentence.',
  ]);
  expect(
    edit([{ op: "editRecap", session: "s2", field: "loot.0", find: "x", replace: "y" }]).planned
      .errors,
  ).toEqual(['Change 1 (editRecap): the recap has no field "loot.0".']);
});

test("a name is replaced as whole words across every recap", () => {
  const recaps = [
    recap("s1", {
      recap: "Roosevelta, the burgomaster's wife, met Rooseveltan guards.",
      newFaces: [{ name: "Roosevelta", kind: "npc" }],
    }),
    recap("s3", {
      openThreads: [{ title: "Find Roosevelta's ring", status: "open", note: "", at: null }],
    }),
    recap("s4", { recap: "Nothing about her." }),
  ];
  const changes: WorldEdit["changes"] = [
    { op: "replaceInRecaps", find: "Roosevelta", replace: "Rosavalda" },
  ];
  const planned = planWorldEdit({ ...world, recaps }, changes);
  expect(planned.errors).toEqual([]);
  expect(planned.recaps.map((r) => r.sessionId)).toEqual(["s1", "s3"]);
  expect(planned.recaps[0].sections.recap).toBe(
    "Rosavalda, the burgomaster's wife, met Rooseveltan guards.",
  );
  expect(planned.recaps[1].sections.openThreads[0].title).toBe("Find Rosavalda's ring");
  const preview = previewWorldEdit(world, { summary: "", remember: null, changes }, planned);
  expect(preview.recaps).toHaveLength(1);
  expect(preview.recaps[0]).toMatchObject({
    find: "Roosevelta",
    replace: "Rosavalda",
    sessionIds: ["s1", "s3"],
  });
  expect(preview.recaps[0].rows.map((row) => row.field)).toEqual([
    "recap",
    "newFaces.0",
    "openThreads.0",
  ]);

  expect(
    planWorldEdit({ ...world, recaps }, [{ op: "replaceInRecaps", find: "Strahd", replace: "S" }])
      .errors,
  ).toEqual(['Change 1 (replaceInRecaps): no recap mentions "Strahd".']);
});
