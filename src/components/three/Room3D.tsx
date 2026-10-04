"use client";

/**
 * 3D views of the same live simulation the 2D map shows: an orbitable observer
 * camera (a dollhouse cutaway of the six floors) and a first-person camera
 * mounted on Marty. Display only: every position, floor, route and point value
 * comes from the props (the live session's state), mapped through
 * lib/twin/space3d.ts.
 */
import {
  Canvas,
  type ThreeEvent,
  useFrame,
  useThree,
} from "@react-three/fiber";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CardArt } from "@/lib/cardsight/types";
import type { Bonus } from "@/lib/game/game";
import type { PublicTrip } from "@/lib/live/types";
import {
  type Building,
  type Card,
  DIMENSIONS,
  floorEnv,
  type Obstacle,
  type Pose,
  type Ramp,
} from "@/lib/twin/environment";
import type { MotionStatus } from "@/lib/twin/motion";
import {
  CARD_SIZE,
  cardPlacement,
  floorBase,
  fpvCamera,
  framing,
  HEIGHTS,
  MARTY,
  obstacleBox,
  toScene,
  type V3,
} from "@/lib/twin/space3d";
import { formatShort, type Units } from "@/lib/units";
import { useTheme } from "../theme";
import {
  type PlantTemplates,
  Succulents,
  usePlantTemplates,
} from "./Succulent";

export type CameraMode = "fpv" | "orbit";

interface Props {
  building: Building;
  pose: Pose;
  /** Marty's floor, and continuous height in floors (fractional on a ramp). */
  floor: number;
  level: number;
  /** Floor selected in the UI: the observer view cuts away everything above it. */
  viewFloor: number;
  status: MotionStatus;
  trip: PublicTrip | null;
  bonuses: Bonus[];
  cardPoints: Record<string, number>;
  mode: CameraMode;
  units: Units;
  /** Real card images (CardSight AI / local), by card id. Missing → drawn placeholder. */
  art?: Record<string, CardArt>;
  onCardGo: (card: Card) => void;
}

interface Live {
  pose: Pose;
  floor: number;
  level: number;
}

const DARK = {
  bg: "#05070a",
  floor: "#121a22",
  wall: "#1d2833",
  slab: "#0b1117",
  accent: "#22d3ee",
};
const LIGHT = {
  bg: "#e9eff4",
  floor: "#d3dde6",
  wall: "#b9c7d4",
  slab: "#9fb0c0",
  accent: "#0e7490",
};

/** Colours that depend on the theme; set once per render pass (module-level, as the scene is one tree). */
const COLORS = {
  ...DARK,
  gold: "#fcd34d",
  amber: "#f5a524",
  green: "#4ade80",
};

const OBSTACLE_DARK: Record<Obstacle["kind"], string> = {
  wall: "#33465a",
  table: "#2b3a4a",
  plinth: "#34475a",
  shelf: "#2d3d4d",
  equipment: "#222c36",
  cage: "#7f1d1d",
  ramp: "#2a2112",
  opening: "#000000",
  planter: "#6b7d5c",
};

const OBSTACLE_LIGHT: Record<Obstacle["kind"], string> = {
  ...OBSTACLE_DARK,
  wall: "#8fa3b6",
  table: "#aebdcb",
  plinth: "#9fb1c2",
  shelf: "#a6b6c6",
  equipment: "#8b9cad",
};
const OBSTACLE_COLOR: Record<Obstacle["kind"], string> = { ...OBSTACLE_DARK };

const {
  floorWidth: W,
  floorDepth: D,
  floorHeight: FH,
  slab: SLAB,
} = DIMENSIONS;
const RAMP_ANGLE = Math.atan2(FH, DIMENSIONS.rampLength);

// ── Textures (drawn once on a canvas; no image files) ────────────────────

