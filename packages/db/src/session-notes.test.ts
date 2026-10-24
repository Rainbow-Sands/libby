import { expect, test } from "vitest";
import { parseSessionLedger } from "./session-notes.ts";

test("ledgers stored with abandoned threads read them as advanced", () => {
  const ledger = parseSessionLedger({
    events: [],
    entities: [],
    loot: [],
    threads: [
      {
        title: "The windmill",
        status: "abandoned",
        note: "They refused to go back.",
        at: "1:02:03",
      },
      { title: "Find the children", status: "resolved", note: "Found.", at: "0:10:00" },
    ],
    quotes: [],
    rulings: [],
    uncertainties: [],
    leftOff: "At the inn.",
  });
  expect(ledger.threads.map((thread) => thread.status)).toEqual(["advanced", "resolved"]);
});
