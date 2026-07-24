export interface FinalizableActivation {
  finish: () => Promise<void>;
}

// Start every finalizer before waiting so simultaneous speakers are flushed in
// parallel. A failed clip must not prevent the remaining clips from finishing.
export async function finishActiveActivations(
  activations: Iterable<FinalizableActivation>,
): Promise<void> {
  await Promise.allSettled([...activations].map((activation) => activation.finish()));
}