/** Floor surface: a 1 in / 1 ft grid, the floor number painted near the dock, and holes where ramps arrive. */
function floorTexture(b: Building, level: number) {
  const px = 200; // pixels per meter
  const c = document.createElement("canvas");
  c.width = Math.round(W * px);
  c.height = Math.round(D * px);
  const g = c.getContext("2d")!;
  g.fillStyle = COLORS.floor;
  g.fillRect(0, 0, c.width, c.height);
  const inch = DIMENSIONS.floorWidth / 96;
  for (let i = 0; i <= 96; i += 3) {
    const major = i % 12 === 0;
    g.strokeStyle = major ? "rgba(148,178,204,0.24)" : "rgba(148,178,204,0.08)";
    g.lineWidth = major ? 2 : 1;
    const x = i * inch * px;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, c.height);
    g.stroke();
    if (i <= 48) {
      const y = i * inch * px;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(c.width, y);
      g.stroke();
    }
  }
  g.fillStyle = "rgba(34,211,238,0.14)";
  g.font = `bold ${Math.round(0.3 * px)}px ui-sans-serif, Arial`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(level), 0.62 * px, c.height - 0.62 * px);
  // Cut the opening where the ramp from below arrives (canvas y is flipped).
  for (const r of b.ramps.filter((x) => x.to === level))
    g.clearRect(
      r.lane.x * px,
      c.height - (r.lane.y + r.lane.h) * px,
      r.lane.w * px,
      r.lane.h * px,
    );
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function hue(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function cardTexture(card: Card) {
  const c = document.createElement("canvas");
  c.width = 250;
  c.height = 350;
  const g = c.getContext("2d")!;
  const h = hue(card.team);
  g.fillStyle = "#e9e4d6";
  g.fillRect(0, 0, 250, 350);
  g.fillStyle = `hsl(${h} 45% 28%)`;
  g.fillRect(14, 14, 222, 240);
  g.fillStyle = `hsl(${h} 35% 55%)`;
  g.beginPath();
  g.arc(125, 108, 36, 0, Math.PI * 2);
  g.fill();
  g.fillRect(75, 152, 100, 102);
  g.fillStyle = `hsl(${h} 60% 40%)`;
  g.fillRect(14, 254, 222, 32);
  g.fillStyle = "#fff";
  g.font = "bold 20px ui-sans-serif, Arial";
  g.textAlign = "center";
  g.fillText(card.team.toUpperCase(), 125, 277);
  g.fillStyle = "#1b1b1b";
  g.font = "bold 21px ui-sans-serif, Arial";
  g.fillText(card.name, 125, 314, 220);
  g.font = "15px ui-monospace, Menlo, monospace";
  g.fillStyle = "#444";
  g.fillText(
    `${card.year}${card.meta.set ? ` · ${card.meta.set}` : ""}`,
    125,
    337,
    220,
  );
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ── One floor ─────────────────────────────────────────────────────────────

/** The floor slab, built around the opening (if any) so there's a real hole to look down through. */
function Slab({ b, level }: { b: Building; level: number }) {
  const tex = useMemo(() => floorTexture(b, level), [b, level]);
  const pieces = useMemo(() => {
    const hole = b.ramps.find((r) => r.to === level)?.lane;
    if (!hole) return [{ x: 0, y: 0, w: W, h: D }];
    return [
      { x: 0, y: 0, w: hole.x, h: D },
      { x: hole.x + hole.w, y: 0, w: W - hole.x - hole.w, h: D },
      { x: hole.x, y: 0, w: hole.w, h: hole.y },
      { x: hole.x, y: hole.y + hole.h, w: hole.w, h: D - hole.y - hole.h },
    ].filter((p) => p.w > 1e-4 && p.h > 1e-4);
  }, [b, level]);
  return (
    <>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[W / 2, 0.0004, -D / 2]}
        receiveShadow
      >
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial
          map={tex}
          transparent
          alphaTest={0.5}
          roughness={0.92}
          metalness={0.05}
        />
      </mesh>
      {pieces.map((p, i) => (
        <mesh
          key={i}
          position={[p.x + p.w / 2, -SLAB / 2, -(p.y + p.h / 2)]}
          receiveShadow
        >
          <boxGeometry args={[p.w, SLAB, p.h]} />
          <meshStandardMaterial color={COLORS.slab} roughness={0.95} />
        </mesh>
      ))}
    </>
  );
}

function Walls({ see }: { see: boolean }) {
  const t = 0.012;
  const h = HEIGHTS.roomWall;
  const walls: { c: V3; s: V3; near?: boolean }[] = [
    { c: [W / 2, h / 2, t / 2], s: [W + 2 * t, h, t], near: true },
    { c: [W / 2, h / 2, -D - t / 2], s: [W + 2 * t, h, t] },
    { c: [-t / 2, h / 2, -D / 2], s: [t, h, D] },
    { c: [W + t / 2, h / 2, -D / 2], s: [t, h, D] },
  ];
  return (
    <>
      {walls.map((w, i) => (
        <mesh key={i} position={w.c} receiveShadow castShadow={!w.near}>
          <boxGeometry args={w.s} />
          {/* From outside (observer), the near wall is see-through so it never hides the floor. */}
          <meshStandardMaterial
            color={COLORS.wall}
            roughness={0.85}
            transparent={see}
            opacity={see ? (w.near ? 0.1 : 0.5) : 1}
          />
        </mesh>
      ))}
    </>
  );
}

function Cage({ o }: { o: Obstacle }) {
  const h = HEIGHTS.cage;
  const along = o.w > o.h;
  const len = along ? o.w : o.h;
  const n = Math.max(2, Math.round(len / 0.03));
  return (
    <group>
      {Array.from({ length: n + 1 }, (_, i) => (i / n) * len).map((d, i) => {
        const p = along
          ? { x: o.x + d, y: o.y + o.h / 2 }
          : { x: o.x + o.w / 2, y: o.y + d };
        return (
          <mesh key={i} position={toScene(p, h / 2)} castShadow>
            <cylinderGeometry args={[0.0025, 0.0025, h, 6]} />
            <meshStandardMaterial
              color="#b91c1c"
              metalness={0.6}
              roughness={0.4}
            />
          </mesh>
        );
      })}
      {[0.01, h - 0.004].map((y) => (
        <mesh
          key={y}
          position={toScene({ x: o.x + o.w / 2, y: o.y + o.h / 2 }, y)}
        >
          <boxGeometry
            args={[along ? o.w : 0.006, 0.006, along ? 0.006 : o.h]}
          />
          <meshStandardMaterial
            color="#b91c1c"
            metalness={0.6}
            roughness={0.4}
          />
        </mesh>
      ))}
    </group>
  );
}

function Furniture({ obstacles }: { obstacles: Obstacle[] }) {
  return (
    <>
      {obstacles.map((o) => {
        if (o.kind === "ramp" || o.kind === "opening" || o.kind === "planter")
          return null;
        if (o.kind === "cage") return <Cage key={o.id} o={o} />;
        const bx = obstacleBox(o);
        return (
          <mesh key={o.id} position={bx.center} castShadow receiveShadow>
            <boxGeometry args={bx.size} />
            <meshStandardMaterial
              color={OBSTACLE_COLOR[o.kind]}
              roughness={0.8}
              metalness={0.1}
            />
          </mesh>
        );
      })}
    </>
  );
}

/** A ramp from this floor up to the next: an inclined deck along its lane, with a low rail on the open side. */
function RampDeck({ r }: { r: Ramp }) {
  const len = Math.hypot(DIMENSIONS.rampLength, FH);
  const mid = { x: (r.foot.x + r.top.x) / 2, y: r.foot.y };
  const up = r.top.x > r.foot.x ? 1 : -1;
  const railY = r.lane.y < D / 2 ? r.lane.y + r.lane.h : r.lane.y;
  return (
    <group>
      <group position={toScene(mid, FH / 2)} rotation-z={up * RAMP_ANGLE}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[len, 0.006, r.lane.h]} />
          <meshStandardMaterial
            color="#3a2f1c"
            emissive={COLORS.amber}
            emissiveIntensity={0.05}
            roughness={0.7}
          />
        </mesh>
      </group>
      <group
        position={toScene({ x: mid.x, y: railY }, FH / 2 + 0.015)}
        rotation-z={up * RAMP_ANGLE}
      >
        <mesh>
          <boxGeometry args={[len, 0.004, 0.004]} />
          <meshStandardMaterial
            color={COLORS.amber}
            emissive={COLORS.amber}
            emissiveIntensity={0.3}
          />
        </mesh>
      </group>
    </group>
  );
}

