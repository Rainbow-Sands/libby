import { Context, ApplicationFailure } from "@temporalio/activity";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import type { SegmentRef } from "../types.ts";
import {
  INFERENCE_URL,
  SUMMARIZATION_MODEL,
  SUMMARIZATION_THINKING_BUDGET,
  TRANSCRIPTION_MODEL,
} from "../env.ts";
import { SUMMARIZE_SYSTEM, TITLE_SYSTEM, RECAP_SYSTEM } from "../prompts.ts";
import { stripCodeFence, stripLeadingTitle, normalizeTitle } from "../text.ts";
import {
  getCampaignCast,
  simplifyTranscript,
  type Transcript,
  type TranscriptSegment,
} from "@rainbot/db";

interface WhisperResponse {
  text: string;
  segments: { no_speech_prob: number }[];
}

const NO_SPEECH_THRESHOLD = 0.6;

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
): Promise<string | null> {
  const audioPath = path.join(sessionDir, ref.audioFile);
  if (!existsSync(audioPath)) {
    throw ApplicationFailure.nonRetryable(`Audio file not found: ${ref.audioFile}`);
  }

  const abortController = new AbortController();
  Context.current().cancelled.catch(() => abortController.abort());

  const heartbeat = setInterval(() => Context.current().heartbeat(), 5_000);

  try {
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

    const res = await fetch(`${INFERENCE_URL}/v1/audio/transcriptions`, {
      method: "POST",
      body: form,
      signal: abortController.signal,
    });

    if (res.status >= 400 && res.status < 500) {
      throw ApplicationFailure.nonRetryable(`Whisper rejected the request: ${res.status}`);
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

    return `transcripts/${ref.segmentId}.json`;
  } finally {
    clearInterval(heartbeat);
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────────

// Collects every segment's raw data into one ordered, lossless record. No
// simplification happens here — that's deferred to summarization time so
// improvements to LLM-facing formatting can be re-run over this same data
// later without re-transcribing.
export async function aggregateTranscript(sessionDir: string, keys: string[]): Promise<string> {
  const segments = keys
    .map((key) => {
      const p = path.join(sessionDir, key);
      if (!existsSync(p)) return null;
      return JSON.parse(readFileSync(p, "utf8")) as TranscriptSegment;
    })
    .filter((s): s is TranscriptSegment => s !== null)
    .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));

  const transcript: Transcript = { version: 1, segments };

  const outPath = path.join(sessionDir, "transcript.json");
  writeFileSync(outPath, JSON.stringify(transcript), "utf8");
  return "transcript.json";
}

// ── Post-session pipeline ─────────────────────────────────────────────────────

async function llamaComplete(prompt: string, system: string): Promise<string> {
  const abortController = new AbortController();
  Context.current().cancelled.catch(() => abortController.abort());

  const heartbeat = setInterval(() => Context.current().heartbeat(), 10_000);

  try {
    const res = await fetch(`${INFERENCE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SUMMARIZATION_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        thinking_budget_tokens: SUMMARIZATION_THINKING_BUDGET,
        ...(SUMMARIZATION_THINKING_BUDGET === 0
          ? { chat_template_kwargs: { enable_thinking: false } }
          : {}),
      }),
      signal: abortController.signal,
    });

    if (res.status >= 400 && res.status < 500) {
      throw ApplicationFailure.nonRetryable(`LLaMA rejected the request: ${res.status}`);
    }
    if (!res.ok) throw new Error(`LLaMA server returned ${res.status}`);

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return stripCodeFence(data.choices[0]?.message.content.trim() ?? "");
  } finally {
    clearInterval(heartbeat);
  }
}

export async function summarize(
  sessionDir: string,
  transcriptKey: string,
  campaignId: string,
): Promise<string> {
  const transcript = JSON.parse(
    readFileSync(path.join(sessionDir, transcriptKey), "utf8"),
  ) as Transcript;
  const cast = await getCampaignCast(campaignId);
  const simplified = simplifyTranscript(transcript, cast);

  const text = stripLeadingTitle(await llamaComplete(simplified, SUMMARIZE_SYSTEM));

  const outPath = path.join(sessionDir, "summary.txt");
  writeFileSync(outPath, text, "utf8");
  return "summary.txt";
}

export async function generateTitle(sessionDir: string, summaryKey: string): Promise<string> {
  const summary = readFileSync(path.join(sessionDir, summaryKey), "utf8");

  const text = await llamaComplete(summary, TITLE_SYSTEM);
  const title = normalizeTitle(text);

  const outPath = path.join(sessionDir, "title.txt");
  writeFileSync(outPath, title, "utf8");
  return "title.txt";
}

export async function recap(sessionDir: string, summaryKey: string): Promise<string> {
  const summary = readFileSync(path.join(sessionDir, summaryKey), "utf8");

  const text = stripLeadingTitle(await llamaComplete(summary, RECAP_SYSTEM));

  const outPath = path.join(sessionDir, "recap.txt");
  writeFileSync(outPath, text, "utf8");
  return "recap.txt";
}
