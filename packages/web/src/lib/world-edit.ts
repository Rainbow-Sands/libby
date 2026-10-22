import type { WorldEditPreview } from "@rainbot/db";

// A proposal as the chat shows it: the preview plus the play order of every
// session it mentions, since the card names sessions by number.
export interface ProposedWorldEdit extends WorldEditPreview {
  sessionNumbers: Record<string, number>;
}
