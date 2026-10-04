import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reachable } from "../../catalog/server.ts";
import { BUILDING, decorHost, floorEnv } from "../../twin/environment.ts";
import { checkModel, modelInfo, removeModel, saveModel } from "../server.ts";

test("succulents: on furniture they're decoration; on the floor they're obstacles", () => {
  const decor = BUILDING.decor ?? [];
  assert.ok(decor.length >= 6);
  for (const d of decor) {
    const floor = BUILDING.floors.find((f) => f.level === d.floor)!;
    const planter = floorEnv(BUILDING, d.floor).obstacles.find((o) => o.id === d.id);
    if (decorHost(floor, d)) assert.equal(planter, undefined, `${d.id} sits on furniture`);
    else assert.equal(planter?.kind, "planter", `${d.id} stands on the floor`);
    assert.ok(d.x > 0 && d.x < BUILDING.width && d.y > 0 && d.y < BUILDING.height, `${d.id} is inside the floor`);
  }
});

test("succulents don't block any card (only the vault's Wagner is out of reach, by design)", () => {
  assert.deepEqual(
    BUILDING.cards.filter((c) => !reachable(c)).map((c) => c.id),
    ["wagner-t206"],
  );
});

test("plant model: only a GLB is accepted, with plain-language reasons", () => {
  const glb = new Uint8Array(32);
  glb.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
  assert.equal(checkModel(glb), null);
  assert.match(checkModel(new Uint8Array([0x50, 0x4b, 3, 4, ...new Array(30).fill(0)]))!, /ZIP/);
  assert.match(checkModel(new TextEncoder().encode('{"asset":{"version":"2.0"}}'))!, /\.gltf/);
  assert.match(checkModel(new Uint8Array(4))!, /too small/);
});

test("plant model: saved to the data folder, removable", () => {
  process.env.MARTY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "marty-decor-"));
  try {
    assert.equal(modelInfo(), null);
    const glb = new Uint8Array(64);
    glb.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
    assert.equal(saveModel(glb).bytes, 64);
    assert.ok(fs.existsSync(path.join(process.env.MARTY_DATA_DIR, "models", "succulent.glb")));
    removeModel();
    assert.equal(modelInfo(), null);
  } finally {
    fs.rmSync(process.env.MARTY_DATA_DIR!, { recursive: true, force: true });
    delete process.env.MARTY_DATA_DIR;
  }
});
