import { Events, type Client, type VoiceBasedChannel, type VoiceState } from "discord.js";
import { joinVoiceChannel, EndBehaviorType } from "@discordjs/voice";
import prism from "prism-media";
import { mkdirSync, statSync } from "fs";
import { rm } from "node:fs/promises";
import { spawn } from "child_process";
import path from "path";
import { randomUUID } from "node:crypto";
import { getActiveSession, setActiveSession } from "./recording.ts";
import { finishActiveActivations, type FinalizableActivation } from "./session-shutdown.ts";
import {
  beginSessionShutdown,
  completeAudioSegment,
  discardAudioSegment,
  finishSessionShutdown,
  registerAudioSegment,
  type SegmentRef,
} from "@rainbot/worker";

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const FRAME_SIZE = 960; // 20ms at 48kHz — Discord's standard Opus frame duration
// One 20ms frame of silence, substituted for a packet the decoder couldn't
// parse so a single bad packet doesn't leave an audible gap or resync issue.
const SILENT_FRAME = Buffer.alloc(FRAME_SIZE * CHANNELS * 2);
// An Ogg Opus file with only its mandatory header pages (OpusHead/OpusTags)
// and no real audio is well under this. A stream error that fires almost
// immediately after an activation starts can leave ffmpeg with ~0 bytes of
// PCM before its stdin is closed — it still exits 0 and writes a header-only
// file, which the transcription server then fails to do anything with.
const MIN_CLIP_BYTES = 1024;

interface ActiveActivation extends FinalizableActivation {
  // Settles once the clip stops receiving audio, before it is finalized.
  listening: Promise<void>;
  completed: Promise<void>;
}

export function hasMeaningfulAudio(filePath: string): boolean {
  try {
    return statSync(filePath).size >= MIN_CLIP_BYTES;
  } catch {
    return false;
  }
}

function startActivation(
  sessionDir: string,
  ref: SegmentRef,
  connection: ReturnType<typeof joinVoiceChannel>,
  onDone: () => Promise<void>,
  onDiscard: (reason: string) => Promise<void>,
): ActiveActivation {
  const outputPath = path.join(sessionDir, ref.audioFile);

  const audioStream = connection.receiver.subscribe(ref.userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 2000 },
  });
  // The receiver drops this user's subscription when the stream closes, so a
  // new activation can subscribe from then on.
  const listening = new Promise<void>((resolve) => audioStream.once("close", () => resolve()));

  const ffmpegProcess = spawn("ffmpeg", [
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
  ]);

  ffmpegProcess.on("error", (err) => console.error(`ffmpeg error (${ref.userId}):`, err));

  let finishing = false;
  let stdinEnded = false;
  let resolveCompleted: () => void;
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve;
  });

  const endFfmpegInput = () => {
    if (stdinEnded) return;
    stdinEnded = true;
    ffmpegProcess.stdin?.end();
  };

  // A malformed Opus packet (packet loss, jitter, etc.) is a normal occurrence
  // on a live voice connection. Once a Decoder's _transform callback fires
  // with an error, Node permanently destroys that stream — it can't process
  // any further chunks — so we swap in a fresh decoder and keep going rather
  // than ending the whole activation over one bad packet.
  let opusDecoder: InstanceType<typeof prism.opus.Decoder>;

  const wireDecoder = () => {
    opusDecoder = new prism.opus.Decoder({
      rate: SAMPLE_RATE,
      channels: CHANNELS,
      frameSize: FRAME_SIZE,
    });
    opusDecoder.on("end", () => {
      if (finishing) endFfmpegInput();
    });
    opusDecoder.on("error", (err) => {
      console.error(`opus decode error (${ref.userId}), skipping packet:`, err);
      opusDecoder.unpipe(ffmpegProcess.stdin! as any);
      opusDecoder.destroy();
      if (finishing) {
        endFfmpegInput();
        return;
      }
      if (ffmpegProcess.stdin?.writable) {
        ffmpegProcess.stdin.write(SILENT_FRAME);
      }
      wireDecoder();
      audioStream.pipe(opusDecoder as any);
    });
    // Ending ffmpeg's stdin is handled separately (below), since decoders get
    // swapped out mid-activation and shouldn't each end the shared stdin.
    opusDecoder.pipe(ffmpegProcess.stdin! as any, { end: false });
  };
  wireDecoder();

  // Stop accepting packets, drain anything already received, and let the
  // decoder flush before closing ffmpeg's stdin. This also handles session
  // shutdown, when AfterSilence has not had a chance to end the stream.
  const finish = (): Promise<void> => {
    if (!finishing) {
      finishing = true;
      audioStream.pause();
      audioStream.unpipe(opusDecoder as any);

      let packet: Buffer | null;
      while ((packet = audioStream.read() as Buffer | null) !== null) {
        opusDecoder.write(packet);
      }

      audioStream.destroy();
      if (opusDecoder.destroyed) {
        endFfmpegInput();
      } else {
        opusDecoder.end();
      }
    }
    return completed;
  };

  // A receiver-level error means no more audio will ever arrive for this
  // activation (unlike a per-packet decode error) — finalize the clip.
  audioStream.on("error", (err) => {
    console.error(`audio stream error (${ref.userId}):`, err);
    void finish();
  });
  audioStream.on("end", () => {
    finishing = true;
  });
  audioStream.on("close", () => {
    if (!finishing) void finish();
  });

  audioStream.pipe(opusDecoder! as any);

  ffmpegProcess.on("close", async (code) => {
    try {
      if (code === 0 && hasMeaningfulAudio(outputPath)) {
        await onDone();
      } else {
        await onDiscard(
          code === 0 ? "Audio clip did not contain meaningful data" : `ffmpeg exited with ${code}`,
        );
      }
    } catch (error) {
      console.error(`[session] could not finalize segment ${ref.segmentId}:`, error);
    } finally {
      resolveCompleted();
    }
  });

  return { listening, completed, finish };
}

