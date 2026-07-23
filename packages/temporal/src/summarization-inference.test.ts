import assert from "node:assert/strict";
import { test } from "node:test";
import { createDetailedRecord, createRecap } from "./record-pipeline.ts";
import { DETAILED_RECORD_SYSTEM, RECAP_SYSTEM } from "./prompts.ts";
import { loadSummarizationConfig } from "./summarization-inference.ts";

test("loads local summarization defaults from INFERENCE_URL", () => {
  const config = loadSummarizationConfig({}, "http://localhost:8080/");

  assert.deepEqual(config, {
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

  assert.equal(config.provider, "anthropic");
  assert.equal(config.apiKey, "secret");
  assert.equal(config.model, "claude-sonnet-5");
  assert.equal(config.reasoningEffort, "high");
});

test("requires a key and model for cloud summarization", () => {
  assert.throws(
    () => loadSummarizationConfig({ SUMMARIZATION_PROVIDER: "openai" }),
    /SUMMARIZATION_API_KEY/,
  );
  assert.throws(
    () =>
      loadSummarizationConfig({
        SUMMARIZATION_PROVIDER: "openai",
        SUMMARIZATION_API_KEY: "secret",
      }),
    /SUMMARIZATION_MODEL/,
  );
});

test("detailed record and recap each make one complete inference call", async () => {
  const calls: { prompt: string; system: string }[] = [];
  const complete = async (prompt: string, system: string): Promise<string> => {
    calls.push({ prompt, system });
    return calls.length === 1 ? "# Session\nDetailed record" : "# Recap\nShort recap";
  };

  const record = await createDetailedRecord("complete transcript", complete);
  const recap = await createRecap(record, complete);

  assert.equal(record, "Detailed record");
  assert.equal(recap, "Short recap");
  assert.deepEqual(calls, [
    { prompt: "complete transcript", system: DETAILED_RECORD_SYSTEM },
    { prompt: "Detailed record", system: RECAP_SYSTEM },
  ]);
});
