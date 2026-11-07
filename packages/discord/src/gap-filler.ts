import { Transform, type TransformCallback } from "node:stream";

export const FRAME_MS = 20; // Discord sends one 20ms Opus frame per packet.
// The Opus packet Discord itself sends for silence: one 20ms CELT frame that
// decodes to digital silence.
export const OPUS_SILENCE_PACKET = Buffer.from([0xf8, 0xff, 0xfe]);
// Network jitter delays packets by a few frames without any real pause. Only
// a lag beyond this is treated as a gap, so jitter never cuts into speech.
const MAX_LAG_MS = 200;

// Discord clients stop sending packets while a speaker is quiet, and a clip
// only ends after 2s without packets. Without filling, every shorter pause is
// squeezed out of the clip, so Whisper's in-clip offsets run early and the
// transcript can place a later sentence before another player's reply. This
// stream passes Opus packets through unchanged and, when the audio written so
// far falls behind the time since the first packet by more than MAX_LAG_MS,
// inserts silence packets first so the clip keeps pace with the real clock.
export class OpusGapFiller extends Transform {
  private startMs: number | null = null;
  private frames = 0;
  private filling = true;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    super({ objectMode: true });
    this.now = now;
  }

  // Packets drained from a buffer at shutdown arrive all at once, so their
  // arrival time no longer says when they were spoken.
  stopFilling(): void {
    this.filling = false;
  }

  override _transform(packet: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    const now = this.now();
    if (this.startMs === null) {
      this.startMs = now;
    } else if (this.filling) {
      const expected = Math.floor((now - this.startMs) / FRAME_MS);
      if ((expected - this.frames) * FRAME_MS > MAX_LAG_MS) {
        while (this.frames < expected) {
          this.push(OPUS_SILENCE_PACKET);
          this.frames++;
        }
      }
    }
    this.push(packet);
    this.frames++;
    callback();
  }
}
