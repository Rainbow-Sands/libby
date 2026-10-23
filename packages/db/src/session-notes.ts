import { z } from "zod";

// Structured inference output for one session. The ledger is the machine-facing
// extraction stored as a session artifact; the recap is the reader-facing
// sectioned summary stored on the session row. Both are validated with the same
// schemas the worker hands to the model, so a stored value always parses.
//
// Every `at` is an elapsed "h:mm:ss" offset copied from the transcript's minute
// markers (see formatTranscriptForInference). Parse it with parseElapsed.

const at = z
  .string()
  .describe('Elapsed time in the transcript as "h:mm:ss", taken from the nearest marker');

export const ENTITY_KINDS = ["character", "npc", "location", "faction", "item", "other"] as const;
// "open" is a thread carried forward from an earlier session that this session
// did not touch; it stays listed until the party resolves it.
export const THREAD_STATUSES = ["new", "advanced", "resolved", "abandoned", "open"] as const;

export const sessionLedgerSchema = z.object({
  events: z
    .array(
      z.object({
        at,
        summary: z.string().describe("One or two sentences on what happened in the game"),
      }),
    )
    .describe("Every meaningful in-game event, in chronological order"),
  entities: z
    .array(
      z.object({
        name: z.string().describe("Canonical spelling, matching earlier sessions when known"),
        kind: z.enum(ENTITY_KINDS),
        heardAs: z
          .array(z.string())
          .describe("Other spellings that appear in this transcript for the same entity"),
        firstSeenThisSession: z
          .boolean()
          .describe("True only when this session introduces the entity to the story"),
        note: z.string().describe("What this session established or changed about it"),
        at,
      }),
    )
    .describe("Characters, NPCs, places, factions and notable items involved this session"),
  loot: z.array(
    z.object({
      item: z.string(),
      holder: z.string().nullable().describe("Who took it, or null when the table never said"),
      note: z.string(),
      at,
    }),
  ),
  threads: z
    .array(
      z.object({
        title: z
          .string()
          .describe("Short name, reusing an earlier thread's title when continuing it"),
        status: z.enum(["new", "advanced", "resolved", "abandoned"]),
        note: z.string().describe("What changed this session"),
        at,
      }),
    )
    .describe("Quests, mysteries and promises touched, opened or given up this session"),
  quotes: z.array(
    z.object({
      speaker: z.string().describe("Character name when in character, otherwise the player"),
      text: z.string().describe("Verbatim from the transcript, lightly cleaned of filler"),
      context: z.string(),
      at,
    }),
  ),
  rulings: z
    .array(z.object({ ruling: z.string(), at }))
    .describe("Rules calls, house rules and retcons decided at the table"),
  uncertainties: z
    .array(z.string())
    .describe("Likely mishearings, unclear attributions or disagreements worth flagging"),
  leftOff: z.string().describe("Exactly where and in what situation the party ended the session"),
});

export type SessionLedger = z.infer<typeof sessionLedgerSchema>;

export const recapSectionsSchema = z.object({
  recap: z
    .string()
    .describe(
      "Markdown, 120 to 200 words in one to three paragraphs, third person past tense. No headings.",
    ),
  leftOff: z.string().describe("One or two sentences on where the party is right now"),
  openThreads: z.array(
    z.object({
      title: z.string(),
      status: z.enum(THREAD_STATUSES),
      note: z.string().describe("One line on why, mentioning the earlier session when continuing"),
      at: at.nullable(),
    }),
  ),
  loot: z.array(
    z.object({
      item: z.string(),
      holder: z.string().nullable(),
      note: z.string(),
      at: at.nullable(),
    }),
  ),
  epicMoments: z
    .array(
      z.object({
        description: z.string(),
        quote: z.string().nullable(),
        speaker: z.string().nullable(),
        at: at.nullable(),
      }),
    )
    .describe("At most three"),
  newFaces: z
    .array(z.object({ name: z.string(), kind: z.enum(ENTITY_KINDS) }))
    .describe("NPCs, places and factions introduced this session"),
  rulings: z.array(z.object({ ruling: z.string(), at: at.nullable() })),
});

export type RecapSections = z.infer<typeof recapSectionsSchema>;

export interface TableStats {
  durationSeconds: number;
  speakers: { userId: string; name: string; characterName: string | null; words: number }[];
}

export interface SessionRecap {
  version: 1;
  sections: RecapSections;
  stats: TableStats;
}

export function parseSessionLedger(value: unknown): SessionLedger {
  return sessionLedgerSchema.parse(value);
}

export function parseElapsed(value: string | null | undefined): number | null {
  const match = value ? /^(\d+):([0-5]\d):([0-5]\d)$/.exec(value.trim()) : null;
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const THREAD_LABELS: Record<(typeof THREAD_STATUSES)[number], string> = {
  new: "New",
  advanced: "Advanced",
  resolved: "Resolved",
  abandoned: "Abandoned",
  open: "Still open",
};

// Plain markdown for every consumer that wants one string: link previews, the
// title prompt, Libby's chat context, and older sessions' recap column.
export function renderRecapMarkdown(sections: RecapSections): string {
  const parts = [sections.recap.trim(), `## Where we left off\n\n${sections.leftOff.trim()}`];

  if (sections.openThreads.length > 0) {
    const lines = sections.openThreads.map(
      (thread) => `- **${thread.title}** (${THREAD_LABELS[thread.status]}): ${thread.note}`,
    );
    parts.push(`## Open threads\n\n${lines.join("\n")}`);
  }
  if (sections.loot.length > 0) {
    const lines = sections.loot.map(
      (item) => `- **${item.item}**${item.holder ? ` (${item.holder})` : ""}: ${item.note}`,
    );
    parts.push(`## Loot\n\n${lines.join("\n")}`);
  }
  if (sections.epicMoments.length > 0) {
    const lines = sections.epicMoments.map((moment) => {
      const quote = moment.quote
        ? ` "${moment.quote}"${moment.speaker ? ` (${moment.speaker})` : ""}`
        : "";
      return `- ${moment.description}${quote}`;
    });
    parts.push(`## Epic moments\n\n${lines.join("\n")}`);
  }
  if (sections.newFaces.length > 0) {
    parts.push(
      `## New faces & places\n\n${sections.newFaces.map((face) => `- ${face.name}`).join("\n")}`,
    );
  }
  if (sections.rulings.length > 0) {
    parts.push(`## Rulings\n\n${sections.rulings.map((r) => `- ${r.ruling}`).join("\n")}`);
  }

  return parts.join("\n\n");
}
