// Standalone harness to exercise the summarization pipeline against a
// transcript.txt, independent of Discord/Temporal. Runs the exact same prompts
// and post-processing as the real activities (imported from ../prompts.ts and
// ../text.ts), so what you see here is what the workflow would produce.
//
// Usage:
//   pnpm test:summarize <transcript.txt>          # loads provider settings from root .env
//
// Writes <transcript>.record.md / .recap.md / .title.txt next to the input so
// outputs persist for comparing prompts or models across runs.

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { TITLE_SYSTEM } from "../prompts.ts";
import { stripCodeFence, stripLeadingTitle, normalizeTitle } from "../text.ts";
import { createDetailedRecord, createRecap } from "../record-pipeline.ts";
import {
  createSummarizationInference,
  loadSummarizationConfig,
} from "../summarization-inference.ts";

const config = loadSummarizationConfig(process.env, process.env.INFERENCE_URL);
const providerComplete = createSummarizationInference(config);

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
  const data = await providerComplete(prompt, system);

  if (data.finishReason === "length") {
    throw new Error("Inference output reached SUMMARIZATION_MAX_TOKENS; increase it");
  }

  const content = stripCodeFence(data.content.trim());
  if (!content) throw new Error("Inference server returned an empty response");

  return {
    content,
    model: data.model,
    promptTokens: data.inputTokens,
    completionTokens: data.outputTokens,
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

  const record = await createDetailedRecord(
    transcript,
    async (prompt, system) => (await stage("Detailed record", system, prompt)).content,
  );
  writeFileSync(`${base}.record.md`, record, "utf8");

  const recap = await createRecap(
    record,
    async (prompt, system) => (await stage("Recap", system, prompt)).content,
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
