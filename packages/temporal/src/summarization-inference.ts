import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { SharedV4ProviderOptions as ProviderOptions } from "@ai-sdk/provider";
import { streamText, type LanguageModel } from "ai";

export type SummarizationProvider = "local" | "openai" | "anthropic";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface SummarizationConfig {
  provider: SummarizationProvider;
  apiKey?: string;
  baseURL?: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  thinkingBudget: number;
}

export interface SummarizationCompletion {
  content: string;
  provider: SummarizationProvider;
  model: string;
  finishReason: string;
  inputTokens?: number;
  outputTokens?: number;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function thinkingBudget(env: NodeJS.ProcessEnv): number {
  const value = optional(env, "SUMMARIZATION_THINKING_BUDGET");
  if (value === undefined) return 8192;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < -1) {
    throw new Error("SUMMARIZATION_THINKING_BUDGET must be -1, 0, or a positive integer");
  }
  return parsed;
}

function provider(env: NodeJS.ProcessEnv): SummarizationProvider {
  const value = optional(env, "SUMMARIZATION_PROVIDER") ?? "local";
  if (value !== "local" && value !== "openai" && value !== "anthropic") {
    throw new Error("SUMMARIZATION_PROVIDER must be local, openai, or anthropic");
  }
  return value;
}

function reasoningEffort(env: NodeJS.ProcessEnv): ReasoningEffort | undefined {
  const value = optional(env, "SUMMARIZATION_REASONING_EFFORT");
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
      "SUMMARIZATION_REASONING_EFFORT must be none, minimal, low, medium, high, xhigh, or max",
    );
  }
  return value;
}

export function loadSummarizationConfig(env: NodeJS.ProcessEnv): SummarizationConfig {
  const selectedProvider = provider(env);
  const apiKey = optional(env, "SUMMARIZATION_API_KEY");
  const configuredModel = optional(env, "SUMMARIZATION_MODEL");
  const configuredBaseURL = optional(env, "SUMMARIZATION_BASE_URL");
  const effort = reasoningEffort(env);

  if (selectedProvider !== "local" && !apiKey) {
    throw new Error(
      `SUMMARIZATION_API_KEY is required when SUMMARIZATION_PROVIDER=${selectedProvider}`,
    );
  }
  if (selectedProvider !== "local" && !configuredModel) {
    throw new Error(
      `SUMMARIZATION_MODEL is required when SUMMARIZATION_PROVIDER=${selectedProvider}`,
    );
  }
  if (selectedProvider === "local" && !configuredBaseURL) {
    throw new Error("SUMMARIZATION_BASE_URL is required when SUMMARIZATION_PROVIDER=local");
  }
  if (selectedProvider === "anthropic" && effort === "minimal") {
    throw new Error("Anthropic does not support SUMMARIZATION_REASONING_EFFORT=minimal");
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

function anthropicOptions(config: SummarizationConfig): ProviderOptions | undefined {
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

function openAIOptions(config: SummarizationConfig): ProviderOptions | undefined {
  return config.reasoningEffort
    ? { openai: { reasoningEffort: config.reasoningEffort } }
    : undefined;
}

function localOptions(config: SummarizationConfig): ProviderOptions {
  return {
    local: {
      thinking_budget_tokens: config.thinkingBudget,
      chat_template_kwargs: {
        enable_thinking: config.thinkingBudget !== 0,
      },
    },
  };
}

function modelAndOptions(config: SummarizationConfig): {
  model: LanguageModel;
  providerOptions?: ProviderOptions;
  temperature?: number;
} {
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
        includeUsage: true,
      });
      return {
        model: local(config.model),
        providerOptions: localOptions(config),
        temperature: 0.15,
      };
    }
  }
}

export function createSummarizationInference(config: SummarizationConfig) {
  const selected = modelAndOptions(config);

  return async function complete(
    prompt: string,
    system: string,
    abortSignal?: AbortSignal,
  ): Promise<SummarizationCompletion> {
    const result = streamText({
      model: selected.model,
      system,
      prompt,
      abortSignal,
      maxRetries: 0,
      providerOptions: selected.providerOptions,
      temperature: selected.temperature,
    });

    const [content, finishReason, usage] = await Promise.all([
      result.text,
      result.finishReason,
      result.usage,
    ]);

    return {
      content,
      provider: config.provider,
      model: config.model,
      finishReason,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  };
}