const DOCK_EDGE = new THREE.PlaneGeometry(0.1, 0.1);

function Dock({ at }: { at: { x: number; y: number } }) {
  return (
    <group position={toScene(at, 0.001)}>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[0.1, 0.1]} />
        <meshStandardMaterial color="#0d1a20" />
      </mesh>
      <lineSegments rotation-x={-Math.PI / 2}>
        <edgesGeometry args={[DOCK_EDGE]} />
        <lineBasicMaterial color={COLORS.accent} />
      </lineSegments>
    </group>
  );
}

/** The real card image when there is one, else the drawn placeholder. Keeps the image's own proportions. */
function useCardFace(card: Card, src: string | null | undefined) {
  const placeholder = useMemo(() => cardTexture(card), [card]);
  const [face, setFace] = useState<{
    tex: THREE.Texture;
    aspect: number;
  } | null>(null);
  useEffect(() => {
    if (!src) {
      setFace(null);
      return;
    }
    let alive = true;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(
      src,
      (t) => {
        loaded = t;
        if (!alive) return t.dispose();
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        const img = t.image as { width?: number; height?: number };
        setFace({
          tex: t,
          aspect:
            img.width && img.height
              ? img.width / img.height
              : CARD_SIZE.w / CARD_SIZE.h,
        });
      },
      undefined,
      () => alive && setFace(null), // image failed: keep the placeholder
    );
    return () => {
      alive = false;
      loaded?.dispose();
    };
  }, [src]);
  return face ?? { tex: placeholder, aspect: CARD_SIZE.w / CARD_SIZE.h };
}

