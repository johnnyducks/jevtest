import assert from "node:assert/strict";
import { test } from "node:test";
import { isFreePoint } from "../grid.ts";
import { planPath } from "../pathfinding.ts";
import { resolveArea, resolveCardByName, resolveNearestCard } from "../resolve.ts";
import { building, env, grid } from "./helpers.ts";

const idOf = (r: ReturnType<typeof resolveCardByName>) => (r.status === "resolved" ? r.target.id : r.status);

test("names and nicknames resolve to one card anywhere in the building", () => {
  for (const [t, id] of [
    ["Go to Griffey.", "griffey-89"],
    ["Take me to The Kid!", "griffey-89"],
    ["Take me to Rickey Henderson.", "henderson-80"],
    ["visit cal ripken's card", "ripken-82"],
    ["go see the babe", "ruth-33"],
    ["mr october", "jackson-69"],
    ["the big hurt", "thomas-90"],
    ["Ohtani", "ohtani-18"],
  ] as const) {
    assert.equal(idOf(resolveCardByName(building, t)), id, t);
  }
});

test("'Bonds' alone is ambiguous between the two Bonds cards", () => {
  const r = resolveCardByName(building, "Go to Bonds.");
  assert.equal(r.status, "ambiguous");
  if (r.status === "ambiguous") assert.deepEqual(r.options.map((o) => o.id).sort(), ["barry-bonds-87", "bobby-bonds-69"]);
});

test("unknown names are not guessed", () => {
  assert.equal(resolveCardByName(building, "Go to Shoeless Joe").status, "not_found");
  assert.equal(resolveCardByName(building, "go somewhere").status, "not_found");
});

test("restricting to clarification options picks within them only", () => {
  assert.equal(idOf(resolveCardByName(building, "Bobby", ["barry-bonds-87", "bobby-bonds-69"])), "bobby-bonds-69");
  assert.equal(resolveCardByName(building, "Griffey", ["barry-bonds-87", "bobby-bonds-69"]).status, "not_found");
});

test("nearest card is on the current floor, by route length", () => {
  const r = resolveNearestCard(env, grid, env.defaultPose);
  assert.equal(r.status, "resolved");
  if (r.status !== "resolved") return;
  const best = env.cards
    .map((c) => ({ id: c.id, p: planPath(grid, env.defaultPose, c.approach) }))
    .filter((x) => x.p.status === "ok")
    .sort((a, b) => a.p.length - b.p.length)[0];
  assert.equal(r.target.id, best.id);
  assert.ok(env.cards.some((c) => c.id === r.target.id), "a floor-1 card");
});

test("'other side' resolves to a free point across the floor", () => {
  const r = resolveArea(env, grid, env.defaultPose, "Go to the other side of the room");
  assert.equal(r.status, "resolved");
  if (r.status !== "resolved") return;
  assert.ok(r.target.point.x > env.width / 2);
  assert.ok(isFreePoint(grid, r.target.point));
});
