export interface DisabledRagConfig {
  provider: "none";
}

export interface DigitalOceanRagConfig {
  provider: "digitalocean";
  apiKey: string;
  knowledgeBaseId: string;
  objectPrefix: string;
  retrievalAlpha: number;
  retrievalResults: number;
}

export type RagConfig = DisabledRagConfig | DigitalOceanRagConfig;

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function numberInRange(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = source[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function integerInRange(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = numberInRange(source, name, fallback, minimum, maximum);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

export function normalizeRagObjectPrefix(value: string): string {
  const parts = value.trim().split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("RAG_OBJECT_PREFIX must be a non-empty S3 object-key prefix");
  }
  return parts.join("/");
}

export function loadRagConfig(source: NodeJS.ProcessEnv): RagConfig {
  const provider = source.RAG_PROVIDER?.trim().toLowerCase() || "none";
  if (provider === "none") return { provider };
  if (provider !== "digitalocean") {
    throw new Error("RAG_PROVIDER must be one of: none, digitalocean");
  }

  return {
    provider,
    apiKey: required(source, "RAG_API_KEY"),
    knowledgeBaseId: required(source, "RAG_KNOWLEDGE_BASE_ID"),
    objectPrefix: normalizeRagObjectPrefix(source.RAG_OBJECT_PREFIX || "rag"),
    retrievalAlpha: numberInRange(source, "RAG_RETRIEVAL_ALPHA", 0.6, 0, 1),
    retrievalResults: integerInRange(source, "RAG_RETRIEVAL_RESULTS", 12, 1, 100),
  };
}