function CardFrame({
  b,
  card,
  src,
  bonus,
  target,
  onGo,
}: {
  b: Building;
  card: Card;
  src?: string | null;
  bonus: boolean;
  target: boolean;
  onGo: (c: Card) => void;
}) {
  const { tex, aspect } = useCardFace(card, src);
  // Real card height (3.5 in); width follows the image (a T206 is narrower than a modern card).
  const w = Math.min(CARD_SIZE.w * 1.15, CARD_SIZE.h * aspect);
  const place = useMemo(
    () => cardPlacement(floorEnv(b, card.floor), card),
    [b, card],
  );
  const rim = target ? COLORS.accent : bonus ? COLORS.gold : "#5b4a1e";
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta < 6) onGo(card); // a click, not the end of an orbit drag
  };
  return (
    <group position={place.center} rotation-y={place.yaw}>
      {/* A thin frame just behind the card face (never at the same depth, which would flicker up close). */}
      <mesh position={[0, 0, -0.0015]}>
        <boxGeometry args={[w + 0.005, CARD_SIZE.h + 0.005, 0.002]} />
        <meshStandardMaterial
          color={rim}
          emissive={rim}
          emissiveIntensity={target || bonus ? 0.45 : 0.1}
        />
      </mesh>
      <mesh
        onClick={click}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <planeGeometry args={[w, CARD_SIZE.h]} />
        {/* Lit like a display case, so the card reads on walls that face away from the main light. */}
        <meshStandardMaterial
          map={tex}
          emissiveMap={tex}
          emissive="#ffffff"
          emissiveIntensity={0.42}
          roughness={0.55}
        />
      </mesh>
    </group>
  );
}

function FloorLevel({
  b,
  level,
  see,
  bonusIds,
  targetIds,
  art,
  plants,
  onGo,
}: {
  b: Building;
  level: number;
  see: boolean;
  bonusIds: Set<string>;
  targetIds: Set<string>;
  art?: Record<string, CardArt>;
  plants: PlantTemplates | null;
  onGo: (c: Card) => void;
}) {
  const env = floorEnv(b, level);
  const up = b.ramps.find((r) => r.from === level);
  return (
    <group position={[0, floorBase(level), 0]}>
      <Slab b={b} level={level} />
      <Walls see={see} />
      <Furniture obstacles={env.obstacles} />
      <Succulents b={b} level={level} templates={plants} />
      {up && <RampDeck r={up} />}
      <Dock at={env.dock} />
      {env.cards.map((c) => (
        <CardFrame
          key={c.id}
          b={b}
          card={c}
          src={art?.[c.id]?.front}
          bonus={bonusIds.has(c.id)}
          target={targetIds.has(c.id)}
          onGo={onGo}
        />
      ))}
    </group>
  );
}

