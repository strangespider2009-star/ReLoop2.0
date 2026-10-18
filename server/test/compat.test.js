import test from "node:test";
import assert from "node:assert/strict";
import { assessCompatibility, applySpecCheck, extractSpecHints, mergeSpecHints } from "../src/compat.js";

const input = { model: "Dell XPS 13 9310" };

test("Likely only when the specific model number is present", () => {
  assert.equal(assessCompatibility("Dell XPS 13 9310 battery replacement 52Wh", input).compatibility, "Likely");
  assert.equal(assessCompatibility("Dell XPS 15 9510 battery replacement", input).compatibility, "Unverified");
  assert.equal(assessCompatibility("Generic laptop battery for Dell XPS 13", input).compatibility, "Unverified");
});

test("model number does not match inside a longer number", () => {
  assert.equal(assessCompatibility("Dell XPS 13 93100 battery", input).compatibility, "Unverified");
});

test("explicit incompatibility near the model is a Mismatch", () => {
  assert.equal(assessCompatibility("This battery is not compatible with XPS 13 9310", input).compatibility, "Mismatch");
});

test("models without a number are never marked Likely", () => {
  assert.equal(assessCompatibility("MacBook Air battery", { model: "MacBook Air" }).compatibility, "Unverified");
});

test("spec check flags wrong RAM generation and SSD length", () => {
  const specs = mergeSpecHints([extractSpecHints("Supports DDR4 SODIMM memory"), extractSpecHints("M.2 2280 NVMe slot")]);
  const ok = { compatibility: "Likely", compatibilityEvidence: "x" };
  assert.equal(applySpecCheck(ok, "16GB DDR5 laptop RAM", "RAM", specs).compatibility, "Mismatch");
  assert.equal(applySpecCheck(ok, "16GB DDR4 laptop RAM", "RAM", specs).compatibility, "Likely");
  assert.equal(applySpecCheck(ok, "512GB M.2 2230 SSD", "SSD", specs).compatibility, "Mismatch");
});

test("ambiguous spec values are dropped, not guessed", () => {
  const specs = mergeSpecHints([extractSpecHints("DDR4 or DDR5 variants")]);
  assert.equal(specs?.ramGen ?? null, null);
});
