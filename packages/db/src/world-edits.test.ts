import { expect, test } from "vitest";
import {
  planWorldEdit,
  previewWorldEdit,
  type EditPage,
  type EditWorld,
  type WorldEdit,
} from "./world-edits.ts";
import type { WorldPageContent } from "./world.ts";

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
    'Change 1 (setStatus): a quest\'s status is open, resolved, abandoned, not "completed".',
  ]);
});