// ── Route ────────────────────────────────────────────────────────────────

function Route({
  trip,
  maxFloor,
}: {
  trip: PublicTrip | null;
  maxFloor: number;
}) {
  const lines = useMemo(() => {
    if (!trip) return [];
    return trip.legs
      .filter((leg) => leg.floor <= maxFloor)
      .map((leg) => {
        const pts = leg.path.map((p, i) => {
          // Ramp legs: the first two points are on the starting floor, the last two on the arrival floor.
          const lvl = leg.ramp
            ? i < 2
              ? leg.ramp.from
              : leg.ramp.to
            : leg.floor;
          return new THREE.Vector3(...toScene(p, floorBase(lvl) + 0.004));
        });
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const live = trip.status === "running" && !leg.done;
        const mat = new THREE.LineDashedMaterial({
          color: COLORS.accent,
          dashSize: 0.03,
          gapSize: 0.02,
          transparent: true,
          opacity: live ? 0.95 : 0.3,
        });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        return line;
      });
  }, [trip, maxFloor]);
  useEffect(
    () => () =>
      lines.forEach(
        (l) => (l.geometry.dispose(), (l.material as THREE.Material).dispose()),
      ),
    [lines],
  );
  if (!trip) return null;
  return (
    <>
      {lines.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
      {trip.stops
        .filter((s) => s.floor <= maxFloor)
        .map((s, i) => (
          <mesh
            key={i}
            position={toScene(s.point, floorBase(s.floor) + 0.003)}
            rotation-x={-Math.PI / 2}
          >
            <ringGeometry args={[0.025, 0.031, 32]} />
            <meshBasicMaterial
              color={s.done ? COLORS.green : COLORS.accent}
              transparent
              opacity={0.55}
            />
          </mesh>
        ))}
    </>
  );
}

// ── Marty ────────────────────────────────────────────────────────────────

function Marty({
  live,
  visible,
}: {
  live: React.RefObject<Live>;
  visible: boolean;
}) {
  const g = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const prevLevel = useRef<number | null>(null);
  const L = DIMENSIONS.botLength;
  const Wb = DIMENSIONS.botWidth;
  useFrame(() => {
    const s = live.current;
    if (!g.current || !body.current || !s) return;
    g.current.position.set(...toScene(s.pose, floorBase(s.level)));
    g.current.rotation.y = s.pose.heading;
    // On a ramp (between floors), tilt nose-up when climbing and nose-down when descending.
    const between = Math.abs(s.level - Math.round(s.level)) > 0.002;
    const dir =
      prevLevel.current === null ? 0 : Math.sign(s.level - prevLevel.current);
    body.current.rotation.z = between
      ? dir >= 0
        ? RAMP_ANGLE
        : -RAMP_ANGLE
      : 0;
    prevLevel.current = s.level;
  });
  return (
    <group ref={g} visible={visible}>
      <group ref={body}>
        <mesh position={[0, MARTY.bodyHeight / 2 + 0.006, 0]} castShadow>
          <boxGeometry args={[L * 0.92, MARTY.bodyHeight, Wb * 0.7]} />
          <meshStandardMaterial
            color="#cfd8e0"
            roughness={0.45}
            metalness={0.2}
          />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, 0.013, side * Wb * 0.4]} castShadow>
            <boxGeometry args={[L, 0.026, Wb * 0.2]} />
            <meshStandardMaterial color="#1b232b" roughness={0.9} />
          </mesh>
        ))}
        {/* Camera lens at the front: where the FPV view is taken from. */}
        <mesh
          position={[L * 0.47, MARTY.camHeight - 0.006, 0]}
          rotation-z={Math.PI / 2}
        >
          <cylinderGeometry args={[0.008, 0.008, 0.006, 20]} />
          <meshStandardMaterial
            color="#0b1015"
            emissive={COLORS.accent}
            emissiveIntensity={0.8}
            toneMapped={false}
          />
        </mesh>
        <pointLight
          position={[0, 0.08, 0]}
          color={COLORS.accent}
          intensity={0.08}
          distance={0.4}
          decay={2}
        />
      </group>
    </group>
  );
}

