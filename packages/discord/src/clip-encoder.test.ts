import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { CHANNELS, SAMPLE_RATE, spawnClipEncoder } from "./clip-encoder.ts";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("spawnClipEncoder", () => {
  // An undrained stderr used to fill after about 9 minutes of continuous
  // audio, freezing ffmpeg so it never exited. ffmpeg prints its progress
  // stats on a wall-clock timer, so encoding faster than real time can't
  // reproduce that here; check instead that stderr is always being read.
  it("always drains stderr, encodes continuous audio and exits", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "clip-encoder-"));
    try {
      const outputPath = path.join(dir, "clip.ogg");
      const encoder = spawnClipEncoder(outputPath, "test");
      const closed = once(encoder, "close");
      expect(encoder.stderr.readableFlowing).toBe(true);

      const second = Buffer.alloc(SAMPLE_RATE * CHANNELS * 2);
      for (let i = 0; i < 60; i++) {
        if (!encoder.stdin.write(second)) await once(encoder.stdin, "drain");
      }
      encoder.stdin.end();

      const [code] = await closed;
      expect(code).toBe(0);
      expect(statSync(outputPath).size).toBeGreaterThan(1024);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
