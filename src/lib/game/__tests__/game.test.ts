import assert from "node:assert/strict";
import test from "node:test";
import { ENVIRONMENT } from "../../twin/environment.ts";
import { Game } from "../game.ts";

// Everything but the locked vault card can hold a bonus.
const reachable = (c: { id: string }) => c.id !== "wagner-t206";

test("bonuses spawn over time on reachable cards only, and expire", () => {
  const g = new Game(ENVIRONMENT.cards, reachable, { seed: 1, now: 0, config: { spawnEverySec: [10, 10], lifetimeSec: [30, 30], maxActive: 2 } });
  const spawned = [];
  for (let t = 0; t <= 200_000; t += 1000) spawned.push(...g.tick(t).spawned);
  assert.ok(spawned.length >= 5);
  assert.ok(spawned.every((b) => b.cardId !== "wagner-t206"), "never inside the locked vault");
  assert.ok(g.snapshot(200_000).bonuses.length <= 2, "max active respected");
  assert.ok(spawned.every((b) => b.points >= 20 && b.points <= 80 && b.points % 5 === 0));
});

test("same seed, same game", () => {
  const run = () => {
    const g = new Game(ENVIRONMENT.cards, reachable, { seed: 42, now: 0 });
    const out: string[] = [];
    for (let t = 0; t <= 300_000; t += 1000) out.push(...g.tick(t).spawned.map((b) => `${b.cardId}:${b.points}`));
    return out;
  };
  assert.deepEqual(run(), run());
});

test("arriving awards base points plus any bonus; base points have a cooldown", () => {
  const g = new Game(ENVIRONMENT.cards, reachable, { seed: 1, now: 0, config: { spawnEverySec: [1, 1], lifetimeSec: [500, 500], maxActive: 1 } });
  g.tick(1000);
  const bonus = g.snapshot(1000).bonuses[0];
  const card = ENVIRONMENT.cards.find((c) => c.id === bonus.cardId)!;
  const a = g.arrive(card.id, "amy", 2000)!;
  assert.equal(a.total, card.points + bonus.points);
  assert.equal(g.snapshot(2000).bonuses.length, 0, "bonus claimed");
  assert.equal(g.arrive(card.id, "bob", 3000), null, "cooldown: nothing left");
  assert.equal(g.arrive(card.id, "bob", 2000 + 120_000)!.base, card.points, "base available again");
  assert.deepEqual(g.snapshot(200_000).scores.map((s) => s.handle), ["amy", "bob"]);
});

test("by default, bonuses are a treat: a few every ten minutes, not a feed", () => {
  const g = new Game(ENVIRONMENT.cards, reachable, { seed: 9, now: 0 });
  let n = 0;
  for (let t = 0; t <= 600_000; t += 1000) n += g.tick(t).spawned.length;
  assert.ok(n >= 2 && n <= 8, `${n} bonuses in 10 minutes`);
});
