// Standalone harness to exercise the inference pipeline against a transcript,
// independent of Discord and the Postgres worker. It runs the same prompts and
// post-processing as the worker.
//
// Usage:
//   pnpm --filter @rainbot/worker eval:inference <transcript.txt> [previous-recap.md]
//
// The transcript is the text formatTranscriptForInference produces. An optional
// previous recap stands in for the earlier session's notes. Writes
// <transcript>.ledger.json / .recap.json / .recap.md / .title.txt /
// .world.json next to the input so outputs persist for comparing prompts or
// models across runs. The world update starts from an empty world.

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { FlexibleSchema } from "ai";
import { TITLE_SYSTEM } from "../prompts.ts";
import { normalizeTitle, stripCodeFence } from "../text.ts";
import {
  createRecap,
  createSessionLedger,
  createWorldUpdate,
  type SessionMaterial,
} from "../record-pipeline.ts";
import {
  createStructuredSummarizationInference,
  createSummarizationInference,
  loadSummarizationConfig,
  type SummarizationCompletion,
} from "../summarization-inference.ts";

const config = loadSummarizationConfig(process.env);
const providerComplete = createSummarizationInference(config);
const providerCompleteObject = createStructuredSummarizationInference(config);

const transcriptPath = process.argv[2];
const previousRecapPath = process.argv[3];
if (!transcriptPath) {
  console.error(
    "Usage: pnpm --filter @rainbot/worker eval:inference <transcript.txt> [previous-recap.md]",
  );
  process.exit(1);
}

type Usage = Omit<SummarizationCompletion, "content" | "provider">;

// Run one stage, printing timing/token/throughput stats alongside the output.
async function stage<T>(
  label: string,
  input: string,
  run: () => Promise<Usage & { result: T }>,
): Promise<T> {
  process.stdout.write(`\n→ ${label}… (${input.length.toLocaleString()} chars in)\n`);
  const start = performance.now();
  const data = await run();
  const secs = (performance.now() - start) / 1000;

  if (data.finishReason === "length") {
    throw new Error(
      "Inference output reached the provider or model output limit and was truncated",
    );
  }

  const stats = [`${secs.toFixed(1)}s`, data.model];
  if (data.inputTokens) stats.push(`${data.inputTokens} prompt tok`);
  if (data.outputTokens) {
    stats.push(`${data.outputTokens} out tok`);
    stats.push(`${(data.outputTokens / secs).toFixed(1)} tok/s`);
  }

  console.log(`${"═".repeat(70)}`);
  console.log(`${label.toUpperCase()}  (${stats.join(" · ")})`);
  console.log("═".repeat(70));
  console.log(typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2));
  return data.result;
}

function structured(label: string) {
  return <T>(prompt: string, system: string, schema: FlexibleSchema<T>, name: string) =>
    stage(label, prompt, async () => {
      const data = await providerCompleteObject(prompt, system, schema, name);
      return { ...data, result: data.object };
    });
}

try {
  const material: SessionMaterial = {
    transcript: readFileSync(transcriptPath, "utf8"),
    previous: previousRecapPath
      ? {
          title: null,
          startedAt: new Date(),
          recap: readFileSync(previousRecapPath, "utf8"),
          recapSections: null,
        }
      : null,
    world: [],
    corrections: [],
  };
  const base = transcriptPath.replace(/\.txt$/, "");

  const overall = performance.now();

  const ledger = await createSessionLedger(material, structured("Session ledger"));
  writeFileSync(`${base}.ledger.json`, JSON.stringify(ledger, null, 2), "utf8");

  const recap = await createRecap(material, ledger, structured("Recap"));
  writeFileSync(`${base}.recap.json`, JSON.stringify(recap.sections, null, 2), "utf8");
  writeFileSync(`${base}.recap.md`, recap.markdown, "utf8");

  const title = await stage("Title", recap.markdown, async () => {
    const data = await providerComplete(recap.markdown, TITLE_SYSTEM);
    return { ...data, result: normalizeTitle(stripCodeFence(data.content.trim())) };
  });
  writeFileSync(`${base}.title.txt`, title, "utf8");

  const world = await createWorldUpdate(
    { world: [], corrections: [], cast: [], ledger, recap: recap.sections },
    structured("World update"),
  );
  writeFileSync(`${base}.world.json`, JSON.stringify(world, null, 2), "utf8");

  console.log(
    `\nDone in ${((performance.now() - overall) / 1000).toFixed(1)}s. ` +
      `Wrote ${base}.ledger.json, ${base}.recap.json, ${base}.recap.md, ${base}.title.txt, ` +
      `${base}.world.json`,
  );
} catch (err) {
  console.error(`\nFailed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
