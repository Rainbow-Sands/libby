import prism from "prism-media";
import { describe, expect, it } from "vitest";
import { CHANNELS, SAMPLE_RATE } from "./clip-encoder.ts";
import { FRAME_MS, OPUS_SILENCE_PACKET, OpusGapFiller } from "./gap-filler.ts";

// Feeds packets at the given arrival times (ms) and returns what comes out.
function run(arrivals: number[], drainedAtEnd = 0): Buffer[] {
  let clock = 0;
  const filler = new OpusGapFiller(() => clock);
  const out: Buffer[] = [];
  filler.on("data", (packet: Buffer) => out.push(packet));
  arrivals.forEach((at, i) => {
    clock = at;
    filler.write(Buffer.from([i]));
  });
  if (drainedAtEnd > 0) {
    clock += 5_000;
    filler.stopFilling();
    for (let i = 0; i < drainedAtEnd; i++) filler.write(Buffer.from([100 + i]));
  }
  return out;
}

const silences = (packets: Buffer[]) =>
  packets.filter((packet) => packet.equals(OPUS_SILENCE_PACKET)).length;

describe("OpusGapFiller", () => {
  it("passes continuous speech through unchanged", () => {
    const arrivals = Array.from({ length: 50 }, (_, i) => i * FRAME_MS);
    expect(run(arrivals)).toHaveLength(50);
  });

  it("ignores jitter below the threshold", () => {
    // Packets bunch up and arrive up to 180ms late, with no real pause.
    const arrivals = [0, 20, 40, 220, 225, 230, 235, 240, 245, 250, 255];
    expect(silences(run(arrivals))).toBe(0);
  });

  it("fills a pause so later speech keeps its real offset", () => {
    // Ten frames of speech, a 1.5s pause, then more speech.
    const before = Array.from({ length: 10 }, (_, i) => i * FRAME_MS);
    const after = Array.from({ length: 10 }, (_, i) => 1_700 + i * FRAME_MS);
    const out = run([...before, ...after]);
    const firstAfter = out.findIndex((packet) => packet[0] === 10);
    expect(firstAfter * FRAME_MS).toBe(1_700);
    expect(silences(out)).toBe(1_700 / FRAME_MS - 10);
  });

  it("does not fill for packets drained at shutdown", () => {
    const out = run([0, 20, 40], 3);
    expect(out).toHaveLength(6);
    expect(silences(out)).toBe(0);
  });

  it("uses a silence packet the decoder turns into one silent frame", () => {
    const decoder = new prism.opus.Decoder({
      rate: SAMPLE_RATE,
      channels: CHANNELS,
      frameSize: 960,
    });
    const pcm: Buffer[] = [];
    decoder.on("data", (chunk: Buffer) => pcm.push(chunk));
    decoder.write(OPUS_SILENCE_PACKET);
    const frame = Buffer.concat(pcm);
    expect(frame.length).toBe(((SAMPLE_RATE * FRAME_MS) / 1000) * CHANNELS * 2);
    expect(frame.every((byte) => byte === 0)).toBe(true);
  });
});
