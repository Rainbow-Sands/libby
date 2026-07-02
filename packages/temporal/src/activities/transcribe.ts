import { Context, ApplicationFailure } from "@temporalio/activity";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import type { SegmentRef } from "../types.ts";
import { WHISPER_URL, LLAMA_URL } from "../env.ts";
import { SUMMARIZE_SYSTEM, TITLE_SYSTEM, RECAP_SYSTEM } from "../prompts.ts";
import { stripCodeFence, stripLeadingTitle, normalizeTitle } from "../text.ts";
import { getCampaignCast } from "@rainbot/db";

interface WhisperResponse {
  text: string;
  segments: { no_speech_prob: number }[];
}

interface TranscriptFragment {
  timestamp: string;
  userId: string;
  username?: string;
  text: string;
}

const NO_SPEECH_THRESHOLD = 0.6;

// ── Transcription ─────────────────────────────────────────────────────────────

export async function transcribeSegment(
  sessionDir: string,
  ref: SegmentRef,
): Promise<string | null> {
  const whisperUrl = WHISPER_URL;

  const audioPath = path.join(sessionDir, ref.audioFile);
  if (!existsSync(audioPath)) {
    throw ApplicationFailure.nonRetryable(
      `Audio file not found: ${ref.audioFile}`,
    );
  }

  const abortController = new AbortController();
  Context.current().cancelled.catch(() => abortController.abort());

  const heartbeat = setInterval(() => Context.current().heartbeat(), 5_000);

  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(readFileSync(audioPath))], {
        type: "audio/ogg",
      }),
      path.basename(audioPath),
    );
    form.append("response_format", "verbose_json");

    const res = await fetch(`${whisperUrl}/inference`, {
      method: "POST",
      body: form,
      signal: abortController.signal,
    });

    if (res.status >= 400 && res.status < 500) {
      throw ApplicationFailure.nonRetryable(
        `Whisper rejected the request: ${res.status}`,
      );
    }
    if (!res.ok) throw new Error(`Whisper server returned ${res.status}`);

    const result = (await res.json()) as WhisperResponse;

    const noSpeechProb =
      result.segments.length > 0
        ? Math.max(...result.segments.map((s) => s.no_speech_prob))
        : 1;

    if (noSpeechProb > NO_SPEECH_THRESHOLD) {
      console.log(
        `[transcribe] skipping ${ref.audioFile} (no_speech_prob=${noSpeechProb.toFixed(2)})`,
      );
      return null;
    }

    const text = result.text.trim();
    if (!text) return null;

    const fragment: TranscriptFragment = {
      timestamp: ref.timestamp,
      userId: ref.userId,
      username: ref.username,
      text,
    };

    const outDir = path.join(sessionDir, "transcripts");
    mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${ref.segmentId}.json`);
    writeFileSync(outPath, JSON.stringify(fragment, null, 2), "utf8");

    return `transcripts/${ref.segmentId}.json`;
  } finally {
    clearInterval(heartbeat);
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────────

export async function aggregateTranscript(
  sessionDir: string,
  keys: string[],
  campaignId: string,
): Promise<string> {
  const fragments: TranscriptFragment[] = keys
    .map((key) => {
      const p = path.join(sessionDir, key);
      if (!existsSync(p)) return null;
      return JSON.parse(readFileSync(p, "utf8")) as TranscriptFragment;
    })
    .filter((f): f is TranscriptFragment => f !== null)
    .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Wall-clock timing isn't relevant to summarization, so we drop it. Consecutive
  // lines from the same speaker are merged onto one labelled line to avoid
  // repeating the speaker on every utterance.
  const lines: string[] = [];
  let speaker: string | null = null;
  let buffer: string[] = [];
  // Track the label actually used per speaker so the cast legend below can reuse
  // the same name (the body uses displayName, which may differ from the account).
  const labelByUserId = new Map<string, string>();

  const flush = () => {
    if (speaker !== null && buffer.length > 0) {
      lines.push(`${speaker}: ${buffer.join(" ")}`);
    }
  };

  for (const fragment of fragments) {
    const text = fragment.text.trim();
    if (!text) continue;
    const name = fragment.username ?? fragment.userId;
    if (!labelByUserId.has(fragment.userId)) {
      labelByUserId.set(fragment.userId, name);
    }
    if (name !== speaker) {
      flush();
      speaker = name;
      buffer = [text];
    } else {
      buffer.push(text);
    }
  }
  flush();

  const legend = await buildCastLegend(campaignId, labelByUserId);
  const content = legend + lines.join("\n") + "\n";

  const outPath = path.join(sessionDir, "transcript.txt");
  writeFileSync(outPath, content, "utf8");
  return "transcript.txt";
}

// Prepends a "who plays whom" cast list so the model can attribute dialogue to
// characters. Each player is labelled with the same name used in the transcript
// body (falling back to their account username if they never spoke).
async function buildCastLegend(
  campaignId: string,
  labelByUserId: Map<string, string>,
): Promise<string> {
  const cast = await getCampaignCast(campaignId);
  if (cast.length === 0) return "";

  const entries = cast.map((member) => {
    const label = labelByUserId.get(member.userId) ?? member.username;
    return `- ${label} plays ${member.characterName}`;
  });

  return `Cast — the players and the characters they play:\n${entries.join("\n")}\n\nTranscript:\n`;
}

// ── Post-session pipeline ─────────────────────────────────────────────────────

async function llamaComplete(prompt: string, system: string): Promise<string> {
  const llamaUrl = LLAMA_URL;

  const abortController = new AbortController();
  Context.current().cancelled.catch(() => abortController.abort());

  const heartbeat = setInterval(() => Context.current().heartbeat(), 10_000);

  try {
    const res = await fetch(`${llamaUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      }),
      signal: abortController.signal,
    });

    if (res.status >= 400 && res.status < 500) {
      throw ApplicationFailure.nonRetryable(
        `LLaMA rejected the request: ${res.status}`,
      );
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
): Promise<string> {
  const transcript = readFileSync(path.join(sessionDir, transcriptKey), "utf8");

  const text = stripLeadingTitle(await llamaComplete(transcript, SUMMARIZE_SYSTEM));

  const outPath = path.join(sessionDir, "summary.txt");
  writeFileSync(outPath, text, "utf8");
  return "summary.txt";
}

export async function generateTitle(
  sessionDir: string,
  summaryKey: string,
): Promise<string> {
  const summary = readFileSync(path.join(sessionDir, summaryKey), "utf8");

  const text = await llamaComplete(summary, TITLE_SYSTEM);
  const title = normalizeTitle(text);

  const outPath = path.join(sessionDir, "title.txt");
  writeFileSync(outPath, title, "utf8");
  return "title.txt";
}

export async function recap(
  sessionDir: string,
  summaryKey: string,
): Promise<string> {
  const summary = readFileSync(path.join(sessionDir, summaryKey), "utf8");

  const text = stripLeadingTitle(await llamaComplete(summary, RECAP_SYSTEM));

  const outPath = path.join(sessionDir, "recap.txt");
  writeFileSync(outPath, text, "utf8");
  return "recap.txt";
}
