import assert from "node:assert/strict";
import test from "node:test";
import { fakeJev, makeSession, martyLines, systemLines } from "./helpers.ts";

test("multi-stop request: Jev decides, Marty visits every stop in order and the requester earns the points", async () => {
  const { s, run, jev } = makeSession();
  assert.equal(s.post("amy", "go to ripken, then barry bonds, then mantle").ok, true);
  await run(1.2);
  assert.equal(jev.calls.length, 1, "one batch, one Jev call");
  const trip = s.snapshot().trip!;
  assert.equal(trip.summary, "Cal Ripken Jr. → Barry Bonds → Mickey Mantle");
  assert.equal(trip.status, "running");
  await run(60);
  const done = s.snapshot();
  assert.equal(done.trip!.status, "done");
  assert.deepEqual(done.trip!.stops.map((x) => x.done), [true, true, true]);
  assert.deepEqual(done.game.scores, [{ handle: "amy", points: 25 + 20 + 60 }]);
  assert.match(martyLines(s)[0], /@amy's tour \(Cal Ripken Jr\. → Barry Bonds → Mickey Mantle\)/);
  assert.ok(systemLines(s).some((l) => l.includes("+60 for @amy at Mickey Mantle")));
});

test("battery drains by the distance actually driven, close to the route estimate", async () => {
  const { s, run } = makeSession();
  s.post("amy", "go to griffey");
  await run(1.2);
  const est = s.snapshot().trip!.estimate;
  await run(40);
  const tel = s.snapshot().telemetry;
  const used = 100 - tel.battery.level;
  assert.ok(Math.abs(tel.metersDriven - est.meters) < 0.3, `drove ${tel.metersDriven} m, planned ${est.meters} m`);
  assert.ok(Math.abs(used - est.battery) < 0.6, `used ${used}%, estimated ${est.battery}%`);
  assert.ok(Math.abs(tel.battery.range - (tel.battery.level - 10) / 0.6) < 0.2, "range = battery above reserve ÷ 0.6% per meter");
});

test("typos are corrected deterministically and shown: heanderson → Henderson", async () => {
  const { s, run } = makeSession();
  s.post("bob", "go to heanderson");
  await run(1.2);
  const msg = s.snapshot().chat.find((c) => c.kind === "viewer")!;
  assert.deepEqual(msg.kind === "viewer" && msg.corrections, ["heanderson → henderson"]);
  assert.equal(s.snapshot().trip!.summary, "Rickey Henderson");
});

test("Jev's 'too taxing' judgment declines upstairs; Marty explains and does the other request instead", async () => {
  const jev = fakeJev({ taxing: (m) => (/upstairs/.test(m.text) ? 0.8 : 0.1) });
  const { s, run } = makeSession({ evaluate: jev.evaluate });
  s.operator({ action: "battery", level: 54 });
  s.post("amy", "go upstairs");
  s.post("bob", "pete rose please");
  await run(1.2);
  assert.equal(s.snapshot().trip!.summary, "Pete Rose");
  const line = martyLines(s)[0];
  assert.match(line, /I considered @amy's trip to the mezzanine \(upstairs\), but Jev judged it too taxing right now \(80%\)\./);
  assert.match(line, /Let's do @bob's trip to Pete Rose instead/);
  const trace = s.snapshot().chat.find((c) => c.kind === "marty" && c.decision);
  assert.ok(trace && trace.kind === "marty" && trace.decision!.considered.some((o) => o.handle === "amy" && o.status === "declined"));
});

test("battery reserve rule (incl. the way home) blocks a long lap even when Jev prefers it", async () => {
  const { s, run } = makeSession();
  s.operator({ action: "battery", level: 30 });
  s.post("amy", "do a lap around the room");
  await run(1.2);
  assert.equal(s.snapshot().trip, null, "Marty stays put");
  assert.match(martyLines(s)[0], /I considered @amy's lap around the room, but it needs about \d+% plus \d+% to get back to the dock, and I'm at 30% with a 10% reserve/);
});

test("trips over the time limit are declined", async () => {
  const { s, run } = makeSession({ config: { maxTripSeconds: 10 } });
  s.post("amy", "go to mantle");
  await run(1.2);
  assert.equal(s.snapshot().trip, null);
  assert.match(martyLines(s)[0], /over my 10-second limit/);
});

test("lower-ranked requests wait in the queue and run after the current trip", async () => {
  const { s, run, jev } = makeSession();
  s.post("amy", "go to ripken");
  s.post("bob", "go to robinson");
  await run(1.2);
  assert.equal(s.snapshot().trip!.handle, "amy");
  assert.deepEqual(s.snapshot().queue.map((q) => q.handle), ["bob"]);
  assert.match(martyLines(s)[0], /@bob: you're in the queue/);
  await run(40);
  assert.ok(jev.calls.length >= 2, "queued request reconsidered");
  assert.equal(s.snapshot().trip!.handle, "bob");
  await run(30);
  assert.deepEqual(s.snapshot().game.scores.map((x) => x.handle).sort(), ["amy", "bob"]);
});

test("questions and chat are answered without moving", async () => {
  const { s, run } = makeSession();
  s.post("amy", "how is your battery?");
  s.post("bob", "hi marty");
  await run(1.5);
  assert.equal(s.snapshot().trip, null);
  const lines = martyLines(s);
  assert.ok(lines.some((l) => l.startsWith("@amy, I'm at 100% battery")));
  assert.ok(lines.some((l) => l.startsWith("@bob:")));
});

test("ambiguous and unknown places are explained, never guessed", async () => {
  const { s, run } = makeSession();
  s.post("amy", "go to bonds");
  s.post("bob", "go to zorbleflex");
  await run(1.2);
  assert.equal(s.snapshot().trip, null);
  const line = martyLines(s).join(" ");
  assert.match(line, /@amy, "bonds" could be Barry Bonds or Bobby Bonds/);
  assert.match(line, /@bob, I couldn't find "zorbleflex"/);
});

test("when Jev fails, Marty says so and does not move", async () => {
  const { s, run } = makeSession({
    evaluate: async () => {
      throw new Error("HTTP 503");
    },
  });
  s.post("amy", "go to griffey");
  await run(2);
  assert.equal(s.snapshot().trip, null);
  assert.equal(s.motion.getState().status, "idle");
  assert.match(martyLines(s)[0], /@amy: .*(brain|Jev)/);
  const msg = s.snapshot().chat.find((c) => c.kind === "viewer")!;
  assert.equal(msg.kind === "viewer" && msg.state, "failed");
});

test("without a Jev key Marty never moves on viewer requests", async () => {
  const { s, run } = makeSession({ evaluate: null });
  s.post("amy", "go to griffey");
  await run(2);
  assert.equal(s.snapshot().trip, null);
});

test("handles are validated and each handle is rate limited", () => {
  const { s, clock } = makeSession();
  assert.equal(s.post("a", "hi").ok, false);
  assert.equal(s.post("marty", "hi").ok, false);
  assert.equal(s.post("has space", "hi").ok, false);
  assert.equal(s.post("amy", "").ok, false);
  assert.equal(s.post("amy", "x".repeat(281)).ok, false);
  assert.equal(s.post("@amy", "hi").ok, true);
  const again = s.post("amy", "hi again");
  assert.equal(again.ok === false && again.code, "rate_limited");
  // Several people can share one connection, but one connection can't flood the chat with new handles.
  for (let i = 0; i < 6; i++) assert.equal(s.post(`user${i}`, "hi", "client-1").ok, true);
  const flood = s.post("user9", "hi", "client-1");
  assert.equal(flood.ok === false && flood.code, "rate_limited");
  clock.t += 3001;
  assert.equal(s.post("amy", "hi again").ok, true);
});

test("a burst of messages is decided in one Jev call", async () => {
  const { s, run, clock, jev } = makeSession();
  ["amy", "bob", "cat", "dan"].forEach((h, i) => s.post(h, i % 2 ? "hello" : "go to griffey", `c${i}`));
  clock.t += 10;
  await run(1.5);
  assert.equal(jev.calls.length, 1);
  assert.equal(Object.keys(jev.calls[0].questions).filter((q) => q.startsWith("intent_")).length, 4);
});

test("operator stop while Jev is deciding: the decision is not carried out", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const inner = fakeJev();
  const { s, run, clock } = makeSession({
    evaluate: async (req) => {
      await gate;
      return inner.evaluate(req);
    },
  });
  s.post("amy", "go to griffey");
  clock.t += 1100;
  s.tick(clock.t);
  s.operator({ action: "stop" });
  release();
  await s.settle();
  await run(1);
  assert.equal(s.snapshot().trip, null);
  assert.match(martyLines(s).join(" "), /operator stopped Marty while Jev was deciding/);
});

test("operator stop and resume finish the remaining stops", async () => {
  const { s, run } = makeSession();
  s.post("amy", "ripken then mantle");
  await run(1.2);
  await run(3);
  assert.equal(s.operator({ action: "stop" }).ok, true);
  assert.equal(s.snapshot().trip!.status, "stopped");
  assert.equal(s.motion.getState().status, "stopped");
  assert.equal(s.operator({ action: "resume" }).ok, true);
  assert.equal(s.snapshot().trip!.summary, "Cal Ripken Jr. → Mickey Mantle");
  await run(60);
  assert.equal(s.snapshot().trip!.status, "done");
});

test("low battery after a trip sends Marty to the dock, where he charges", async () => {
  const { s, run } = makeSession();
  s.operator({ action: "battery", level: 22 });
  s.post("amy", "go to rose");
  await run(1.2);
  assert.equal(s.snapshot().trip!.summary, "Pete Rose");
  await run(25);
  assert.ok(systemLines(s).some((l) => l.startsWith("Rule B3")));
  await run(25);
  const tel = s.snapshot().telemetry;
  assert.ok(Math.hypot(tel.pose.x - 0.9, tel.pose.y - 0.9) < 0.45, "at the dock");
  assert.equal(tel.battery.charging, true);
  const before = tel.battery.level;
  await run(2);
  assert.ok(s.snapshot().telemetry.battery.level > before);
});

test("bonuses spawn, show in chat, and pay out to the viewer who sent Marty there", async () => {
  const { s, run } = makeSession({ config: { game: { spawnEverySec: [1, 1], lifetimeSec: [300, 300], maxActive: 1 } } });
  await run(2);
  const bonus = s.snapshot().game.bonuses[0];
  assert.ok(bonus, "a bonus spawned");
  assert.ok(systemLines(s).some((l) => l.startsWith("Bonus!") && l.includes(bonus.cardName)));
  s.post("amy", `go to ${bonus.cardName}`);
  await run(60);
  const card = s.snapshot().game.scores.find((x) => x.handle === "amy");
  assert.ok(card && card.points >= bonus.points, "bonus included");
});

test("reset clears chat, trip, scores and battery", async () => {
  const { s, run } = makeSession();
  s.post("amy", "go to ripken");
  await run(20);
  s.reset();
  const snap = s.snapshot();
  assert.equal(snap.chat.length, 0);
  assert.equal(snap.trip, null);
  assert.equal(snap.game.total, 0);
  assert.equal(snap.telemetry.battery.level, 100);
  assert.deepEqual(snap.telemetry.pose, { x: 1.2, y: 1.4, heading: 0 });
});

test("every viewer gets the snapshot on subscribe and live events after", async () => {
  const { s, run } = makeSession();
  const a: string[] = [];
  const b: string[] = [];
  s.subscribe((e) => a.push(e.type));
  const off = s.subscribe((e) => b.push(e.type));
  assert.equal(s.viewers, 2);
  s.post("amy", "go to ripken");
  await run(2);
  off();
  assert.equal(s.viewers, 1);
  for (const list of [a, b]) {
    assert.equal(list[0], "snapshot");
    assert.ok(list.includes("chat") && list.includes("telemetry") && list.includes("trip"));
  }
});
