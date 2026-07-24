import { Events, type Client, type VoiceBasedChannel, type VoiceState } from "discord.js";
import { joinVoiceChannel, EndBehaviorType } from "@discordjs/voice";
import prism from "prism-media";
import { mkdirSync, statSync } from "fs";
import { spawn } from "child_process";
import path from "path";
import type { WorkflowHandle } from "@temporalio/client";
import { getActiveSession, setActiveSession } from "./recording.ts";
import { finishActiveActivations, type FinalizableActivation } from "./session-shutdown.ts";
import { segmentRecorded, sessionEnded } from "@rainbot/temporal";
import type { SegmentRef } from "@rainbot/temporal";

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
  completed: Promise<void>;
}

function hasMeaningfulAudio(filePath: string): boolean {
  try {
    return statSync(filePath).size >= MIN_CLIP_BYTES;
  } catch {
    return false;
  }
}

function startActivation(
  sessionDir: string,
  segmentId: string,
  userId: string,
  username: string,
  connection: ReturnType<typeof joinVoiceChannel>,
  onDone: (ref: SegmentRef) => Promise<void>,
): ActiveActivation {
  const timestamp = new Date().toISOString();
  const audioFile = `clips/${segmentId}.ogg`;
  const outputPath = path.join(sessionDir, audioFile);

  const audioStream = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 2000 },
  });

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

  ffmpegProcess.on("error", (err) => console.error(`ffmpeg error (${userId}):`, err));

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
      console.error(`opus decode error (${userId}), skipping packet:`, err);
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
    console.error(`audio stream error (${userId}):`, err);
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
        await onDone({ segmentId, audioFile, timestamp, userId, username });
      }
    } finally {
      resolveCompleted();
    }
  });

  return { completed, finish };
}

export function attachRecordingSession(
  client: Client,
  voiceChannel: VoiceBasedChannel,
  workflowHandle: WorkflowHandle,
  guildId: string,
  channelId: string,
  sessionId: string,
  sessionDir: string,
): void {
  mkdirSync(path.join(sessionDir, "clips"), { recursive: true });
  mkdirSync(path.join(sessionDir, "transcripts"), { recursive: true });

  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator as any,
    selfDeaf: false,
  });

  let segmentCounter = 0;
  let ending: Promise<void> | null = null;
  const activeActivations = new Map<string, ActiveActivation>();

  const onSegmentDone = async (ref: SegmentRef) => {
    try {
      await workflowHandle.signal(segmentRecorded, ref);
    } catch (err) {
      console.error("[workflow] signal error:", err);
    }
  };

  const endSession = (): Promise<void> => {
    if (ending) return ending;
    if (!getActiveSession(guildId)) return Promise.resolve();

    ending = (async () => {
      client.off(Events.VoiceStateUpdate, voiceStateHandler);
      connection.receiver.speaking.off("start", speakingStartHandler);

      await finishActiveActivations(activeActivations.values());

      connection.destroy();
      setActiveSession(guildId, null);
      await workflowHandle
        .signal(sessionEnded)
        .catch((err: unknown) => console.error("[workflow] sessionEnded signal error:", err));
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
    connection,
    guildId,
    channelId,
    sessionId,
    sessionDir,
    segmentCount: 0,
    workflowHandle,
    end: endSession,
  });

  const speakingStartHandler = (userId: string) => {
    if (ending || activeActivations.has(userId)) return;

    const segId = String(segmentCounter++).padStart(4, "0");
    // Resolve a readable label for the transcript. Use the account username so it
    // matches the username stored for campaign members; fall back to the id.
    const username = voiceChannel.guild.members.cache.get(userId)?.user.username ?? userId;
    const activation = startActivation(
      sessionDir,
      segId,
      userId,
      username,
      connection,
      onSegmentDone,
    );
    activeActivations.set(userId, activation);
    void activation.completed.finally(() => {
      if (activeActivations.get(userId) === activation) {
        activeActivations.delete(userId);
      }
    });

    const session = getActiveSession(guildId);
    if (session) session.segmentCount = segmentCounter;
  };

  connection.receiver.speaking.on("start", speakingStartHandler);

  console.log(`[session] attached — ${guildId}:${sessionId}`);
}
