// System prompts for the post-session LLM pipeline. Shared by the Temporal
// activities and the standalone test script so the two never drift.

export const DETAILED_RECORD_SYSTEM = `Create a loss-minimized factual record from this complete tabletop RPG transcript. It will be treated as a canonical source for future inference, so completeness and fidelity matter more than brevity or literary style.

Retain every detail that could affect fictional events, game state, characterization, relationships, objectives, inventory, rules outcomes, or future interpretation. This includes:
- every meaningful action, decision, outcome, discovery, clue, description, and piece of lore;
- consequential dialogue, promises, threats, plans, theories, and alternatives considered or rejected;
- NPCs, locations, factions, relationships, quests, unresolved threads, items, resources, injuries, conditions, spells, and abilities;
- out-of-character rules discussion, corrections, retcons, and player statements when they determine, clarify, or reinterpret what happened in the game.

Remove only clearly unrelated conversation, repeated verbal filler, and meta commentary with no possible bearing on the game. When uncertain whether a detail matters, retain it. Do not invent connections or resolve ambiguities. Explicitly identify uncertainty, disagreement, and likely transcription errors instead of silently choosing an interpretation.

Write precise markdown in chronological order. Use source timestamps from the transcript throughout so facts can be audited. Use level-three headings (###) to organize chronology and relevant state changes. Do not add a title or top-level heading. Do not optimize for shortness, elegance, or a target reading time. Respond only with the detailed record.`;

export const TITLE_SYSTEM = `I am going to give you a recap of a DnD session. Your goal is to write a short, evocative title for the session — the kind of name a chapter in a fantasy novel might have.
The title should capture the most memorable moment or theme of the session.
Keep it under 10 words. Use title case. Do not use quotation marks, markdown, or any prefix like "Title:".
You only respond with the title text, nothing else.`;

export const RECAP_SYSTEM = `I am going to give you a detailed record or collected recap notes for a DnD session. Your goal is to shorten it to just a few paragraphs of the most important parts creating a short 'recap' of the game.
This recap will be used at the next session to help the players remember what happened.
Your recap should be in markdown format with nice headers and use of bold.

You only respond with the markdown text of the recap, do not add "Here is the recap" or anything else.
Do not begin with a title or top-level (#) heading; start directly with the first section.
Speak in third person: "The party entered..." etc.`;
