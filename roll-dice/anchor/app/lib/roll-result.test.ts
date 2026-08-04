import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  requiresLiveRollCorrelation,
  shouldCompleteRoll,
  type RollResultSource,
} from "./roll-result.ts";

const completion = (
  overrides: Partial<Parameters<typeof shouldCompleteRoll>[0]> = {},
) =>
  shouldCompleteRoll({
    source: "subscription",
    isPending: true,
    activeGeneration: 4,
    startRollnum: 12,
    newRollnum: 13,
    newValue: 6,
    hasRequestSignature: true,
    requestSlot: null,
    observedSlot: 101,
    ...overrides,
  });

describe("shouldCompleteRoll", () => {
  it("uses a rollnum-advancing account subscription as the fast path", () => {
    assert.equal(completion(), true);
  });

  it("rejects stale, unchanged, and pre-request subscription updates", () => {
    assert.equal(completion({ newRollnum: 12 }), false);
    assert.equal(completion({ newRollnum: 11 }), false);
    assert.equal(completion({ hasRequestSignature: false }), false);
    assert.equal(completion({ startRollnum: null }), false);
    assert.equal(completion({ requestSlot: 102, observedSlot: 101 }), false);
    assert.equal(completion({ requestSlot: 101, observedSlot: 101 }), true);
  });

  it("does not let sync, polling, or warm-up updates complete a user roll", () => {
    for (const source of ["sync", "poll"] satisfies RollResultSource[]) {
      assert.equal(completion({ source }), false);
    }
    assert.equal(completion({ isPending: false }), false);
  });

  it("keeps a saturated counter on the correlated callback path", () => {
    assert.equal(completion({ startRollnum: 255, newRollnum: 255 }), false);
  });

  it("requires the callback to match the active roll generation", () => {
    assert.equal(
      completion({
        source: "callback",
        observedGeneration: 4,
        startRollnum: 255,
        newRollnum: 255,
      }),
      true,
    );
    assert.equal(
      completion({
        source: "callback",
        observedGeneration: 3,
        startRollnum: 255,
        newRollnum: 255,
      }),
      false,
    );
  });
});

describe("requiresLiveRollCorrelation", () => {
  it("keeps ordinary single-in-flight rolls on the account-only hot path", () => {
    assert.equal(requiresLiveRollCorrelation(96, 1), false);
  });

  it("enables live correlation for ambiguous account updates", () => {
    assert.equal(requiresLiveRollCorrelation(null, 1), true);
    assert.equal(requiresLiveRollCorrelation(255, 1), true);
    assert.equal(requiresLiveRollCorrelation(96, 2), true);
  });
});
