import { describe, expect, it } from "vitest";
import { finishActiveActivations } from "./session-shutdown.ts";

function deferred() {
  let resolve: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: resolve! };
}

describe("finishActiveActivations", () => {
  it("starts every activation finalizer and waits for all of them", async () => {
    const first = deferred();
    const second = deferred();
    const calls: string[] = [];

    let finished = false;
    const flushing = finishActiveActivations([
      {
        finish: () => {
          calls.push("first");
          return first.promise;
        },
      },
      {
        finish: () => {
          calls.push("second");
          return second.promise;
        },
      },
    ]).then(() => {
      finished = true;
    });

    expect(calls).toEqual(["first", "second"]);
    first.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);

    second.resolve();
    await flushing;
    expect(finished).toBe(true);
  });

  it("one failed finalizer does not prevent the others from finishing", async () => {
    const remaining = deferred();
    let remainingStarted = false;

    const flushing = finishActiveActivations([
      { finish: () => Promise.reject(new Error("broken activation")) },
      {
        finish: () => {
          remainingStarted = true;
          return remaining.promise;
        },
      },
    ]);

    expect(remainingStarted).toBe(true);
    remaining.resolve();
    await expect(flushing).resolves.toBeUndefined();
  });
});
