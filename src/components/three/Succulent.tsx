"use client";

/**
 * Potted succulents for the 3D views. Uses the uploaded model (a .glb, e.g.
 * from Sketchfab) when there is one; otherwise a built-in stand-in made of a
 * glazed bowl and a few echeveria rosettes. Either way the template is
 * normalised to a 1-unit-wide pot standing on y = 0, then scaled per plant.
 */
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Building, decorHost } from "@/lib/twin/environment";
import { HEIGHTS, toScene } from "@/lib/twin/space3d";

/** Fired after the plant model is uploaded or removed, so open 3D views reload it. */
export const DECOR_CHANGED = "marty:decor-changed";

export interface PlantTemplates {
  /** One or more templates; plants take turns (the built-in has two pot colours). */
  variants: THREE.Object3D[];
  source: "uploaded" | "built-in";
}

/** Scale a model to 1 unit across, centred, base on y = 0. */
function normalise(obj: THREE.Object3D): THREE.Object3D {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const across = Math.max(size.x, size.z) || 1;
  obj.position.set(obj.position.x - center.x, obj.position.y - box.min.y, obj.position.z - center.z);
  const wrap = new THREE.Group();
  wrap.add(obj);
  wrap.scale.setScalar(1 / across);
  wrap.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  return wrap;
}

/** A rosette's leaves (fleshy ellipsoids in rings, opening outward), merged into one geometry with vertex colours. */
function rosette(at: THREE.Vector3, radius: number, rng: () => number, tint: THREE.Color): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const rings = 4;
  for (let r = 0; r < rings; r++) {
    const n = 9 - r;
    const len = radius * (1 - r * 0.2);
    const tilt = 0.35 + r * 0.36; // outer leaves lie flat, inner ones stand up
    const shade = new THREE.Color().copy(tint).lerp(new THREE.Color("#d8e6c8"), r * 0.16);
    for (let i = 0; i < n; i++) {
      const g = new THREE.SphereGeometry(0.5, 10, 6);
      g.scale(len, len * 0.22, len * 0.42);
      g.translate(len / 2, 0, 0);
      const yaw = (i / n) * Math.PI * 2 + r * 0.4 + rng() * 0.15;
      const m = new THREE.Matrix4()
        .makeTranslation(at.x, at.y + r * radius * 0.1, at.z)
        .multiply(new THREE.Matrix4().makeRotationY(yaw))
        .multiply(new THREE.Matrix4().makeRotationZ(tilt));
      g.applyMatrix4(m);
      const colors = new Float32Array(g.attributes.position.count * 3);
      const tip = new THREE.Color("#c98a8a");
      const pos = g.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        // A blush at the leaf tips, like a sun-stressed echeveria.
        const dx = pos.getX(v) - at.x;
        const dz = pos.getZ(v) - at.z;
        const k = Math.max(0, Math.hypot(dx, dz) / len - 0.75) * 1.6;
        const c = shade.clone().lerp(tip, Math.min(0.5, k));
        colors.set([c.r, c.g, c.b], v * 3);
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      g.deleteAttribute("uv");
      out.push(g);
    }
  }
  return out;
}

function builtInPlant(potColor: string, seed: number): THREE.Object3D {
  let s = seed;
  const rng = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const group = new THREE.Group();
  // Bowl: a lathe profile, 1 unit across, 0.36 tall, with a rolled rim.
  const profile = [
    [0, 0],
    [0.3, 0],
    [0.34, 0.02],
    [0.46, 0.2],
    [0.5, 0.34],
    [0.49, 0.36],
    [0.46, 0.35],
    [0.43, 0.3],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), new THREE.MeshStandardMaterial({ color: potColor, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide }));
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.455, 32).rotateX(-Math.PI / 2).translate(0, 0.33, 0), new THREE.MeshStandardMaterial({ color: "#4a3a2c", roughness: 1 }));
  const greens = ["#8fb08a", "#7fa39b", "#9cb879", "#86a0a8"].map((c) => new THREE.Color(c));
  const spots: [number, number, number][] = [
    [0, 0, 0.26],
    [0.22, 0.14, 0.17],
    [-0.2, 0.17, 0.16],
    [0.06, -0.24, 0.15],
    [-0.22, -0.14, 0.13],
  ];
  const leaves = mergeGeometries(spots.flatMap(([x, z, r], i) => rosette(new THREE.Vector3(x, 0.335, z), r, rng, greens[(i + seed) % greens.length])));
  const plant = new THREE.Mesh(leaves, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
  // A few pebbles on the soil.
  const pebbleGeo = new THREE.SphereGeometry(0.025, 8, 6);
  const pebbleMat = new THREE.MeshStandardMaterial({ color: "#d9d3c7", roughness: 0.9 });
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const d = 0.3 + rng() * 0.12;
    const p = new THREE.Mesh(pebbleGeo, pebbleMat);
    p.position.set(Math.cos(a) * d, 0.335, Math.sin(a) * d);
    group.add(p);
  }
  group.add(bowl, soil, plant);
  return normalise(group);
}

let cache: { key: string; promise: Promise<PlantTemplates> } | null = null;

async function loadTemplates(): Promise<PlantTemplates> {
  const builtIn = (): PlantTemplates => ({ variants: [builtInPlant("#e9e4da", 11), builtInPlant("#b86b45", 29)], source: "built-in" });
  try {
    const info = (await (await fetch("/api/decor", { cache: "no-store" })).json()) as { model: { updatedAt: number } | null };
    const key = info.model ? String(info.model.updatedAt) : "built-in";
    if (cache?.key === key) return cache.promise;
    const promise = info.model
      ? new GLTFLoader()
          .loadAsync(`/api/decor/model?v=${info.model.updatedAt}`)
          .then((gltf): PlantTemplates => ({ variants: [normalise(gltf.scene)], source: "uploaded" }))
          .catch((err) => {
            console.warn("Plant model failed to load; using the built-in succulent.", err);
            return builtIn();
          })
      : Promise.resolve(builtIn());
    cache = { key, promise };
    return promise;
  } catch {
    return builtIn();
  }
}

/** The plant templates; reloads when the model is uploaded or removed. */
export function usePlantTemplates(): PlantTemplates | null {
  const [t, setT] = useState<PlantTemplates | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void loadTemplates().then((x) => live && setT(x));
    load();
    window.addEventListener(DECOR_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(DECOR_CHANGED, load);
    };
  }, []);
  return t;
}

/** The succulents on one floor (inside that floor's group). */
export function Succulents({ b, level, templates }: { b: Building; level: number; templates: PlantTemplates | null }) {
  const floor = b.floors.find((f) => f.level === level);
  const plants = useMemo(() => {
    if (!templates || !floor) return [];
    const all = b.decor ?? [];
    return all
      .filter((d) => d.floor === level)
      .map((d) => {
        const host = decorHost(floor, d);
        const obj = templates.variants[all.indexOf(d) % templates.variants.length].clone(true);
        return { d, obj, position: toScene(d, host ? HEIGHTS[host.kind] : 0) };
      });
  }, [b, level, floor, templates]);
  return (
    <>
      {plants.map(({ d, obj, position }) => (
        <group key={d.id} position={position} rotation={[0, d.spin, 0]} scale={d.size}>
          <primitive object={obj} />
        </group>
      ))}
    </>
  );
}
