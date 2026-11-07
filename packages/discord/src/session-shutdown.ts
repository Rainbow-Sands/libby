export interface FinalizableActivation {
  finish: () => Promise<void>;
  // Force the clip to stop now (kill its encoder). Its finish() promise must
  // settle soon after.
  abort?: () => void;
}

export interface FinishOptions {
  // How long one clip may take to finalize before it is aborted.
  timeoutMs?: number;
  // How long to keep waiting for an aborted clip before giving up on it.
  abortGraceMs?: number;
}

export const FINALIZE_TIMEOUT_MS = 30_000;
export const ABORT_GRACE_MS = 5_000;

function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const settled = promise.then(
    () => true,
    () => true,
  );
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}

// Start every finalizer before waiting so simultaneous speakers are flushed in
// parallel. A failed or stuck clip must not prevent the remaining clips, or the
// session shutdown, from finishing: a clip still finalizing after the deadline
// is aborted, and one that still hasn't settled after that is given up on.
export async function finishActiveActivations(
  activations: Iterable<FinalizableActivation>,
  { timeoutMs = FINALIZE_TIMEOUT_MS, abortGraceMs = ABORT_GRACE_MS }: FinishOptions = {},
): Promise<void> {
  await Promise.all(
    [...activations].map(async (activation) => {
      let finishing: Promise<void>;
      try {
        finishing = activation.finish();
      } catch {
        return;
      }
      if (await settlesWithin(finishing, timeoutMs)) return;
      console.error(`[session] clip still finalizing after ${timeoutMs}ms, aborting`);
      activation.abort?.();
      if (await settlesWithin(finishing, abortGraceMs)) return;
      console.error(`[session] aborted clip did not settle, continuing shutdown`);
    }),
  );
}
