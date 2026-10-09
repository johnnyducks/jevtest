import assert from "node:assert/strict";
import test from "node:test";
import { computePlan } from "../plan.ts";

const plan = (projects: string[], answers: Record<string, string> = {}) => computePlan({ projects, answers });

test("a same-spot water heater swap is a renovation with plumbing, no plans, no zoning", () => {
  const p = plan(["waterheater"], { gas: "No" });
  assert.equal(p.permit, true);
  assert.equal(p.clsName, "Renovation");
  assert.deepEqual(p.disc.sort(), ["E", "P"]);
  assert.equal(p.plans, false);
  assert.equal(p.zoning, "no");
  assert.ok(p.docs.some((d) => d.id === "spec"));
});

test("a gas water heater adds the mechanical section instead of electrical", () => {
  const p = plan(["waterheater"], { gas: "Yes" });
  assert.deepEqual(p.disc.sort(), ["M", "P"]);
  assert.ok(p.insp.includes("Gas / mechanical rough"));
});

test("a deck is new construction that needs zoning first, plans and a footing inspection", () => {
  const p = plan(["deck"], { electric: "No", flood: "No" });
  assert.equal(p.clsName, "Addition / new construction");
  assert.equal(p.zoning, "yes");
  assert.equal(p.plans, true);
  assert.equal(p.prior[0].who, "Zoning Office");
  assert.ok(p.insp.includes("Footing"));
  assert.ok(p.docs.some((d) => d.id === "deck"));
});

test("a small shed needs zoning but no construction permit", () => {
  const p = plan(["shed"], { bigShed: "No" });
  assert.equal(p.permit, false);
  assert.equal(p.zoning, "yes");
  assert.equal(p.docs.some((d) => d.id === "jacket"), false);
  assert.match(p.notes.join(" "), /200 sq ft/);
});

test("an unsure shed size is treated as the larger case", () => {
  const p = plan(["shed"], { bigShed: "Not sure" });
  assert.equal(p.permit, true);
  assert.ok(p.disc.includes("B"));
});

test("moving walls in a kitchen makes it an alteration with plans and fire", () => {
  const p = plan(["kitchen"], { walls: "Yes", plumbing: "Yes", electric: "Yes", gas: "No" });
  assert.equal(p.clsName, "Alteration");
  assert.equal(p.plans, true);
  assert.deepEqual(p.disc.sort(), ["B", "E", "F", "P"]);
  assert.ok(p.docs.some((d) => d.id === "smoke"));
});

test("interior work combined with exterior work asks to check zoning", () => {
  const p = plan(["bath", "roof"]);
  assert.equal(p.zoning, "check");
});

test("a flood zone answer adds the floodplain approval and application", () => {
  const yes = plan(["bath"], { flood: "Yes" });
  assert.deepEqual(yes.prior.map((x) => [x.who, x.need]), [["Floodplain administrator", "yes"]]);
  assert.ok(yes.docs.some((d) => d.id === "flood"));
  const unsure = plan(["bath"], { flood: "Not sure" });
  assert.equal(unsure.prior[0].need, "check");
});

test("documents are never listed twice", () => {
  const p = plan(["pool", "generator", "addition", "hvac"], { gas: "Yes", soil: "Yes" });
  const ids = p.docs.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});
