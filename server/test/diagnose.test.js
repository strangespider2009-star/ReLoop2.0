import test from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../src/diagnose.js";

const base = { deviceType: "Laptop", component: "" };

test("slow laptop points to SSD and RAM", () => {
  const d = diagnose({ ...base, problem: "My laptop is very slow and freezes while booting" });
  assert.deepEqual(d.hardwareComponents, ["SSD", "RAM"]);
});

test("battery drain points to Battery only", () => {
  assert.deepEqual(diagnose({ ...base, problem: "battery drains in 40 minutes" }).hardwareComponents, ["Battery"]);
});

test("curly apostrophes are handled", () => {
  const d = diagnose({ ...base, problem: "laptop won’t charge" });
  assert.ok(d.hardwareComponents.includes("Charger"));
});

test("wifi problem is software only", () => {
  const d = diagnose({ ...base, problem: "wifi keeps disconnecting" });
  assert.equal(d.softwareOnly, true);
  assert.deepEqual(d.hardwareComponents, []);
});

test("explicit component overrides derived ones", () => {
  assert.deepEqual(diagnose({ ...base, component: "Keyboard", problem: "laptop is slow" }).hardwareComponents, ["Keyboard"]);
});

test("components not available for the device are filtered", () => {
  const d = diagnose({ deviceType: "Smartphone", component: "", problem: "phone is slow" });
  assert.deepEqual(d.hardwareComponents, []);
});
