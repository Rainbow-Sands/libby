// Standalone harness to exercise the summarization pipeline against a
// transcript.txt, independent of Discord/Temporal. Runs the exact same prompts
// and post-processing as the real activities (imported from ../prompts.ts and
// ../text.ts), so what you see here is what the workflow would produce.
//
// Usage:
//   INFERENCE_URL=http://localhost:8080 node src/scripts/test-summarize.ts <transcript.txt>
//   pnpm test:summarize <transcript.txt>          # loads INFERENCE_URL from root .env
//
// Writes <transcript>.record.md / .recap.md / .title.txt next to the input so
// outputs persist for comparing prompts or models across runs.

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { TITLE_SYSTEM } from "../prompts.ts";
import { stripCodeFence, stripLeadingTitle, normalizeTitle } from "../text.ts";
import { createDetailedRecord, createRecap } from "../record-pipeline.ts";

const INFERENCE_URL = process.env.INFERENCE_URL;
const SUMMARIZATION_MODEL = process.env.SUMMARIZATION_MODEL ?? "qwen3.6-35b-a3b";
const SUMMARIZATION_THINKING_BUDGET = process.env.SUMMARIZATION_THINKING_BUDGET ?? "8192";
const SUMMARIZATION_MAX_TOKENS = Number(process.env.SUMMARIZATION_MAX_TOKENS ?? "16384");
const SUMMARIZATION_CHUNK_CHARS = Number(process.env.SUMMARIZATION_CHUNK_CHARS ?? "36000");

if (!INFERENCE_URL) {
  console.error("Missing required environment variable: INFERENCE_URL");
  process.exit(1);
}

const transcriptPath = process.argv[2];
if (!transcriptPath) {
  console.error("Usage: node src/scripts/test-summarize.ts <transcript.txt>");
  process.exit(1);
}

interface Completion {
  content: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}

async function complete(prompt: string, system: string): Promise<Completion> {
  const res = await fetch(`${INFERENCE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: SUMMARIZATION_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.15,
      max_tokens: SUMMARIZATION_MAX_TOKENS,
      thinking_budget_tokens: Number(SUMMARIZATION_THINKING_BUDGET),
      chat_template_kwargs: {
        enable_thinking: Number(SUMMARIZATION_THINKING_BUDGET) !== 0,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`llama-server returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    model?: string;
    choices: { finish_reason?: string; message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = data.choices[0];
  if (choice?.finish_reason === "length") {
    throw new Error(
      "Inference output reached SUMMARIZATION_MAX_TOKENS; increase it or reduce SUMMARIZATION_CHUNK_CHARS",
    );
  }

  const content = stripCodeFence((choice?.message.content ?? "").trim());
  if (!content) throw new Error("Inference server returned an empty response");

  return {
    content,
    model: data.model,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  };
}

// Run one stage, printing timing/token/throughput stats alongside the output.
async function stage(label: string, system: string, input: string): Promise<Completion> {
  process.stdout.write(`\n→ ${label}… (${input.length.toLocaleString()} chars in)\n`);
  const start = performance.now();
  const result = await complete(input, system);
  const secs = (performance.now() - start) / 1000;

  const stats = [`${secs.toFixed(1)}s`];
  if (result.model) stats.push(result.model);
  if (result.promptTokens) stats.push(`${result.promptTokens} prompt tok`);
  if (result.completionTokens) {
    stats.push(`${result.completionTokens} out tok`);
    stats.push(`${(result.completionTokens / secs).toFixed(1)} tok/s`);
  }

  console.log(`${"═".repeat(70)}`);
  console.log(`${label.toUpperCase()}  (${stats.join(" · ")})`);
  console.log("═".repeat(70));
  console.log(result.content);
  return result;
}

try {
  const transcript = readFileSync(transcriptPath, "utf8");
  const base = transcriptPath.replace(/\.txt$/, "");

  const overall = performance.now();

  let recordPass = 0;
  const record = await createDetailedRecord(
    transcript,
    SUMMARIZATION_CHUNK_CHARS,
    async (prompt, system) =>
      (await stage(`Detailed record pass ${++recordPass}`, system, prompt)).content,
  );
  writeFileSync(`${base}.record.md`, record, "utf8");

  let recapPass = 0;
  const recap = await createRecap(
    record,
    SUMMARIZATION_CHUNK_CHARS,
    async (prompt, system) => (await stage(`Recap pass ${++recapPass}`, system, prompt)).content,
  );
  writeFileSync(`${base}.recap.md`, stripLeadingTitle(recap), "utf8");

  const titleResult = await stage("Title", TITLE_SYSTEM, recap);
  const title = normalizeTitle(titleResult.content);
  writeFileSync(`${base}.title.txt`, title, "utf8");

  console.log(
    `\nDone in ${((performance.now() - overall) / 1000).toFixed(1)}s. ` +
      `Wrote ${base}.record.md, ${base}.recap.md, ${base}.title.txt`,
  );
} catch (err) {
  console.error(`\nFailed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
