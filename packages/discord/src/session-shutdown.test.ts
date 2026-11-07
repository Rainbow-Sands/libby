import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("finishActiveActivations deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts a clip that never finalizes without blocking the others", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const healthy = deferred();
    const stuck = deferred();
    let healthyDone = false;
    let aborted = false;

    let finished = false;
    const flushing = finishActiveActivations(
      [
        {
          finish: () => stuck.promise,
          abort: () => {
            aborted = true;
            stuck.resolve();
          },
        },
        {
          finish: () =>
            healthy.promise.then(() => {
              healthyDone = true;
            }),
        },
      ],
      { timeoutMs: 30_000, abortGraceMs: 5_000 },
    ).then(() => {
      finished = true;
    });

    healthy.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(healthyDone).toBe(true);
    expect(aborted).toBe(false);
    expect(finished).toBe(false);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(aborted).toBe(true);
    await flushing;
    expect(finished).toBe(true);
  });

  it("gives up on an aborted clip that still never settles", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let aborted = false;
    let finished = false;
    const flushing = finishActiveActivations(
      [
        {
          finish: () => new Promise<void>(() => {}),
          abort: () => {
            aborted = true;
          },
        },
      ],
      { timeoutMs: 30_000, abortGraceMs: 5_000 },
    ).then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(aborted).toBe(true);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    await flushing;
    expect(finished).toBe(true);
  });
});
