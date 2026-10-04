import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFacts, selectFacts } from "../facts.ts";
import { WikipediaClient, wikiFacts } from "../wikipedia.ts";
import { answerLine } from "../../live/lines.ts";
import { martySay } from "../../voice/openai.ts";
import { fixtureData, fixtureStore, griffeyCard, service, wikiFetch } from "./helpers.ts";

test("1. importing a small Lahman dataset builds players, careers, teams and ranks", () => {
  const d = fixtureData();
  assert.equal(d.meta.dataset, "Lahman Baseball Database");
  assert.equal(d.meta.seasonsThrough, 2009);
  assert.match(d.meta.license, /CC BY-SA 3\.0/);
  assert.ok(d.players.griffke02 && d.players.suzukic01);
  assert.ok(d.teams["SEA-1989"], "team season imported for a detailed player's team");
  const s94 = d.players.griffke02.seasons.find((s) => s.year === 1994)!;
  assert.equal(s94.bat.HR, 40);
  assert.equal(s94.ranks.HR, 1, "league rank computed against the whole league-year");
  assert.equal(d.index.length, 8, "every person is indexed");
});

test("2. a player resolves from the canonical Lahman id", () => {
  const store = fixtureStore();
  const c = store.getCareer("griffke02")!;
  assert.equal(c.name, "Ken Griffey Jr.");
  assert.equal(c.debutYear, 1989);
  assert.equal(store.getPlayerProfile("griffke02")!.bio.birth.city, "Donora");
  assert.equal(store.getCareer("nobody99"), null);
});

test("3. career and season-specific statistics", () => {
  const store = fixtureStore();
  const s = store.getPlayerSeason("griffke02", 1989)!;
  assert.deepEqual([s.bat.G, s.bat.HR, s.bat.SB], [127, 16, 16]);
  assert.equal(store.getPlayerSeason("griffke02", 1990), null, "season not in fixture → null, not zero");
  const career = store.getCareer("griffke02")!;
  assert.equal(career.bat!.HR, 16 + 40 + 56 + 19, "career totals sum the imported seasons");
  assert.equal(store.getTeamSeason("SEA", 1989)!.W, 73);
});

test("4. a known card connects to the right player and its issue-year season", () => {
  assert.equal(griffeyCard.player.lahmanId, "griffke02");
  assert.equal(griffeyCard.meta.issueYear, 1989);
  assert.equal(griffeyCard.meta.seasonRepresented, null, "season pictured is unknown, not guessed");
  const f = buildFacts(fixtureStore(), "griffke02", { card: griffeyCard }).find((x) => x.kind === "card_season")!;
  assert.match(f.text, /In 1989, the year this card was issued/);
  assert.match(f.text, /\.264 with 16 home runs/);
  assert.match(f.text, /at age 19/, "season age as of June 30 (born November 1969)");
  assert.match(f.text, /rookie season/);
});

test("5. an identified card returns sourced facts", async () => {
  const { facts } = await service().getInterestingFacts("griffey-89", { limit: 3 });
  assert.equal(facts.length, 3);
  for (const f of facts) {
    assert.equal(f.source.name, "Lahman Baseball Database");
    assert.equal(f.source.version, "test fixture");
    assert.equal(f.verification, "dataset");
    assert.equal(f.subject.playerId, "griffke02");
  }
});

test("6. an ambiguous name never invents an identity", async () => {
  const store = fixtureStore();
  const r = store.resolvePlayer("tell me about Ken Griffey");
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(r.status === "ambiguous" && r.options.map((o) => o.playerId).sort(), ["griffke01", "griffke02"]);
  const b = await service().bundle({ trigger: "ask", text: "what about Bonds?" });
  assert.equal(b.status, "ambiguous");
  assert.deepEqual(b.facts, []);
  assert.equal(store.resolvePlayer("Ken Griffey Jr. please").status, "resolved");
  assert.equal(store.resolvePlayer("who is Zzyzx").status, "not_found");
  const reply = answerLine("amy", await service().bundle({ trigger: "ask", text: "tell me about Ken Griffey" }), { level: 80, range: 28, reserve: 10 }, "parked");
  assert.match(reply, /Ken Griffey Jr\. \(1989–2010\) or Ken Griffey \(1973–1991\)/);
});

