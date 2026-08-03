import { describe, expect, it, vi } from "vitest";
import { loadRagConfig } from "./config.ts";
import {
  DigitalOceanKnowledgeService,
  buildSessionKnowledgeDocument,
  campaignKnowledgeObjectPrefix,
  sessionKnowledgeObjectKey,
} from "./knowledge.ts";

const config = {
  provider: "digitalocean" as const,
  apiKey: "secret",
  knowledgeBaseId: "knowledge-id",
  objectPrefix: "rag/development",
  retrievalAlpha: 0.6,
  retrievalResults: 12,
};

describe("RAG configuration", () => {
  it("is disabled by default", () => {
    expect(loadRagConfig({})).toEqual({ provider: "none" });
  });

  it("loads DigitalOcean defaults", () => {
    expect(
      loadRagConfig({
        RAG_PROVIDER: "digitalocean",
        RAG_API_KEY: "secret",
        RAG_KNOWLEDGE_BASE_ID: "knowledge-id",
      }),
    ).toEqual({
      ...config,
      objectPrefix: "rag",
    });
  });
});

describe("knowledge object keys", () => {
  it("uses a stable campaign and session path", () => {
    expect(campaignKnowledgeObjectPrefix("rag/dev", "campaign/one")).toBe(
      "rag/dev/campaigns/campaign%2Fone/sessions",
    );
    expect(sessionKnowledgeObjectKey("rag/dev", "campaign/one", "session two")).toBe(
      "rag/dev/campaigns/campaign%2Fone/sessions/session%20two.md",
    );
  });

  it("builds a self-identifying Markdown projection", () => {
    expect(
      buildSessionKnowledgeDocument({
        sessionId: "session-1",
        title: "The Amber Temple",
        startedAt: new Date("2026-07-22T01:00:00.000Z"),
        detailedRecord: "### Arrival\nThey opened the gate.",
      }),
    ).toContain(
      "# The Amber Temple\n\nSession ID: session-1\nSession date: 2026-07-22T01:00:00.000Z",
    );
  });
});

describe("DigitalOcean Knowledge Bases", () => {
  it("retrieves hybrid results restricted to the campaign prefix", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ text_content: "A recovered memory", metadata: { item_name: "session.md" } }],
          total_results: 1,
        }),
        { status: 200 },
      ),
    );
    const service = new DigitalOceanKnowledgeService(config, { fetch: fetchMock });

    await expect(
      service.retrieveCampaign({
        artifactBucket: "artifacts",
        campaignId: "campaign-id",
        query: "Where was the sword found?",
      }),
    ).resolves.toEqual([{ content: "A recovered memory", metadata: { item_name: "session.md" } }]);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "Where was the sword found?",
      num_results: 12,
      alpha: 0.6,
      filters: {
        wildcard: {
          key: "file_id",
          value: "artifacts/rag/development/campaigns/campaign-id/sessions/*",
        },
      },
    });
  });

  it("requests an indexing job for all configured data sources", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const service = new DigitalOceanKnowledgeService(config, { fetch: fetchMock });

    await service.requestIndexing();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.digitalocean.com/v2/gen-ai/indexing_jobs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ knowledge_base_uuid: "knowledge-id" }),
      }),
    );
  });
});
