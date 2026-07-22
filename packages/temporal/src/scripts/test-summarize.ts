// Standalone harness to exercise the summarization pipeline against a
// transcript.txt, independent of Discord/Temporal. Runs the exact same prompts
// and post-processing as the real activities (imported from ../prompts.ts and
// ../text.ts), so what you see here is what the workflow would produce.
//
// Usage:
//   INFERENCE_URL=http://localhost:8080 node src/scripts/test-summarize.ts <transcript.txt>
//   pnpm test:summarize <transcript.txt>          # loads INFERENCE_URL from root .env
//
// Writes <transcript>.summary.md / .recap.md / .title.txt next to the input so
// outputs persist for comparing prompts or models across runs.

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { SUMMARIZE_SYSTEM, TITLE_SYSTEM, RECAP_SYSTEM } from "../prompts.ts";
import { stripCodeFence, stripLeadingTitle, normalizeTitle } from "../text.ts";

const INFERENCE_URL = process.env.INFERENCE_URL;
const SUMMARIZATION_MODEL = process.env.SUMMARIZATION_MODEL ?? "qwen3.6-35b-a3b";
const SUMMARIZATION_THINKING_BUDGET = process.env.SUMMARIZATION_THINKING_BUDGET ?? "8192";

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

async function complete(system: string, user: string): Promise<Completion> {
  const res = await fetch(`${INFERENCE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SUMMARIZATION_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        ],
        temperature: 0.7,
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
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    content: stripCodeFence((data.choices[0]?.message.content ?? "").trim()),
    model: data.model,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  };
}

// Run one stage, printing timing/token/throughput stats alongside the output.
async function stage(label: string, system: string, input: string): Promise<Completion> {
  process.stdout.write(`\n→ ${label}… (${input.length.toLocaleString()} chars in)\n`);
  const start = performance.now();
  const result = await complete(system, input);
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

  const summary = await stage("Summary", SUMMARIZE_SYSTEM, transcript);
  const summaryText = stripLeadingTitle(summary.content);
  writeFileSync(`${base}.summary.md`, summaryText, "utf8");

  const recap = await stage("Recap", RECAP_SYSTEM, summaryText);
  writeFileSync(`${base}.recap.md`, stripLeadingTitle(recap.content), "utf8");

  const titleResult = await stage("Title", TITLE_SYSTEM, summaryText);
  const title = normalizeTitle(titleResult.content);
  writeFileSync(`${base}.title.txt`, title, "utf8");

  console.log(
    `\nDone in ${((performance.now() - overall) / 1000).toFixed(1)}s. ` +
      `Wrote ${base}.summary.md, ${base}.recap.md, ${base}.title.txt`,
  );
} catch (err) {
  console.error(`\nFailed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
