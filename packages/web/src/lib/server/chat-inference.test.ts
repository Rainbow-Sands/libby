import assert from "node:assert/strict";
import { test } from "node:test";
import { createChatInference, loadChatInferenceConfig } from "./chat-inference.ts";

test("loads a local chat profile", () => {
  const config = loadChatInferenceConfig({ CHAT_BASE_URL: "http://localhost:8080/v1/" });

  assert.deepEqual(config, {
    provider: "local",
    apiKey: undefined,
    baseURL: "http://localhost:8080/v1",
    model: "qwen3.6-35b-a3b",
    reasoningEffort: undefined,
    thinkingBudget: 2048,
  });

  const inference = createChatInference(config);
  assert.deepEqual(inference.providerOptions, {
    local: {
      thinking_budget_tokens: 2048,
      chat_template_kwargs: { enable_thinking: true },
    },
  });
});

test("loads an Anthropic chat profile independently", () => {
  const config = loadChatInferenceConfig({
    CHAT_PROVIDER: "anthropic",
    CHAT_API_KEY: "secret",
    CHAT_MODEL: "claude-haiku-4-5",
    CHAT_REASONING_EFFORT: "low",
  });
  const inference = createChatInference(config);

  assert.equal(config.model, "claude-haiku-4-5");
  assert.deepEqual(inference.providerOptions, {
    anthropic: {
      thinking: { type: "adaptive" },
      effort: "low",
    },
  });
});

test("requires a key and model for cloud chat", () => {
  assert.throws(() => loadChatInferenceConfig({ CHAT_PROVIDER: "openai" }), /CHAT_API_KEY/);
  assert.throws(
    () =>
      loadChatInferenceConfig({
        CHAT_PROVIDER: "openai",
        CHAT_API_KEY: "secret",
      }),
    /CHAT_MODEL/,
  );
});

test("requires an explicit base URL for local chat", () => {
  assert.throws(() => loadChatInferenceConfig({}), /CHAT_BASE_URL/);
});
