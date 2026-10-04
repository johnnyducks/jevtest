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
  await run(300, 200);
  const done = s.snapshot();
  assert.equal(done.trip!.status, "done");
  assert.deepEqual(done.trip!.stops.map((x) => x.done), [true, true, true]);
  assert.deepEqual(done.game.scores, [{ handle: "amy", points: 25 + 20 + 60 }]);
  assert.equal(done.telemetry.floor, 5, "Mantle is on floor 5");
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
  assert.ok(Math.abs(tel.metersDriven - est.meters) < 0.05, `drove ${tel.metersDriven} m, planned ${est.meters} m`);
  assert.ok(Math.abs(used - est.battery) < 0.3, `used ${used}%, estimated ${est.battery}%`);
  assert.ok(Math.abs(tel.battery.range - (tel.battery.level - 10) / 2.5) < 0.02, "range = battery above reserve ÷ 2.5% per meter");
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
  assert.match(line, /I considered @amy's trip to floor 2 \(The '80s & '90s\), but Jev judged it too taxing right now \(80%\)\./);
  assert.match(line, /Let's do @bob's trip to Pete Rose instead/);
  const trace = s.snapshot().chat.find((c) => c.kind === "marty" && c.decision);
  assert.ok(trace && trace.kind === "marty" && trace.decision!.considered.some((o) => o.handle === "amy" && o.status === "declined"));
});

test("battery reserve rule (incl. the way home) blocks a climb to the top floor even when Jev prefers it", async () => {
  const { s, run } = makeSession();
  s.operator({ action: "battery", level: 30 });
  s.post("amy", "take me to the vault");
  await run(1.2);
  assert.equal(s.snapshot().trip, null, "Marty stays put");
  assert.match(martyLines(s)[0], /I considered @amy's trip to floor 6 \(The Vault · Pre-war\), but it needs about \d+% plus \d+% to get back to the dock, and I'm at 30% with a 10% reserve/);
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
  await run(60, 200);
  assert.ok(jev.calls.length >= 2, "queued request reconsidered");
  assert.equal(s.snapshot().trip!.handle, "bob");
  await run(200, 200);
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
  // About 4 s in, Marty is part-way up the first ramp: resume finishes the climb, then the rest.
  assert.ok(s.snapshot().trip!.legs.find((l) => !l.done)?.ramp, "stopped on the ramp");
  assert.equal(s.operator({ action: "resume" }).ok, true);
  assert.equal(s.snapshot().trip!.summary, "Cal Ripken Jr. → Mickey Mantle");
  await run(300, 200);
  assert.equal(s.snapshot().trip!.status, "done");
  assert.deepEqual(s.snapshot().game.scores, [{ handle: "amy", points: 25 + 60 }]);
});

test("low battery after a trip sends Marty to the dock, where he charges", async () => {
  const { s, run } = makeSession();
  s.operator({ action: "battery", level: 22 });
  s.post("amy", "go to trout");
  await run(1.2);
  assert.equal(s.snapshot().trip!.summary, "Mike Trout");
  await run(25);
  assert.ok(systemLines(s).some((l) => l.startsWith("Rule B3")));
  await run(25);
  const tel = s.snapshot().telemetry;
  assert.ok(Math.hypot(tel.pose.x - 0.13, tel.pose.y - 0.5) < 0.05, "at the dock");
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
  await run(300, 200);
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
  assert.deepEqual(snap.telemetry.pose, { x: 0.3, y: 0.5, heading: 0 });
  assert.equal(snap.telemetry.floor, 1);
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

test("climbing a ramp: height rises smoothly, the floor changes on arrival, and climbing costs extra battery", async () => {
  const { s, run } = makeSession();
  s.post("amy", "upstairs");
  await run(1.2);
  let between = false;
  for (let i = 0; i < 60 && s.snapshot().telemetry.floor === 1; i++) {
    await run(0.5);
    const l = s.snapshot().telemetry.level;
    if (l > 1.05 && l < 1.95) between = true;
  }
  assert.ok(between, "seen part-way up the ramp");
  await run(20);
  const tel = s.snapshot().telemetry;
  assert.equal(tel.floor, 2);
  assert.equal(tel.level, 2);
  const drivingOnly = tel.metersDriven * 2.5;
  assert.ok(100 - tel.battery.level > drivingOnly + 2.5, "the climb cost more than flat driving");
});

test("distances in Marty's lines are unit markers, so each viewer sees their own units", async () => {
  const { renderUnits } = await import("../../units.ts");
  const { s, run } = makeSession();
  s.post("amy", "go to griffey");
  await run(1.2);
  const line = martyLines(s)[0];
  assert.match(line, /\{\{m:[\d.]+\}\}/);
  assert.match(renderUnits(line, "imperial"), /about [\d.]+ (in|ft)/);
  assert.match(renderUnits(line, "metric"), /about [\d.]+ (cm|m)/);
});

test("when nobody talks, Marty thinks out loud, less and less often, and only with someone watching", async () => {
  const { s, run } = makeSession({ config: { idleAfterMs: 10_000, idleMaxMs: 80_000 } });
  await run(15, 500);
  assert.equal(s.snapshot().chat.length, 0, "no audience, no musing");
  s.subscribe(() => {});
  await run(11, 500);
  const idle = () => s.snapshot().chat.filter((c) => c.kind === "marty" && c.idle).length;
  assert.equal(idle(), 1, "quiet for 15 s with someone watching: first musing");
  await run(5, 500);
  assert.equal(idle(), 1, "the next one waits twice as long (20 s)");
  await run(10, 500);
  assert.equal(idle(), 2);
  // A viewer speaking resets the clock.
  s.post("amy", "hi marty");
  await run(9, 500);
  assert.equal(idle(), 2);
  const lines = s.snapshot().chat.filter((c) => c.kind === "marty" && c.idle).map((c) => (c as { text: string }).text);
  assert.notEqual(lines[0], lines[1], "different musings");
});

test("BATTERY_CAPACITY scales the battery: at 100×, the trip to the vault is easy even at 30%", async () => {
  const { batteryWithCapacity, BATTERY } = await import("../../twin/battery.ts");
  const { LiveSession } = await import("../session.ts");
  const { building, builtInVoice, fakeJev } = await import("./helpers.ts");
  const big = batteryWithCapacity(100);
  assert.equal(big.perMeter, BATTERY.perMeter / 100);
  assert.equal(big.climbPerMeter, BATTERY.climbPerMeter / 100);
  assert.equal(big.reserve, BATTERY.reserve, "the reserve rule itself is unchanged");
  const clock = { t: 1_000_000 };
  const s = new LiveSession({ building, battery: big, evaluate: fakeJev().evaluate, jevModel: "t", say: builtInVoice, now: () => clock.t, config: { game: { spawnEverySec: [100_000, 100_000] } } });
  s.operator({ action: "battery", level: 30 });
  s.post("amy", "take me to the vault");
  for (let i = 0; i < 12; i++) {
    clock.t += 100;
    s.tick(clock.t);
    await s.settle();
  }
  const trip = s.snapshot().trip;
  assert.ok(trip, "the same request the 1× battery refuses now goes ahead");
  assert.ok(trip!.estimate.battery < 1, `the whole climb costs ${trip!.estimate.battery}%`);
  assert.ok(s.snapshot().telemetry.battery.range > 500, "hundreds of meters of range");
});