// ── Cameras ──────────────────────────────────────────────────────────────

const orbitHome = (floor: number) => ({
  position: new THREE.Vector3(W / 2, floorBase(floor) + 1.55, 1.6),
  target: new THREE.Vector3(W / 2, floorBase(floor), -D / 2),
});

function CameraRig({
  mode,
  live,
  b,
  viewFloor,
}: {
  mode: CameraMode;
  live: React.RefObject<Live>;
  b: Building;
  viewFloor: number;
}) {
  const { camera, gl } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const yaw = useRef<number | null>(null);
  const pitch = useRef<number>(MARTY.camPitch);
  const goal = useRef(new THREE.Vector3());

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (mode === "orbit") {
      cam.fov = 45;
      cam.near = 0.01;
      const home = orbitHome(viewFloor);
      cam.position.copy(home.position);
      const c = new OrbitControls(cam, gl.domElement);
      c.target.copy(home.target);
      goal.current.copy(home.target);
      c.enableDamping = true;
      c.dampingFactor = 0.08;
      c.maxPolarAngle = Math.PI / 2 - 0.04; // never under the floor
      c.minDistance = 0.25;
      c.maxDistance = 7;
      c.update();
      controls.current = c;
    } else {
      cam.fov = MARTY.fov;
      cam.near = 0.004;
      yaw.current = null;
    }
    cam.updateProjectionMatrix();
    return () => {
      controls.current?.dispose();
      controls.current = null;
    };
    // The observer camera is set up once per mode; floor changes glide the target instead (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, camera, gl]);

  // Switching floors in the observer view: glide up or down to the selected floor, keeping the viewing angle.
  useEffect(() => {
    goal.current.set(W / 2, floorBase(viewFloor), -D / 2);
  }, [viewFloor]);

  useFrame((_, dt) => {
    if (mode === "orbit") {
      const c = controls.current;
      if (c) {
        const k = 1 - Math.exp(-dt / 0.25);
        const dy = (goal.current.y - c.target.y) * k;
        if (Math.abs(dy) > 1e-5) {
          c.target.y += dy;
          camera.position.y += dy;
        }
        c.update();
      }
      return;
    }
    const s = live.current;
    if (!s) return;
    // The pose is already smoothed; damp the yaw a touch more so turns feel like a camera, not a cut.
    const k = 1 - Math.exp(-dt / 0.06);
    if (yaw.current === null) yaw.current = s.pose.heading;
    yaw.current +=
      Math.atan2(
        Math.sin(s.pose.heading - yaw.current),
        Math.cos(s.pose.heading - yaw.current),
      ) * k;
    // In front of a card: tilt and zoom so it fills the frame (eased, ~0.4 s).
    const f = framing(floorEnv(b, s.floor), s.pose);
    const kf = 1 - Math.exp(-dt / 0.25);
    pitch.current += (f.pitch - pitch.current) * kf;
    const cam3 = camera as THREE.PerspectiveCamera;
    const fov = cam3.fov + (f.fov - cam3.fov) * kf;
    if (Math.abs(fov - cam3.fov) > 0.01) {
      cam3.fov = fov;
      cam3.updateProjectionMatrix();
    }
    // On a ramp, look along the incline.
    const between = Math.abs(s.level - Math.round(s.level)) > 0.002;
    const cam = fpvCamera(
      { ...s.pose, heading: yaw.current },
      pitch.current + (between ? RAMP_ANGLE * 0.6 : 0),
      floorBase(s.level),
    );
    camera.position.set(...cam.position);
    camera.lookAt(...cam.target);
  });
  return null;
}

// ── Labels (HTML, positioned each frame) ─────────────────────────────────

export interface LabelSlots {
  cards: Map<string, HTMLDivElement>;
  next: HTMLDivElement | null;
}

