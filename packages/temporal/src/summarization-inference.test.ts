import { expect, test } from "vitest";
import { createDetailedRecord, createRecap } from "./record-pipeline.ts";
import { DETAILED_RECORD_SYSTEM, RECAP_SYSTEM } from "./prompts.ts";
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

test("detailed record and recap each make one complete inference call", async () => {
  const calls: { prompt: string; system: string }[] = [];
  const complete = async (prompt: string, system: string): Promise<string> => {
    calls.push({ prompt, system });
    return calls.length === 1 ? "# Session\nDetailed record" : "# Recap\nShort recap";
  };

  const record = await createDetailedRecord("complete transcript", complete);
  const recap = await createRecap(record, complete);

  expect(record).toBe("Detailed record");
  expect(recap).toBe("Short recap");
  expect(calls).toEqual([
    { prompt: "complete transcript", system: DETAILED_RECORD_SYSTEM },
    { prompt: "Detailed record", system: RECAP_SYSTEM },
  ]);
});
