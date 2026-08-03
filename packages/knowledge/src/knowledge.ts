import type { DigitalOceanRagConfig, RagConfig } from "./config.ts";

export interface RetrievedKnowledgeChunk {
  content: string;
  metadata: Record<string, unknown>;
}

export interface CampaignKnowledgeQuery {
  artifactBucket: string;
  campaignId: string;
  query: string;
}

export interface KnowledgeService {
  retrieveCampaign(query: CampaignKnowledgeQuery): Promise<RetrievedKnowledgeChunk[]>;
  requestIndexing(): Promise<void>;
}

export interface SessionKnowledgeDocument {
  sessionId: string;
  title: string | null;
  startedAt: Date;
  detailedRecord: string;
}

export interface DigitalOceanKnowledgeServiceOptions {
  fetch?: typeof fetch;
  managementBaseUrl?: string;
  retrievalBaseUrl?: string;
  timeoutMilliseconds?: number;
}

function encodePathComponent(value: string): string {
  return encodeURIComponent(value);
}

export function campaignKnowledgeObjectPrefix(objectPrefix: string, campaignId: string): string {
  return `${objectPrefix}/campaigns/${encodePathComponent(campaignId)}/sessions`;
}

export function sessionKnowledgeObjectKey(
  objectPrefix: string,
  campaignId: string,
  sessionId: string,
): string {
  return `${campaignKnowledgeObjectPrefix(objectPrefix, campaignId)}/${encodePathComponent(sessionId)}.md`;
}

export function buildSessionKnowledgeDocument(session: SessionKnowledgeDocument): string {
  const title = session.title?.trim() || `Session ${session.sessionId}`;
  const parts = [
    `# ${title}`,
    "",
    `Session ID: ${session.sessionId}`,
    `Session date: ${session.startedAt.toISOString()}`,
  ];
  parts.push("", "## Detailed Record", "", session.detailedRecord.trim(), "");
  return parts.join("\n");
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.text()).slice(0, 1_000).trim();
  return new Error(
    `DigitalOcean Knowledge Base request failed (${response.status})${body ? `: ${body}` : ""}`,
  );
}

function parseRetrievalResponse(value: unknown): RetrievedKnowledgeChunk[] {
  if (!value || typeof value !== "object" || !("results" in value)) {
    throw new Error("DigitalOcean Knowledge Base returned an invalid retrieval response");
  }
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    throw new Error("DigitalOcean Knowledge Base returned an invalid retrieval result list");
  }

  return results.map((result) => {
    if (!result || typeof result !== "object") {
      throw new Error("DigitalOcean Knowledge Base returned an invalid retrieval result");
    }
    const candidate = result as { text_content?: unknown; metadata?: unknown };
    if (typeof candidate.text_content !== "string") {
      throw new Error("DigitalOcean Knowledge Base returned a result without text content");
    }
    return {
      content: candidate.text_content,
      metadata:
        candidate.metadata && typeof candidate.metadata === "object"
          ? (candidate.metadata as Record<string, unknown>)
          : {},
    };
  });
}

export class DigitalOceanKnowledgeService implements KnowledgeService {
  readonly #config: DigitalOceanRagConfig;
  readonly #fetch: typeof fetch;
  readonly #managementBaseUrl: string;
  readonly #retrievalBaseUrl: string;
  readonly #timeoutMilliseconds: number;

  constructor(config: DigitalOceanRagConfig, options: DigitalOceanKnowledgeServiceOptions = {}) {
    this.#config = config;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#managementBaseUrl = options.managementBaseUrl ?? "https://api.digitalocean.com";
    this.#retrievalBaseUrl = options.retrievalBaseUrl ?? "https://kbaas.do-ai.run";
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;
  }

  async retrieveCampaign({
    artifactBucket,
    campaignId,
    query,
  }: CampaignKnowledgeQuery): Promise<RetrievedKnowledgeChunk[]> {
    const response = await this.#fetch(
      `${this.#retrievalBaseUrl}/v1/${encodePathComponent(this.#config.knowledgeBaseId)}/retrieve`,
      {
        method: "POST",
        signal: AbortSignal.timeout(this.#timeoutMilliseconds),
        headers: {
          authorization: `Bearer ${this.#config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          num_results: this.#config.retrievalResults,
          alpha: this.#config.retrievalAlpha,
          filters: {
            wildcard: {
              key: "file_id",
              value: `${artifactBucket}/${campaignKnowledgeObjectPrefix(this.#config.objectPrefix, campaignId)}/*`,
            },
          },
        }),
      },
    );
    if (!response.ok) throw await responseError(response);
    return parseRetrievalResponse(await response.json());
  }

  async requestIndexing(): Promise<void> {
    const response = await this.#fetch(`${this.#managementBaseUrl}/v2/gen-ai/indexing_jobs`, {
      method: "POST",
      signal: AbortSignal.timeout(this.#timeoutMilliseconds),
      headers: {
        authorization: `Bearer ${this.#config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ knowledge_base_uuid: this.#config.knowledgeBaseId }),
    });
    if (!response.ok) throw await responseError(response);
  }
}

export function createKnowledgeService(
  config: RagConfig,
  options?: DigitalOceanKnowledgeServiceOptions,
): KnowledgeService | null {
  return config.provider === "digitalocean"
    ? new DigitalOceanKnowledgeService(config, options)
    : null;
}
