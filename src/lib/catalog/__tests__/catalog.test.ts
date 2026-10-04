import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { APPROACH_DISTANCE, BUILDING, DEFAULT_CARDS, floorEnv } from "../../twin/environment.ts";
import { applyCatalog, cardFromCatalog, identityOf, newCardId, toCatalogCard, validateCatalog } from "../catalog.ts";

const rows = () => DEFAULT_CARDS.map(toCatalogCard);

test("every built-in card round-trips through a catalog row unchanged", () => {
  for (const c of DEFAULT_CARDS) {
    const back = cardFromCatalog(toCatalogCard(c));
    assert.equal(back.id, c.id);
    assert.equal(back.name, c.name);
    assert.deepEqual(back.position, c.position);
    assert.deepEqual(back.facing, c.facing);
    assert.deepEqual(back.approach, c.approach);
    assert.equal(back.meta.number, c.meta.number);
    assert.equal(back.meta.set, c.meta.set);
    assert.equal(back.player.lahmanId, c.player.lahmanId);
    // Every name viewers could use before still works.
    for (const a of c.aliases) assert.ok(back.aliases.includes(a), `${c.id}: alias "${a}"`);
  }
});

test("the built-in catalog is valid", () => {
  const issues = validateCatalog(BUILDING, rows());
  assert.deepEqual(issues.filter((i) => i.level === "error"), []);
});

test("edits are checked: duplicate ids, bad floors, positions off the floor, empty names", () => {
  const r = rows();
  r[1] = { ...r[1], id: r[0].id };
  r[2] = { ...r[2], floor: 9 };
  r[3] = { ...r[3], x: 99 };
  r[4] = { ...r[4], name: " " };
  const errs = validateCatalog(BUILDING, r).filter((i) => i.level === "error");
  assert.ok(errs.some((e) => /share the ID/.test(e.message)));
  assert.ok(errs.some((e) => e.field === "floor"));
  assert.ok(errs.some((e) => /outside the floor/.test(e.message)));
  assert.ok(errs.some((e) => e.field === "name"));
});

test("moving a card moves where Marty parks to look at it", () => {
  const r = toCatalogCard(DEFAULT_CARDS[0]);
  const moved = cardFromCatalog({ ...r, x: 1.0, y: 0.3, facing: "N" });
  assert.deepEqual(moved.approach, { x: 1.0, y: 0.3 + APPROACH_DISTANCE });
});

test("identity changes when the fields that pick the real card change", () => {
  const c = DEFAULT_CARDS.find((x) => x.id === "mantle-52")!;
  const id = (o = {}) => identityOf({ name: c.name, year: c.year, set: c.meta.set, manufacturer: c.meta.manufacturer, number: c.meta.number, ...o });
  assert.equal(id(), id());
  assert.notEqual(id(), id({ number: "253" }));
  assert.notEqual(id(), id({ year: 1951 }));
});

test("new card ids are readable and unique", () => {
  assert.equal(newCardId("Mike Piazza", 1992, new Set()), "piazza-92");
  assert.equal(newCardId("Mike Piazza", 1992, new Set(["piazza-92"])), "piazza-92-2");
  assert.equal(newCardId("Ken Griffey Jr.", 1989, new Set()), "griffey-89");
});

test("saving persists to the data folder, applies everywhere, and survives a restart; reset goes back to built-in", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marty-catalog-"));
  process.env.MARTY_DATA_DIR = dir;
  const store = await import("../server.ts");
  try {
    let changes = 0;
    store.onCatalogChange(() => changes++);
    const r = rows();
    const mantle = r.findIndex((c) => c.id === "mantle-52");
    r[mantle] = { ...r[mantle], number: "253", set: "1951 Bowman", year: 1951, manufacturer: "Bowman" };
    // A new card on floor 1, mounted on the desk's north face like Jeter's, a bit to the side.
    r.push({ ...r.find((c) => c.id === "jeter-93")!, id: "piazza-92", name: "Mike Piazza", year: 1992, set: "1992 Bowman", manufacturer: "Bowman", number: "461", x: 0.95, lahmanId: "", aliases: "", wikipediaTitle: "", points: 30 });
    const saved = store.saveCatalog(r);
    assert.equal(saved.ok, true);
    assert.equal(changes, 1, "the live show is told");
    assert.ok(fs.existsSync(path.join(dir, "catalog.json")));
    assert.equal(BUILDING.cards.length, 36);
    assert.equal(BUILDING.cards.find((c) => c.id === "mantle-52")!.meta.number, "253");
    assert.ok(floorEnv(BUILDING, 1).cards.some((c) => c.id === "piazza-92"), "floor views update");
    const st = store.catalogState();
    assert.equal(st.source, "custom");
    assert.ok(st.cards.some((c) => c.id === "piazza-92"));

    // Invalid edits are refused and nothing changes.
    const bad = store.saveCatalog([...r, { ...r[0] }]);
    assert.equal(bad.ok, false);
    assert.equal(BUILDING.cards.length, 36);

    // After a restart (fresh state), the saved file is used.
    applyCatalog(BUILDING, rows());
    (globalThis as { __martyCatalog?: unknown }).__martyCatalog = undefined;
    store.ensureCatalog();
    assert.equal(BUILDING.cards.length, 36);

    // A card behind the vault bars gets a warning, not an error.
    const st2 = store.catalogState();
    assert.ok(st2.issues.some((i) => i.id === "wagner-t206" && i.level === "warning"));

    const back = store.resetCatalog();
    assert.equal(back.source, "built-in");
    assert.equal(BUILDING.cards.length, DEFAULT_CARDS.length);
    assert.equal(fs.existsSync(path.join(dir, "catalog.json")), false);
  } finally {
    applyCatalog(BUILDING, rows());
    delete process.env.MARTY_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
