import assert from "node:assert/strict";
import test from "node:test";
import { ENVIRONMENT } from "../../twin/environment.ts";
import { LOOKUP, pickMatch, type SearchHit } from "../match.ts";

const hit = (o: Partial<SearchHit>): SearchHit => ({ type: "card", id: "x", name: "Mickey Mantle", year: "1952", releaseName: "1952 Topps", setName: "Base", cardNumber: "311", relevance: 1, ...o });

test("every card in the room has a lookup hint", () => {
  for (const c of ENVIRONMENT.cards) assert.ok(LOOKUP[c.id], c.id);
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
