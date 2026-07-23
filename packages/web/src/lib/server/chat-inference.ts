import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { SharedV4ProviderOptions as ProviderOptions } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";

export type ChatProvider = "local" | "openai" | "anthropic";
export type ChatReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatInferenceConfig {
  provider: ChatProvider;
  apiKey?: string;
  baseURL?: string;
  model: string;
  reasoningEffort?: ChatReasoningEffort;
  thinkingBudget: number;
}

export interface ChatInference {
  model: LanguageModel;
  providerOptions?: ProviderOptions;
}

function optional(env: Record<string, string | undefined>, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function provider(env: Record<string, string | undefined>): ChatProvider {
  const value = optional(env, "CHAT_PROVIDER") ?? "local";
  if (value !== "local" && value !== "openai" && value !== "anthropic") {
    throw new Error("CHAT_PROVIDER must be local, openai, or anthropic");
  }
  return value;
}

function reasoningEffort(env: Record<string, string | undefined>): ChatReasoningEffort | undefined {
  const value = optional(env, "CHAT_REASONING_EFFORT");
  if (value === undefined) return undefined;

  if (
    value !== "none" &&
    value !== "minimal" &&
    value !== "low" &&
    value !== "medium" &&
    value !== "high" &&
    value !== "xhigh" &&
    value !== "max"
  ) {
    throw new Error(
      "CHAT_REASONING_EFFORT must be none, minimal, low, medium, high, xhigh, or max",
    );
  }
  return value;
}

function thinkingBudget(env: Record<string, string | undefined>): number {
  const value = optional(env, "CHAT_THINKING_BUDGET");
  if (value === undefined) return 2048;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < -1) {
    throw new Error("CHAT_THINKING_BUDGET must be -1, 0, or a positive integer");
  }
  return parsed;
}

export function loadChatInferenceConfig(
  env: Record<string, string | undefined>,
  validateRequired = true,
): ChatInferenceConfig {
  const selectedProvider = provider(env);
  const apiKey = optional(env, "CHAT_API_KEY");
  const configuredModel = optional(env, "CHAT_MODEL");
  const configuredBaseURL = optional(env, "CHAT_BASE_URL");
  const effort = reasoningEffort(env);

  if (validateRequired && selectedProvider !== "local" && !apiKey) {
    throw new Error(`CHAT_API_KEY is required when CHAT_PROVIDER=${selectedProvider}`);
  }
  if (validateRequired && selectedProvider !== "local" && !configuredModel) {
    throw new Error(`CHAT_MODEL is required when CHAT_PROVIDER=${selectedProvider}`);
  }
  if (validateRequired && selectedProvider === "local" && !configuredBaseURL) {
    throw new Error("CHAT_BASE_URL is required when CHAT_PROVIDER=local");
  }
  if (selectedProvider === "anthropic" && effort === "minimal") {
    throw new Error("Anthropic does not support CHAT_REASONING_EFFORT=minimal");
  }

  return {
    provider: selectedProvider,
    apiKey,
    baseURL: configuredBaseURL?.replace(/\/$/, ""),
    model: configuredModel ?? "qwen3.6-35b-a3b",
    reasoningEffort: effort,
    thinkingBudget: thinkingBudget(env),
  };
}

function anthropicOptions(config: ChatInferenceConfig): ProviderOptions | undefined {
  const effort = config.reasoningEffort;
  if (!effort) return undefined;
  if (effort === "none") {
    return { anthropic: { thinking: { type: "disabled" } } };
  }

  return {
    anthropic: {
      thinking: { type: "adaptive" },
      effort,
    },
  };
}

function openAIOptions(config: ChatInferenceConfig): ProviderOptions | undefined {
  return config.reasoningEffort
    ? { openai: { reasoningEffort: config.reasoningEffort } }
    : undefined;
}

function localOptions(config: ChatInferenceConfig): ProviderOptions {
  return {
    local: {
      thinking_budget_tokens: config.thinkingBudget,
      chat_template_kwargs: {
        enable_thinking: config.thinkingBudget !== 0,
      },
    },
  };
}

export function createChatInference(config: ChatInferenceConfig): ChatInference {
  switch (config.provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL });
      return { model: anthropic(config.model), providerOptions: anthropicOptions(config) };
    }
    case "openai": {
      const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
      return { model: openai(config.model), providerOptions: openAIOptions(config) };
    }
    case "local": {
      const local = createOpenAICompatible({
        name: "local",
        baseURL: config.baseURL!,
        apiKey: config.apiKey,
      });
      return { model: local(config.model), providerOptions: localOptions(config) };
    }
  }
}