test("7. commentary is generated from retrieved facts (model prompt and built-in voice)", async () => {
  const bundle = await service().bundle({ trigger: "navigate", cardId: "griffey-89" });
  const fact = bundle.facts[0];
  assert.ok(fact);
  const say = (fallback: string) => ({ kind: "arrive" as const, to: ["amy"], instruction: "You just pulled up to the card.", facts: "arrived at: Ken Griffey Jr.", fallback, knowledge: bundle, history: [] });

  // Built-in voice quotes the fact verbatim.
  delete process.env.OPENAI_API_KEY;
  const local = await martySay(say(`Made it. While I'm here: ${fact.text}`));
  assert.equal(local.source, "built-in");
  assert.ok(local.text.includes(fact.text));

  // With a model, the fact and its provenance are in the prompt; the reply is the model's.
  process.env.OPENAI_API_KEY = "sk-test";
  const realFetch = globalThis.fetch;
  let sent = "";
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response(JSON.stringify({ model: "gpt-test", choices: [{ message: { content: "Off to Griffey. Fun one coming up." } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  try {
    const r = await martySay(say("unused"));
    assert.equal(r.source, "openai");
    assert.ok(sent.includes("BASEBALL FACTS"));
    assert.ok(sent.includes(JSON.stringify(fact.text).slice(1, -1)));
    assert.ok(sent.includes("trigger: navigate"));
    assert.ok(sent.includes("LIVE SHOW"), "live rules are part of the prompt");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
  }
});

test("9. revisiting a card selects a different fact when one exists", async () => {
  const svc = service();
  const first = await svc.getInterestingFacts("griffey-89");
  const again = await svc.getInterestingFacts("griffey-89", { exclude: first.facts.map((f) => f.id), recentKinds: first.facts.map((f) => f.kind) });
  assert.ok(first.facts[0] && again.facts[0]);
  assert.notEqual(again.facts[0].id, first.facts[0].id);
  assert.notEqual(again.facts[0].kind, first.facts[0].kind, "variety: a different kind of fact");
  // Selection is by interest, not row order.
  const all = buildFacts(fixtureStore(), "griffke02", { card: griffeyCard });
  assert.equal(selectFacts(all)[0].score, Math.max(...all.map((f) => f.score)));
});

test("10. Wikipedia facts are attributed, cached, and optional", async () => {
  const ok = wikiFetch({ extract: "George Kenneth Griffey Jr. is an American former professional baseball center fielder. He was elected to the Hall of Fame in 2016 with what was then the highest percentage ever recorded. Nicknamed \"The Kid\", he was one of the most prolific home run hitters." });
  const client = new WikipediaClient({ fetchImpl: ok.impl, cacheDir: null });
  const s1 = await client.fetchSummary("Ken Griffey Jr.");
  await client.fetchSummary("Ken Griffey Jr.");
  assert.equal(ok.calls(), 1, "second lookup served from cache");
  const facts = wikiFacts(s1, { playerId: "griffke02", name: "Ken Griffey Jr." });
  assert.ok(facts.length >= 1);
  assert.equal(facts[0].verification, "sourced");
  assert.equal(facts[0].source.name, "Wikipedia");
  assert.equal(facts[0].source.url, "https://en.wikipedia.org/wiki/Ken_Griffey_Jr.");
  assert.match(facts[0].source.version, /123456/);
  assert.deepEqual(wikiFacts({ ...s1!, type: "disambiguation" }, { playerId: "x", name: "x" }), [], "disambiguation pages are rejected");

  // Down: no exception, and the Lahman facts still flow.
  const down = wikiFetch("down");
  const svc = service(new WikipediaClient({ fetchImpl: down.impl, cacheDir: null }));
  const b = await svc.bundle({ trigger: "ask", text: "Tell me about Ken Griffey Jr." });
  assert.equal(b.status, "resolved");
  assert.ok(b.facts.length > 0 && b.facts.every((f) => f.source.name === "Lahman Baseball Database"));
  assert.equal(down.calls(), 1);
  await svc.bundle({ trigger: "ask", text: "Ken Griffey Jr. again" });
  assert.equal(down.calls(), 1, "failures are negatively cached, not retried every message");

  // Proactive commentary never waits on the network.
  const slow = new WikipediaClient({ fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch, cacheDir: null });
  const t0 = Date.now();
  const nav = await service(slow).bundle({ trigger: "navigate", cardId: "griffey-89" });
  assert.ok(Date.now() - t0 < 500 && nav.facts.length === 1);
});
