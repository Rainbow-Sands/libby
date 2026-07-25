import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { APICallError } from "ai";
import { UnrecoverableError } from "bullmq";
import type { SegmentRef } from "./types.ts";
import { SUMMARIZATION_CONFIG, TRANSCRIPTION_MODEL, TRANSCRIPTION_URL } from "./env.ts";
import { TITLE_SYSTEM } from "./prompts.ts";
import { stripCodeFence, normalizeTitle } from "./text.ts";
import { createDetailedRecord, createRecap } from "./record-pipeline.ts";
import { createSummarizationInference } from "./summarization-inference.ts";
import {
  formatTranscriptForInference,
  getCampaignCast,
  type Transcript,
  type TranscriptSegment,
} from "@rainbot/db";

interface WhisperResponse {
  text: string;
  segments: { no_speech_prob: number }[];
}

const NO_SPEECH_THRESHOLD = 0.6;
const completeSummarization = createSummarizationInference(SUMMARIZATION_CONFIG);

function audioMimeType(audioPath: string): string {
  switch (path.extname(audioPath).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".webm":
      return "audio/webm";
    case ".flac":
      return "audio/flac";
    default:
      return "audio/ogg";
  }
}

// ── Transcription ─────────────────────────────────────────────────────────────

export async function transcribeSegment(
  sessionDir: string,
  ref: SegmentRef,
): Promise<TranscriptSegment | null> {
  const audioPath = path.join(sessionDir, ref.audioFile);
  if (!existsSync(audioPath)) {
    throw new UnrecoverableError(`Audio file not found: ${ref.audioFile}`);
  }
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(readFileSync(audioPath))], {
      type: audioMimeType(audioPath),
    }),
    path.basename(audioPath),
  );
  form.append("response_format", "verbose_json");
  form.append("model", TRANSCRIPTION_MODEL);

  const res = await fetch(TRANSCRIPTION_URL, {
    method: "POST",
    body: form,
  });

  if (res.status >= 400 && res.status < 500) {
    throw new UnrecoverableError(`Whisper rejected the request: ${res.status}`);
  }
  if (!res.ok) throw new Error(`Whisper server returned ${res.status}`);

  const result = (await res.json()) as WhisperResponse;

  // A long imported track contains intentionally silent intervals. It is
  // usable when any Whisper sub-segment contains speech; the individual
  // silent sub-segments are filtered later by simplifyTranscript.
  const noSpeechProb =
    result.segments.length > 0 ? Math.min(...result.segments.map((s) => s.no_speech_prob)) : 1;

  if (noSpeechProb > NO_SPEECH_THRESHOLD) {
    console.log(
      `[transcribe] skipping ${ref.audioFile} (no_speech_prob=${noSpeechProb.toFixed(2)})`,
    );
    return null;
  }

  const text = result.text.trim();
  if (!text) return null;

  const segment: TranscriptSegment = {
    segmentId: ref.segmentId,
    audioFile: ref.audioFile,
    timestamp: ref.timestamp,
    userId: ref.userId,
    username: ref.username,
    text,
    noSpeechProb,
    whisper: result,
  };

  const outDir = path.join(sessionDir, "transcripts");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${ref.segmentId}.json`);
  writeFileSync(outPath, JSON.stringify(segment, null, 2), "utf8");

  return segment;
}

// ── Post-session pipeline ─────────────────────────────────────────────────────

async function inferenceComplete(prompt: string, system: string): Promise<string> {
  try {
    const data = await completeSummarization(prompt, system);
    console.log(
      `[inference] ${data.provider}/${data.model}: ${data.inputTokens ?? "?"} input tokens, ${data.outputTokens ?? "?"} output tokens`,
    );
    if (data.finishReason === "length") {
      throw new UnrecoverableError(
        "Inference output reached the provider or model output limit and was truncated",
      );
    }
    const content = stripCodeFence(data.content.trim());
    if (!content) throw new Error("Summarization provider returned an empty response");
    return content;
  } catch (error) {
    if (APICallError.isInstance(error) && !error.isRetryable) {
      throw new UnrecoverableError(
        `Summarization provider rejected the request${error.statusCode ? ` (${error.statusCode})` : ""}: ${error.message}`,
      );
    }
    throw error;
  }
}

export async function summarize(transcript: Transcript, campaignId: string): Promise<string> {
  const cast = await getCampaignCast(campaignId);
  const formatted = formatTranscriptForInference(transcript, cast);
  return createDetailedRecord(formatted, inferenceComplete);
}

export async function generateTitle(recapText: string): Promise<string> {
  return normalizeTitle(await inferenceComplete(recapText, TITLE_SYSTEM));
}

export async function recap(summary: string): Promise<string> {
  return createRecap(summary, inferenceComplete);
}
