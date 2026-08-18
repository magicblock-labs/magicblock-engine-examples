export type RollResultSource = "subscription" | "sync" | "poll" | "callback";

export function requiresLiveRollCorrelation(
  startRollnum: number | null,
  unavailableClientSeeds: number,
): boolean {
  return (
    startRollnum === null || startRollnum >= 255 || unavailableClientSeeds > 1
  );
}

type RollResultCompletion = {
  source: RollResultSource;
  isPending: boolean;
  activeGeneration: number;
  observedGeneration?: number;
  startRollnum: number | null;
  newRollnum: number;
  newValue: number;
  hasRequestSignature: boolean;
  requestSlot: number | null;
  observedSlot?: number;
};

/**
 * Account subscriptions are the lowest-latency signal, but the player account
 * does not store the callback's client seed. In the app's single-in-flight
 * flow, a rollnum increment is the account-state transition we can use
 * directly without another RPC round trip.
 *
 * Once the u8 counter reaches 255, completion stays on the seed-correlated
 * callback path.
 */
export function shouldCompleteRoll({
  source,
  isPending,
  activeGeneration,
  observedGeneration,
  startRollnum,
  newRollnum,
  newValue,
  hasRequestSignature,
  requestSlot,
  observedSlot,
}: RollResultCompletion): boolean {
  if (!isPending || newValue <= 0) return false;

  if (source === "callback") {
    return observedGeneration === activeGeneration;
  }

  if (
    source !== "subscription" ||
    !hasRequestSignature ||
    startRollnum === null ||
    startRollnum >= 255 ||
    newRollnum <= startRollnum
  )
    return false;

  return (
    requestSlot === null ||
    observedSlot === undefined ||
    observedSlot >= requestSlot
  );
}
