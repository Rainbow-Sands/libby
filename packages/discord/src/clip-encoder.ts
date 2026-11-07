import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;

export type ClipEncoder = ChildProcessByStdio<Writable, null, Readable>;

// Encode raw s16le PCM from stdin into an ogg/opus file. ffmpeg's stderr is
// always drained: a pipe nobody reads fills up on a long clip, and ffmpeg then
// blocks writing to it, stops reading stdin and never exits.
export function spawnClipEncoder(outputPath: string, label: string): ClipEncoder {
  const ffmpegProcess = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-loglevel",
      "error",
      "-f",
      "s16le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      String(CHANNELS),
      "-i",
      "pipe:0",
      "-c:a",
      "libopus",
      "-b:a",
      "64k",
      outputPath,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  ffmpegProcess.stderr.setEncoding("utf8");
  ffmpegProcess.stderr.on("data", (chunk: string) => {
    console.error(`ffmpeg (${label}): ${chunk.trimEnd()}`);
  });
  // Writes after ffmpeg has exited (e.g. it was killed) fail with EPIPE. The
  // "close" handler reports the clip, so don't let that crash the bot.
  ffmpegProcess.stdin.on("error", (err) => {
    console.error(`ffmpeg stdin (${label}):`, err.message);
  });
  return ffmpegProcess;
}
