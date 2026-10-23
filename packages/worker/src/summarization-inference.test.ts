import { expect, test } from "vitest";
import type { RecapSections, SessionLedger } from "@rainbot/db";
import {
  createRecap,
  createSessionLedger,
  createWorldUpdate,
  type CompleteObject,
} from "./record-pipeline.ts";
import { RECAP_SYSTEM, SESSION_LEDGER_SYSTEM, WORLD_UPDATE_SYSTEM } from "./prompts.ts";
import { loadSummarizationConfig } from "./summarization-inference.ts";

test("loads a local summarization profile", () => {
  const config = loadSummarizationConfig({
    SUMMARIZATION_BASE_URL: "http://localhost:8080/v1/",
  });

  expect(config).toEqual({
    provider: "local",
    apiKey: undefined,
    baseURL: "http://localhost:8080/v1",
    model: "qwen3.6-35b-a3b",
    reasoningEffort: undefined,
    thinkingBudget: 8192,
  });
});

test("loads an Anthropic summarization profile", () => {
  const config = loadSummarizationConfig({
    SUMMARIZATION_PROVIDER: "anthropic",
    SUMMARIZATION_API_KEY: "secret",
    SUMMARIZATION_MODEL: "claude-sonnet-5",
    SUMMARIZATION_REASONING_EFFORT: "high",
  });

  expect(config.provider).toBe("anthropic");
  expect(config.apiKey).toBe("secret");
  expect(config.model).toBe("claude-sonnet-5");
  expect(config.reasoningEffort).toBe("high");
});

test("requires a key and model for cloud summarization", () => {
  expect(() => loadSummarizationConfig({ SUMMARIZATION_PROVIDER: "openai" })).toThrowError(
    /SUMMARIZATION_API_KEY/,
  );
  expect(() =>
    loadSummarizationConfig({
      SUMMARIZATION_PROVIDER: "openai",
      SUMMARIZATION_API_KEY: "secret",
    }),
  ).toThrowError(/SUMMARIZATION_MODEL/);
});

test("requires an explicit base URL for local summarization", () => {
  expect(() => loadSummarizationConfig({})).toThrowError(/SUMMARIZATION_BASE_URL/);
});

test("ledger and recap each make one structured call with the earlier session's notes", async () => {
  const calls: { prompt: string; system: string; name: string }[] = [];
  const ledger: SessionLedger = {
    events: [{ at: "0:01:00", summary: "The party reached Hollowmere." }],
    entities: [],
    loot: [],
    threads: [],
    quotes: [],
    rulings: [],
    uncertainties: [],
    leftOff: "At the cellar door.",
  };
  const sections: RecapSections = {
    recap: "# Recap\nThe party reached **Hollowmere**.",
    leftOff: "At the cellar door.",
    openThreads: [{ title: "The Missing Keeper", status: "open", note: "Untouched.", at: null }],
    loot: [],
    epicMoments: [1, 2, 3, 4].map((n) => ({
      description: `Moment ${n}`,
      quote: null,
      speaker: null,
      at: n === 1 ? "1:02" : null,
    })),
    newFaces: [],
    rulings: [],
  };
  const complete: CompleteObject = async <T>(
    prompt: string,
    system: string,
    _schema: unknown,
    name: string,
  ) => {
    calls.push({ prompt, system, name });
    return (name === "session_ledger" ? ledger : sections) as T;
  };
  const material = {
    transcript: "[0:00:00]\nAlice: hello",
    previous: {
      title: "The Salt Road",
      startedAt: new Date("2026-10-10T00:00:00Z"),
      recap: null,
      recapSections: {
        version: 1 as const,
        sections: { ...sections, epicMoments: [] },
        stats: { durationSeconds: 0, speakers: [] },
      },
    },
    world: [
      {
        id: "page-1",
        slug: "magister-venn",
        kind: "npc" as const,
        content: {
          version: 1 as const,
          name: "Magister Venn",
          aliases: ["Magistra Ven"],
          status: "alive",
          summary: "The former archivist of Hollowmere. He fled before the party arrived.",
          facts: [],
          holder: null,
          related: [],
        },
      },
    ],
    corrections: ["The Salt Road is a trade route, never a person."],
    quests: null,
  };

  expect(await createSessionLedger(material, complete)).toBe(ledger);
  const recap = await createRecap(material, ledger, complete);

  expect(calls.map((call) => [call.system, call.name])).toEqual([
    [SESSION_LEDGER_SYSTEM, "session_ledger"],
    [RECAP_SYSTEM, "session_recap"],
  ]);
  expect(calls[0].prompt).toContain("Unresolved threads:\n- The Missing Keeper: Untouched.");
  expect(calls[0].prompt).toContain(
    "- Magister Venn [npc] (also heard as Magistra Ven): The former archivist of Hollowmere.",
  );
  expect(calls[1].prompt).toContain('"leftOff": "At the cellar door."');
  for (const call of calls.slice(0, 2)) {
    expect(call.prompt).toContain("- The Salt Road is a trade route, never a person.");
  }
  expect(calls[1].prompt).toContain("Alice: hello");
  expect(recap.sections.recap).toBe("The party reached **Hollowmere**.");
  expect(recap.sections.epicMoments).toHaveLength(3);
  expect(recap.sections.epicMoments[0].at).toBe("0:01:02");
  expect(recap.markdown).toContain("## Where we left off\n\nAt the cellar door.");
  expect(recap.markdown).toContain("- **The Missing Keeper** (Still open): Untouched.");
});

