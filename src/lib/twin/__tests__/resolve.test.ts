import assert from "node:assert/strict";
import { test } from "node:test";
import { isFreePoint } from "../grid.ts";
import { planPath } from "../pathfinding.ts";
import { resolveArea, resolveCardByName, resolveNearestCard } from "../resolve.ts";
import { env, grid } from "./helpers.ts";

const idOf = (r: ReturnType<typeof resolveCardByName>) => (r.status === "resolved" ? r.target.id : r.status);

test("Griffey and its aliases resolve to Ken Griffey Jr.", () => {
  for (const t of ["Go to Griffey.", "go to ken griffey jr", "Take me to The Kid!", "GRIFFEY"]) {
    assert.equal(idOf(resolveCardByName(env, t)), "griffey-89", t);
  }
});

test("full names resolve to one card", () => {
  assert.equal(idOf(resolveCardByName(env, "Take me to Rickey Henderson.")), "henderson-80");
  assert.equal(idOf(resolveCardByName(env, "Go to Barry Bonds")), "barry-bonds-87");
  assert.equal(idOf(resolveCardByName(env, "visit cal ripken's card")), "ripken-82");
});

test("'Bonds' alone is ambiguous between the two Bonds cards", () => {
  const r = resolveCardByName(env, "Go to Bonds.");
  assert.equal(r.status, "ambiguous");
  if (r.status === "ambiguous") assert.deepEqual(r.options.map((o) => o.id).sort(), ["barry-bonds-87", "bobby-bonds-69"]);
});

test("unknown names are not guessed", () => {
  assert.equal(resolveCardByName(env, "Go to Babe Ruth").status, "not_found");
  assert.equal(resolveCardByName(env, "go somewhere").status, "not_found");
});

test("restricting to clarification options picks within them only", () => {
  assert.equal(idOf(resolveCardByName(env, "Bobby", ["barry-bonds-87", "bobby-bonds-69"])), "bobby-bonds-69");
  assert.equal(resolveCardByName(env, "Griffey", ["barry-bonds-87", "bobby-bonds-69"]).status, "not_found");
});

test("nearest card uses route length and skips unreachable cards", () => {
  const r = resolveNearestCard(env, grid, env.defaultPose);
  assert.equal(r.status, "resolved");
  if (r.status !== "resolved") return;
  const best = env.cards
    .map((c) => ({ id: c.id, p: planPath(grid, env.defaultPose, c.approach) }))
    .filter((x) => x.p.status === "ok")
    .sort((a, b) => a.p.length - b.p.length)[0];
  assert.equal(r.target.id, best.id);
  assert.notEqual(r.target.id, "wagner-t206");
  // From next to Mantle, Mantle is nearest.
  const near = resolveNearestCard(env, grid, { x: 7.2, y: 7.2, heading: 0 });
  assert.equal(near.status === "resolved" && near.target.id, "mantle-52");
});

test("'other side of the room' resolves to a free point across the room", () => {
  const r = resolveArea(env, grid, env.defaultPose, "Go to the other side of the room");
  assert.equal(r.status, "resolved");
  if (r.status !== "resolved") return;
  assert.ok(r.target.point.x > env.width / 2);
  assert.ok(isFreePoint(grid, r.target.point));
  assert.equal(planPath(grid, env.defaultPose, r.target.point).status, "ok");
});