function Labels({
  b,
  slots,
  mode,
  trip,
  live,
  viewFloor,
}: {
  b: Building;
  slots: React.RefObject<LabelSlots>;
  mode: CameraMode;
  trip: PublicTrip | null;
  live: React.RefObject<Live>;
  viewFloor: number;
}) {
  const { camera, size } = useThree();
  const anchors = useMemo(
    () =>
      new Map(
        b.cards.map((c) => {
          const pl = cardPlacement(floorEnv(b, c.floor), c);
          return [
            c.id,
            new THREE.Vector3(
              pl.center[0],
              floorBase(c.floor) + pl.heightCenter + CARD_SIZE.h / 2 + 0.015,
              pl.center[2],
            ),
          ];
        }),
      ),
    [b],
  );
  const v = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const nextAt = useMemo(() => new THREE.Vector3(), []);
  const nextStop =
    trip?.status === "running" ? trip.stops.find((s) => !s.done) : undefined;

  const place = (el: HTMLDivElement, at: THREE.Vector3, show: boolean) => {
    if (!show) {
      el.style.opacity = "0";
      return;
    }
    v.copy(at).project(camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) {
      el.style.opacity = "0";
      return;
    }
    el.style.opacity = "1";
    el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
  };

  useFrame(() => {
    const s = slots.current;
    const m = live.current;
    if (!s || !m) return;
    camera.getWorldDirection(dir);
    // The card filling the FPV frame, if any.
    const framed =
      mode === "fpv" ? framing(floorEnv(b, m.floor), m.pose).cardId : null;
    for (const c of b.cards) {
      const el = s.cards.get(c.id);
      const a = anchors.get(c.id);
      if (!el || !a) continue;
      const ahead = a.clone().sub(camera.position).dot(dir) > 0;
      // FPV: cards on Marty's floor within about 3 ft. Observer: cards on the floor being viewed.
      const show =
        mode === "orbit"
          ? c.floor === viewFloor
          : c.floor === m.floor &&
            Math.hypot(c.position.x - m.pose.x, c.position.y - m.pose.y) <
              0.9 &&
            !framed;
      place(el, a, ahead && show);
    }
    if (s.next) {
      if (
        !nextStop ||
        (mode === "orbit" && nextStop.floor !== viewFloor) ||
        (mode === "fpv" && nextStop.floor !== m.floor)
      )
        place(s.next, v, false);
      else {
        nextAt.set(
          ...toScene(nextStop.point, floorBase(nextStop.floor) + 0.12),
        );
        place(s.next, nextAt, nextAt.clone().sub(camera.position).dot(dir) > 0);
      }
    }
  });
  return null;
}

// ── Scene ────────────────────────────────────────────────────────────────

