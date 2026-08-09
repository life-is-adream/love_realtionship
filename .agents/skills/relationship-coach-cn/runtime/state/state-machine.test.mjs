import test from "node:test";
import assert from "node:assert/strict";
import { transitionState } from "./state-machine.mjs";

test("does not invent progress without a signal", () => {
  const result = transitionState("MUTUAL_FAMILIARITY", {});
  assert.equal(result.to, "MUTUAL_FAMILIARITY");
  assert.equal(result.changed, false);
});

test("supports conservative forward and backward transitions", () => {
  assert.equal(transitionState("UNKNOWN", { initialContact: true }).to, "INITIAL_CONTACT");
  assert.equal(transitionState("INITIAL_CONTACT", { repeatedInteraction: true }).to, "MUTUAL_FAMILIARITY");
  assert.equal(transitionState("MUTUAL_FAMILIARITY", { reciprocalInterest: true }).to, "GROWING_INTEREST");
  assert.equal(transitionState("GROWING_INTEREST", { lowReciprocity: true }).to, "MUTUAL_FAMILIARITY");
});

test("routes conflict through repair and exits after explicit rejection", () => {
  const conflict = transitionState("STABLE_RELATIONSHIP", { conflict: true, evidenceIds: ["obs_1"] });
  assert.equal(conflict.to, "CONFLICT");
  const repair = transitionState(conflict.to, { repairAttempt: true, evidenceIds: ["obs_2"] });
  assert.equal(repair.to, "REPAIR");
  const exit = transitionState("GROWING_INTEREST", { explicitRejection: true, counterOffer: false });
  assert.equal(exit.to, "EXIT");
  assert.equal(exit.reversible, false);
});
