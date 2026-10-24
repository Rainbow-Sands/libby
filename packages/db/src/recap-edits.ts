import type { RecapSections } from "./session-notes.ts";

// Hand fixes to a recap's text. Each field of a recap has an id, such as
// "recap", "epicMoments.2" or "loot.0.holder", so a fix names exactly the text
// it changes and the rest of the recap keeps its structure.

export interface RecapTextField {
  field: string;
  label: string;
  text: string;
}

// Every piece of recap text a person reads, in the order the recap shows it.
export function recapTextFields(sections: RecapSections): RecapTextField[] {
  const fields: RecapTextField[] = [
    { field: "recap", label: "Recap", text: sections.recap },
    { field: "leftOff", label: "Where we left off", text: sections.leftOff },
  ];
  sections.openThreads.forEach((thread, i) => {
    fields.push({ field: `openThreads.${i}`, label: "Open thread", text: thread.title });
    fields.push({ field: `openThreads.${i}.note`, label: "Open thread note", text: thread.note });
  });
  sections.loot.forEach((item, i) => {
    fields.push({ field: `loot.${i}`, label: "Loot", text: item.item });
    if (item.holder)
      fields.push({ field: `loot.${i}.holder`, label: "Loot holder", text: item.holder });
    fields.push({ field: `loot.${i}.note`, label: "Loot note", text: item.note });
  });
  sections.epicMoments.forEach((moment, i) => {
    fields.push({ field: `epicMoments.${i}`, label: "Epic moment", text: moment.description });
    if (moment.quote) {
      fields.push({
        field: `epicMoments.${i}.quote`,
        label: "Epic moment quote",
        text: moment.quote,
      });
    }
    if (moment.speaker) {
      fields.push({
        field: `epicMoments.${i}.speaker`,
        label: "Epic moment speaker",
        text: moment.speaker,
      });
    }
  });
  sections.newFaces.forEach((face, i) => {
    fields.push({ field: `newFaces.${i}`, label: "New face", text: face.name });
  });
  sections.rulings.forEach((ruling, i) => {
    fields.push({ field: `rulings.${i}`, label: "Ruling", text: ruling.ruling });
  });
  return fields.filter((entry) => entry.text.trim());
}

// Sets one field's text in place. False when the recap has no such field.
export function setRecapField(sections: RecapSections, field: string, text: string): boolean {
  const [section, index, part] = field.split(".");
  if (section === "recap" || section === "leftOff") {
    if (index !== undefined) return false;
    sections[section] = text;
    return true;
  }
  const i = Number(index);
  if (!Number.isInteger(i)) return false;
  switch (section) {
    case "openThreads": {
      const thread = sections.openThreads[i];
      if (!thread || (part && part !== "note")) return false;
      if (part) thread.note = text;
      else thread.title = text;
      return true;
    }
    case "loot": {
      const item = sections.loot[i];
      if (!item || (part && part !== "holder" && part !== "note")) return false;
      if (part === "holder") item.holder = text;
      else if (part === "note") item.note = text;
      else item.item = text;
      return true;
    }
    case "epicMoments": {
      const moment = sections.epicMoments[i];
      if (!moment || (part && part !== "quote" && part !== "speaker")) return false;
      if (part === "quote") moment.quote = text;
      else if (part === "speaker") moment.speaker = text;
      else moment.description = text;
      return true;
    }
    case "newFaces": {
      const face = sections.newFaces[i];
      if (!face || part) return false;
      face.name = text;
      return true;
    }
    case "rulings": {
      const ruling = sections.rulings[i];
      if (!ruling || part) return false;
      ruling.ruling = text;
      return true;
    }
    default:
      return false;
  }
}

// The recap's fields with their ids, for Libby to quote from when it fixes one.
export function formatRecapFields(sections: RecapSections): string {
  return recapTextFields(sections)
    .map((entry) => `[${entry.field}] ${entry.text}`)
    .join("\n");
}

// One replaced stretch of text, with a little of the sentence around it so the
// confirmation card can show where it is.
export interface RecapChange {
  sessionId: string;
  field: string;
  label: string;
  before: string;
  removed: string;
  added: string;
  after: string;
}

const CONTEXT = 70;

function contextBefore(text: string): string {
  if (text.length <= CONTEXT) return text;
  const cut = text.slice(-CONTEXT);
  return `…${cut.slice(cut.indexOf(" ") + 1)}`;
}

function contextAfter(text: string): string {
  if (text.length <= CONTEXT) return text;
  const cut = text.slice(0, CONTEXT);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches the exact text wherever it appears.
export function exactly(find: string): RegExp {
  return new RegExp(escapeRegExp(find), "g");
}

// Matches a name or phrase only as whole words, so fixing "Ana" leaves
// "Anastrasya" alone.
export function wholeWords(find: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(find)}(?![\\p{L}\\p{N}])`, "gu");
}

// Replaces each match of pattern in text, noting every replacement.
export function replaceInField(
  text: string,
  pattern: RegExp,
  replace: string,
  note: Omit<RecapChange, "before" | "removed" | "added" | "after">,
): { text: string; changes: RecapChange[] } {
  const changes: RecapChange[] = [];
  let result = "";
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    result += text.slice(last, start) + replace;
    changes.push({
      ...note,
      before: contextBefore(text.slice(0, start)),
      removed: match[0],
      added: replace,
      after: contextAfter(text.slice(start + match[0].length)),
    });
    last = start + match[0].length;
  }
  return { text: result + text.slice(last), changes };
}