function Lights() {
  const light = useMemo(() => {
    const l = new THREE.DirectionalLight("#e6eef6", 2.1);
    l.position.set(W / 2 + 1.2, 6, -D / 2 + 1.5);
    l.target.position.set(W / 2, 0, -D / 2);
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    const s = l.shadow.camera;
    s.left = -2;
    s.right = 2;
    s.top = 2;
    s.bottom = -2;
    s.near = 0.5;
    s.far = 12;
    l.shadow.bias = -0.0003;
    l.shadow.normalBias = 0.004;
    return l;
  }, []);
  return (
    <>
      <hemisphereLight args={["#b7cadb", "#0b1015", 1.35]} />
      <ambientLight intensity={0.35} />
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}

/** Memoized: the pose changes every frame but is read through a ref, so the scene only re-renders when trip, bonuses, floor or mode change. */
const Scene = memo(function Scene({
  b,
  live,
  trip,
  bonuses,
  mode,
  viewFloor,
  art,
  plants,
  onCardGo,
  slots,
}: {
  b: Building;
  live: React.RefObject<Live>;
  trip: PublicTrip | null;
  bonuses: Bonus[];
  mode: CameraMode;
  viewFloor: number;
  art?: Record<string, CardArt>;
  plants: PlantTemplates | null;
  onCardGo: (c: Card) => void;
  slots: React.RefObject<LabelSlots>;
}) {
  const bonusIds = new Set(bonuses.map((x) => x.cardId));
  const targetIds = new Set(
    (trip?.status === "running" ? trip.stops : [])
      .filter((s) => s.cardId && !s.done)
      .map((s) => s.cardId!),
  );
  // Observer: a dollhouse cut away above the selected floor. FPV: the whole building (the floor above is the ceiling).
  const maxFloor = mode === "orbit" ? viewFloor : b.floors.length;
  return (
    <>
      <color attach="background" args={[COLORS.bg]} />
      {mode === "fpv" && <fog attach="fog" args={[COLORS.bg, 0.7, 3.2]} />}
      <Lights />
      {b.floors
        .filter((f) => f.level <= maxFloor)
        .map((f) => (
          <FloorLevel
            key={f.level}
            b={b}
            level={f.level}
            see={mode === "orbit" && f.level === viewFloor}
            bonusIds={bonusIds}
            targetIds={targetIds}
            art={art}
            plants={plants}
            onGo={onCardGo}
          />
        ))}
      <Route trip={trip} maxFloor={maxFloor} />
      <Marty live={live} visible={mode === "orbit"} />
      <CameraRig mode={mode} live={live} b={b} viewFloor={viewFloor} />
      <Labels
        b={b}
        slots={slots}
        mode={mode}
        trip={trip}
        live={live}
        viewFloor={viewFloor}
      />
    </>
  );
});

const heading360 = (h: number) =>
  Math.round((((h * 180) / Math.PI) % 360) + 360) % 360;

export default function Room3D(props: Props) {
  const { building: b, pose, mode, trip, bonuses, cardPoints, units } = props;
  // useFrame reads the latest pose from a ref, so the camera moves at display rate without re-creating the scene.
  const live = useRef<Live>({ pose, floor: props.floor, level: props.level });
  live.current = { pose, floor: props.floor, level: props.level };
  const slots = useRef<LabelSlots>({ cards: new Map(), next: null });
  const goRef = useRef(props.onCardGo);
  goRef.current = props.onCardGo;
  const onGo = useCallback((c: Card) => goRef.current(c), []);
  const plants = usePlantTemplates();
  // Colours are read while the scene renders; the Canvas is keyed on the theme so everything is rebuilt with the new ones.
  const theme = useTheme();
  Object.assign(COLORS, theme === "light" ? LIGHT : DARK);
  Object.assign(
    OBSTACLE_COLOR,
    theme === "light" ? OBSTACLE_LIGHT : OBSTACLE_DARK,
  );
  const nextStop =
    trip?.status === "running" ? trip.stops.find((s) => !s.done) : undefined;
  const bonusAt = new Map(bonuses.map((x) => [x.cardId, x]));

  return (
    <div className={`three-wrap ${mode}`}>
      <Canvas
        key={theme}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{
          fov: MARTY.fov,
          near: 0.004,
          far: 30,
          position: [1.2, 1.5, 1.6],
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
        fallback={
          <div className="three-fallback mono">
            3D needs WebGL, which this browser doesn&apos;t provide. The 2D map
            still works.
          </div>
        }
      >
        <Scene
          b={b}
          live={live}
          trip={trip}
          bonuses={bonuses}
          mode={mode}
          viewFloor={props.viewFloor}
          art={props.art}
          plants={plants}
          onCardGo={onGo}
          slots={slots}
        />
      </Canvas>

      <div className="three-labels" aria-hidden>
        {b.cards.map((c) => {
          const pts =
            (cardPoints[c.id] ?? 0) + (bonusAt.get(c.id)?.points ?? 0);
          return (
            <div
              key={c.id}
              className={`t-label${bonusAt.has(c.id) ? " bonus" : ""}`}
              ref={(el) => {
                if (el) slots.current.cards.set(c.id, el);
                else slots.current.cards.delete(c.id);
              }}
            >
              {c.name}
              {c.id !== "wagner-t206" && pts > 0 && <b>{pts}</b>}
            </div>
          );
        })}
        <div
          className="t-label next"
          ref={(el) => {
            slots.current.next = el;
          }}
        >
          NEXT · {nextStop?.name ?? ""}
        </div>
      </div>

      {mode === "fpv" && (
        <div className="fpv-hud mono" aria-hidden>
          <div className="fpv-reticle">
            <i />
          </div>
          <div className="fpv-top">
            <span className="fpv-rec">● CAM 1</span>
            <span>FLOOR {props.floor}</span>
            <span>
              HDG {String(heading360(pose.heading)).padStart(3, "0")}°
            </span>
            <span>
              {formatShort(pose.x, units)} · {formatShort(pose.y, units)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
