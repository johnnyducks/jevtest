import assert from "node:assert/strict";
import test from "node:test";
import { ENVIRONMENT } from "../../twin/environment.ts";
import { hintFor, pickMatch, type SearchHit } from "../match.ts";

const LOOKUP = Object.fromEntries(ENVIRONMENT.cards.map((c) => [c.id, hintFor(c)]));

const hit = (o: Partial<SearchHit>): SearchHit => ({ type: "card", id: "x", name: "Mickey Mantle", year: "1952", releaseName: "1952 Topps", setName: "Base", cardNumber: "311", relevance: 1, ...o });

test("every card in the room has a lookup hint", () => {
  for (const c of ENVIRONMENT.cards) {
    const h = LOOKUP[c.id];
    assert.ok(h.query.includes(c.name), c.id);
    if (c.id !== "wagner-t206" && c.id !== "cobb-t206") assert.ok(h.number, `${c.id} has a card number`);
  }
});

test("exact match: name, year, release and card number agree", () => {
  const m = pickMatch(LOOKUP["mantle-52"], [
    hit({ id: "reprint", year: "1996", releaseName: "1996 Topps Mantle Reprints" }),
    hit({ id: "wrong-number", cardNumber: "999" }),
    hit({ id: "right" }),
  ]);
  assert.equal(m?.hit.id, "right");
  assert.equal(m?.confidence, "exact");
});

test("never guesses: wrong player, wrong year, wrong release, or parallels are rejected", () => {
  const h = LOOKUP["mantle-52"];
  assert.equal(pickMatch(h, [hit({ name: "Mickey Mantle", year: "1953" })]), null);
  assert.equal(pickMatch(h, [hit({ name: "Mickey Vernon" })]), null);
  assert.equal(pickMatch(h, [hit({ releaseName: "1952 Bowman" })]), null);
  assert.equal(pickMatch(h, [hit({ parallelName: "Gold" })]), null);
  assert.equal(pickMatch(h, [hit({ type: "set" })]), null);
  // The known number exists in the catalog but on another card: don't settle for a different one.
  assert.equal(pickMatch(h, [hit({ cardNumber: "101" })]), null);
});

test("Bonds vs Bonds: first names keep Barry and Bobby apart", () => {
  const hits = [hit({ id: "bobby", name: "Bobby Bonds", year: "1987", releaseName: "1987 Topps", cardNumber: "320" }), hit({ id: "barry", name: "Barry Bonds", year: "1987", releaseName: "1987 Topps", cardNumber: "320" })];
  assert.equal(pickMatch(LOOKUP["barry-bonds-87"], hits)?.hit.id, "barry");
});

test("Traded set numbers: '98T' matches exactly; digits-only is a likely match", () => {
  const h = LOOKUP["ripken-82"];
  const base = { name: "Cal Ripken Jr.", year: "1982", releaseName: "1982 Topps Traded" };
  assert.equal(pickMatch(h, [hit({ ...base, cardNumber: "98T" })])?.confidence, "exact");
  assert.equal(pickMatch(h, [hit({ ...base, cardNumber: "98" })])?.confidence, "likely");
  assert.equal(pickMatch(h, [hit({ ...base, name: "Cal Ripken Jr.", releaseName: "1982 Topps", cardNumber: "21" })]), null, "the regular 1982 Topps card is a different card");
});

test("cards without a known number: likely match, base set preferred", () => {
  const h = LOOKUP["wagner-t206"];
  const m = pickMatch(h, [
    hit({ id: "insert", name: "Honus Wagner", year: "1909", releaseName: "1909-11 T206", setName: "Checklist", cardNumber: undefined, relevance: 9 }),
    hit({ id: "base", name: "Honus Wagner", year: "1909", releaseName: "1909-11 T206", setName: "Base", cardNumber: undefined, relevance: 5 }),
  ]);
  assert.equal(m?.hit.id, "base");
  assert.equal(m?.confidence, "likely");
});

test("missing year field: the year is read from the release name", () => {
  const m = pickMatch(LOOKUP["griffey-89"], [hit({ name: "Ken Griffey Jr.", year: undefined, releaseName: "1989 Upper Deck", cardNumber: "1" })]);
  assert.equal(m?.confidence, "exact");
});

test("rejection reasons are specific, for the 'Check card images' screen", async () => {
  const { rejectReason, searchPlan } = await import("../match.ts");
  const h = LOOKUP["mantle-52"];
  assert.match(rejectReason(h, hit({ year: "1953" }))!, /year 1953, wanted 1952/);
  assert.match(rejectReason(h, hit({ releaseName: "1952 Bowman", setName: "Base" }))!, /lacks "topps"/);
  assert.equal(rejectReason(h, hit({})), null);
  // Several searches, most specific first, never duplicated.
  const plans = searchPlan(h);
  assert.ok(plans.length >= 3);
  assert.equal(plans[0].segment, "Baseball");
  assert.equal(new Set(plans.map((p) => JSON.stringify(p))).size, plans.length);
});

test("hints come from the catalog fields: name, year, set, number", () => {
  const card = (o: { name: string; year: number; set: string | null; manufacturer?: string | null; number?: string | null }) => ({
    name: o.name,
    year: o.year,
    meta: { manufacturer: o.manufacturer ?? null, set: o.set, number: o.number ?? null },
  });
  assert.deepEqual(hintFor(card({ name: "Cal Ripken Jr.", year: 1982, set: "1982 Topps Traded", number: "98T" })), {
    query: "1982 Topps Traded Cal Ripken Jr.",
    nameWords: ["cal", "ripken"],
    years: [1982, 1982],
    release: ["topps", "traded"],
    number: "98T",
  });
  assert.deepEqual(hintFor(card({ name: "Honus Wagner", year: 1909, set: "T206" })).years, [1909, 1911], "T206 spans 1909–11");
  assert.equal(hintFor(card({ name: "Ken Griffey Jr.", year: 1989, set: null, manufacturer: "Upper Deck" })).query, "1989 Upper Deck Ken Griffey Jr.");
  assert.equal(hintFor({ ...card({ name: "X", year: 2000, set: "2000 Topps" }), cardsightId: "abc" }).id, "abc", "a pinned ID skips the search");
});

test("a one-name catalog entry (\"Ichiro\") matches the card's player", () => {
  const h = LOOKUP["ichiro-01"];
  assert.equal(pickMatch(h, [hit({ name: "Ichiro", year: "2001", releaseName: "2001 Topps", cardNumber: "726" })])?.confidence, "exact");
  assert.equal(pickMatch(h, [hit({ name: "Suzuki", year: "2001", releaseName: "2001 Topps", cardNumber: "726" })])?.confidence, "exact");
  assert.equal(pickMatch(h, [hit({ name: "Mike", year: "2001", releaseName: "2001 Topps", cardNumber: "726" })]), null);
});
