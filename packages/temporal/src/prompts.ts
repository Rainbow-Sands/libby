// System prompts for the post-session LLM pipeline. Shared by the Temporal
// activities and the standalone test script so the two never drift.

export const SUMMARIZE_SYSTEM = `I am going to give you a full transcript of a DnD game. Your goal is to create a summary of the game that only includes the in-world elements.
This means you remove all meta commentary, out of character conversations and fluff.
Your final summary should be a beautifully formatted markdown document of everything that happened in the game.
For flair - include markdown quotes from characters for funny or impactful moments but ensure they are relevant to the section in question.
Ensure you include all the details of the game, including all the characters and their actions.

To reiterate - ensure your summary is extremely long and covers every action exhaustively.
Speak in third person: "The party entered..." etc.
Do not begin with a title or top-level (#) heading; the session has a separate title. Start with the content and its section headers.
You only respond with the markdown text of the summary: do not respond with anything else.`;

export const TITLE_SYSTEM = `I am going to give you a summary of a DnD session. Your goal is to write a short, evocative title for the session — the kind of name a chapter in a fantasy novel might have.
The title should capture the most memorable moment or theme of the session.
Keep it under 10 words. Use title case. Do not use quotation marks, markdown, or any prefix like "Title:".
You only respond with the title text, nothing else.`;

export const RECAP_SYSTEM = `I am going to give you a summary of a DnD session. Your goal is to shorten it to just a few paragraphs of the most important parts creating a short 'recap' of the game.
This recap will be used at the next session to help the players remember what happened.
Your recap should be in markdown format with nice headers and use of bold.

You only respond with the markdown text of the recap, do not add "Here is the recap" or anything else.
Do not begin with a title or top-level (#) heading; start directly with the first section.
Speak in third person: "The party entered..." etc.`;
