import { expect, test } from "vitest";
import type { RecapSections, SessionLedger } from "@rainbot/db";
import { createRecap, createSessionLedger, type CompleteObject } from "./record-pipeline.ts";
import { RECAP_SYSTEM, SESSION_LEDGER_SYSTEM } from "./prompts.ts";
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
  };

  expect(await createSessionLedger(material, complete)).toBe(ledger);
  const recap = await createRecap(material, ledger, complete);

  expect(calls.map((call) => [call.system, call.name])).toEqual([
    [SESSION_LEDGER_SYSTEM, "session_ledger"],
    [RECAP_SYSTEM, "session_recap"],
  ]);
  expect(calls[0].prompt).toContain("Unresolved threads:\n- The Missing Keeper: Untouched.");
  expect(calls[1].prompt).toContain('"leftOff": "At the cellar door."');
  expect(calls[1].prompt).toContain("Alice: hello");
  expect(recap.sections.recap).toBe("The party reached **Hollowmere**.");
  expect(recap.sections.epicMoments).toHaveLength(3);
  expect(recap.sections.epicMoments[0].at).toBe("0:01:02");
  expect(recap.markdown).toContain("## Where we left off\n\nAt the cellar door.");
  expect(recap.markdown).toContain("- **The Missing Keeper** (Still open): Untouched.");
});