test("open threads come from the world's quests once it has some", async () => {
  const prompts: string[] = [];
  const complete: CompleteObject = async <T>(prompt: string) => {
    prompts.push(prompt);
    return {} as T;
  };
  await createSessionLedger(
    {
      transcript: "Alice: hello",
      previous: {
        title: "The Salt Road",
        startedAt: new Date("2026-10-10T00:00:00Z"),
        recap: "They sailed.",
        recapSections: null,
      },
      world: [],
      corrections: [],
      quests: [
        {
          name: "Find the Keeper",
          aliases: ["The Missing Keeper"],
          summary: "The lighthouse keeper vanished. Nobody has seen him.",
          sessionsSinceChange: 0,
        },
        { name: "Lasting Strength damage", aliases: [], summary: "", sessionsSinceChange: 9 },
      ],
    },
    complete,
  );
  expect(prompts[0]).toContain(
    "Open quests:\n- Find the Keeper (also: The Missing Keeper): The lighthouse keeper vanished. (moved last session)",
  );
  expect(prompts[0]).toContain(
    "Dormant quests, untouched for 5 or more sessions:\n- Lasting Strength damage",
  );
  expect(prompts[0]).not.toContain("Unresolved threads:");
});

test("updates the world from the ledger and recap", async () => {
  let call: { prompt: string; system: string; name: string } | null = null;
  const complete: CompleteObject = async <T>(
    prompt: string,
    system: string,
    _schema: unknown,
    name: string,
  ) => {
    call = { prompt, system, name };
    return {
      pages: [
        {
          page: "magister-venn",
          name: "Magister Venn",
          kind: "npc",
          aliases: [],
          status: null,
          newFacts: [{ text: "Sold the lantern.", at: "2:31" }],
          supersededFacts: [],
          holder: null,
          related: [],
          summary: "The former archivist.",
        },
      ],
      possibleDuplicates: [],
      nameCorrections: [],
      epicMoments: [],
    } as T;
  };

  const update = await createWorldUpdate(
    {
      world: [
        {
          id: "page-1",
          slug: "magister-venn",
          kind: "npc",
          content: {
            version: 1,
            name: "Magister Venn",
            aliases: [],
            status: "alive",
            summary: "The former archivist.",
            facts: [
              { id: 1, text: "Kept the archive.", sessionId: "s1", at: null, supersededIn: null },
              { id: 2, text: "Drowned.", sessionId: "s1", at: null, supersededIn: "s2" },
            ],
            holder: null,
            related: [],
          },
        },
      ],
      corrections: ["Venn is a magister, not a magistra."],
      cast: [{ userId: "u1", username: "kit", characterName: "Ilsa" }],
      ledger: {
        events: [],
        entities: [],
        loot: [],
        threads: [],
        quotes: [],
        rulings: [],
        uncertainties: [],
        leftOff: "At the abbey.",
      },
      recap: {
        recap: "They sailed.",
        leftOff: "At the abbey.",
        openThreads: [],
        loot: [],
        epicMoments: [{ description: "Ilsa leapt.", quote: null, speaker: null, at: null }],
        newFaces: [],
        rulings: [],
      },
    },
    complete,
  );

  expect(call).not.toBeNull();
  const { prompt, system, name } = call!;
  expect([system, name]).toEqual([WORLD_UPDATE_SYSTEM, "world_update"]);
  expect(prompt).toContain("[magister-venn] Magister Venn (npc, alive)");
  expect(prompt).toContain("#1 Kept the archive.");
  expect(prompt).not.toContain("Drowned.");
  expect(prompt).toContain("- Ilsa, played by kit");
  expect(prompt).toContain("<corrections>\n- Venn is a magister, not a magistra.\n</corrections>");
  expect(prompt).toContain('"index": 0');
  expect(update.pages[0].newFacts[0].at).toBe("0:02:31");
});
