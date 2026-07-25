import { DETAILED_RECORD_SYSTEM, RECAP_SYSTEM } from "./prompts.ts";
import { stripLeadingTitle } from "./text.ts";

export type Complete = (prompt: string, system: string) => Promise<string>;

export async function createDetailedRecord(
  transcript: string,
  complete: Complete,
): Promise<string> {
  return stripLeadingTitle(await complete(transcript, DETAILED_RECORD_SYSTEM)).trim();
}

export async function createRecap(detailedRecord: string, complete: Complete): Promise<string> {
  return stripLeadingTitle(await complete(detailedRecord, RECAP_SYSTEM)).trim();
}