export function attachRecordingSession(
  client: Client,
  voiceChannel: VoiceBasedChannel,
  guildId: string,
  channelId: string,
  sessionId: string,
  runId: string,
  sessionDir: string,
  initialSegmentCount = 0,
): void {
  mkdirSync(path.join(sessionDir, "clips"), { recursive: true });

  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator as any,
    selfDeaf: false,
  });

  let segmentCounter = initialSegmentCount;
  let ending: Promise<void> | null = null;
  // Activations still receiving audio, by user, and every activation that has
  // not finished uploading yet.
  const listening = new Map<string, ActiveActivation>();
  const activeActivations = new Set<ActiveActivation>();
  const registrations = new Set<Promise<boolean>>();

  const endSession = (): Promise<void> => {
    if (ending) return ending;
    if (!getActiveSession(guildId)) return Promise.resolve();

    ending = (async () => {
      client.off(Events.VoiceStateUpdate, voiceStateHandler);
      connection.receiver.speaking.off("start", speakingStartHandler);

      await Promise.allSettled(registrations);
      await beginSessionShutdown(sessionId, runId);
      await finishActiveActivations(activeActivations.values());

      connection.destroy();
      setActiveSession(guildId, null);
      try {
        await finishSessionShutdown(sessionId, runId);
      } finally {
        await rm(sessionDir, { recursive: true, force: true });
      }
      console.log(`[session] ended — ${guildId}:${sessionId}`);
    })();

    return ending;
  };

  const voiceStateHandler = (oldState: VoiceState, _newState: VoiceState) => {
    if (oldState.channelId !== channelId) return;
    if (oldState.member?.user.bot) return;
    const channel = oldState.guild.channels.cache.get(channelId);
    if (!channel?.isVoiceBased()) return;
    const humanCount = [...(channel as VoiceBasedChannel).members.values()].filter(
      (m) => !m.user.bot,
    ).length;
    if (humanCount === 0) {
      console.log("[session] voice channel empty, auto-ending");
      endSession().catch((err: unknown) => console.error("[session] auto-end error:", err));
    }
  };

  client.on(Events.VoiceStateUpdate, voiceStateHandler);

  setActiveSession(guildId, {
    segmentCount: initialSegmentCount,
    end: endSession,
  });

  // The receiver emits "start" while handling the user's first packet, before
  // it hands that packet to subscribers, so subscribing here synchronously
  // records from the first packet. The clip is registered in Postgres
  // alongside the recording rather than before it.
  const speakingStartHandler = (userId: string) => {
    if (ending || listening.has(userId)) return;

    const segmentId = randomUUID();
    segmentCounter++;
    // Resolve a readable label for the transcript. Use the account username so it
    // matches the username stored for campaign members; fall back to the id.
    const username = voiceChannel.guild.members.cache.get(userId)?.user.username ?? userId;
    const session = getActiveSession(guildId);
    if (session) session.segmentCount = segmentCounter;

    const ref: SegmentRef = {
      segmentId,
      audioFile: `clips/${segmentId}.ogg`,
      timestamp: new Date().toISOString(),
      userId,
      username,
    };
    const clipPath = path.join(sessionDir, ref.audioFile);
    const registered = registerAudioSegment(sessionId, runId, ref).then(
      () => true,
      (error: unknown) => {
        console.error(`[session] could not register segment ${segmentId}:`, error);
        return false;
      },
    );
    registrations.add(registered);
    void registered.finally(() => registrations.delete(registered));

    // A clip that was never registered is unknown to the session, so its
    // file is dropped instead of uploaded.
    const activation = startActivation(
      sessionDir,
      ref,
      connection,
      async () => {
        if (await registered) await completeAudioSegment(sessionId, runId, clipPath, ref);
        else await rm(clipPath, { force: true });
      },
      async (reason) => {
        if (await registered) await discardAudioSegment(sessionId, runId, segmentId, reason);
        else await rm(clipPath, { force: true });
      },
    );
    listening.set(userId, activation);
    activeActivations.add(activation);
    void activation.listening.finally(() => {
      if (listening.get(userId) === activation) listening.delete(userId);
    });
    void activation.completed.finally(() => activeActivations.delete(activation));
    // A session that stopped accepting audio records no more of this clip.
    void registered.then((accepted) => {
      if (!accepted) void activation.finish();
    });
  };

  connection.receiver.speaking.on("start", speakingStartHandler);

  console.log(`[session] attached — ${guildId}:${sessionId}`);
}
