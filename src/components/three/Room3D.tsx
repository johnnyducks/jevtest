"use client";

/**
 * 3D views of the same live simulation the 2D map shows: an orbitable observer
 * camera and a first-person camera mounted on Marty. Display only: every
 * position, heading, route and point value comes from the props (the live
 * session's state), mapped through lib/twin/space3d.ts.
 */
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Bonus } from "@/lib/game/game";
import type { CardArt } from "@/lib/cardsight/types";
import type { PublicTrip } from "@/lib/live/types";
import type { Card, Environment, Obstacle, Pose } from "@/lib/twin/environment";
import type { MotionStatus } from "@/lib/twin/motion";
import { CARD_SIZE, cardPlacement, fpvCamera, HEIGHTS, MARTY, obstacleBox, toScene, type V3 } from "@/lib/twin/space3d";

export type CameraMode = "fpv" | "orbit";

interface Props {
  env: Environment;
  pose: Pose;
  status: MotionStatus;
  trip: PublicTrip | null;
  bonuses: Bonus[];
  cardPoints: Record<string, number>;
  mode: CameraMode;
  /** Real card images (CardSight AI / local), by card id. Missing → drawn placeholder. */
  art?: Record<string, CardArt>;
  onCardGo: (card: Card) => void;
}

const COLORS = {
  bg: "#05070a",
  floor: "#121a22",
  wall: "#1d2833",
  accent: "#22d3ee",
  gold: "#fcd34d",
  amber: "#f5a524",
  green: "#4ade80",
};

const OBSTACLE_COLOR: Record<Obstacle["kind"], string> = {
  wall: "#33465a",
  table: "#2b3a4a",
  plinth: "#34475a",
  shelf: "#2d3d4d",
  equipment: "#222c36",
  cage: "#7f1d1d",
};

// ── Textures (drawn once on a canvas; no image files) ────────────────────

function floorTexture(env: Environment) {
  const px = 64; // pixels per meter
  const c = document.createElement("canvas");
  c.width = env.width * px;
  c.height = env.height * px;
  const g = c.getContext("2d")!;
  g.fillStyle = COLORS.floor;
  g.fillRect(0, 0, c.width, c.height);
  for (let m = 0; m <= Math.max(env.width, env.height) * 2; m++) {
    const major = m % 2 === 0;
    g.strokeStyle = major ? "rgba(148,178,204,0.22)" : "rgba(148,178,204,0.09)";
    g.lineWidth = major ? 2 : 1;
    const d = (m / 2) * px;
    if (d <= c.width) {
      g.beginPath();
      g.moveTo(d, 0);
      g.lineTo(d, c.height);
      g.stroke();
    }
    if (d <= c.height) {
      g.beginPath();
      g.moveTo(0, d);
      g.lineTo(c.width, d);
      g.stroke();
    }
  }
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
  c.width = 260;
  c.height = 360;
  const g = c.getContext("2d")!;
  const h = hue(card.team);
  g.fillStyle = "#e9e4d6";
  g.fillRect(0, 0, 260, 360);
  g.fillStyle = `hsl(${h} 45% 28%)`;
  g.fillRect(14, 14, 232, 250);
  // A simple silhouette so it reads as a player card from a distance.
  g.fillStyle = `hsl(${h} 35% 55%)`;
  g.beginPath();
  g.arc(130, 112, 38, 0, Math.PI * 2);
  g.fill();
  g.fillRect(78, 158, 104, 106);
  g.fillStyle = `hsl(${h} 60% 40%)`;
  g.fillRect(14, 264, 232, 32);
  g.fillStyle = "#fff";
  g.font = "bold 20px ui-sans-serif, Arial";
  g.textAlign = "center";
  g.fillText(card.team.toUpperCase(), 130, 287);
  g.fillStyle = "#1b1b1b";
  g.font = "bold 22px ui-sans-serif, Arial";
  g.fillText(card.name, 130, 324, 230);
  g.font = "16px ui-monospace, Menlo, monospace";
  g.fillStyle = "#444";
  g.fillText(`${card.year}${card.meta.set ? ` · ${card.meta.set}` : ""}`, 130, 348, 230);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ── Room ──────────────────────────────────────────────────────────────────

function Floor({ env }: { env: Environment }) {
  const tex = useMemo(() => floorTexture(env), [env]);
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[env.width / 2, -0.002, -env.height / 2]} receiveShadow>
        <planeGeometry args={[env.width, env.height]} />
        <meshStandardMaterial map={tex} roughness={0.92} metalness={0.05} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[env.width / 2, -0.01, -env.height / 2]}>
        <planeGeometry args={[env.width * 4, env.height * 4]} />
        <meshBasicMaterial color={COLORS.bg} />
      </mesh>
    </>
  );
}

function RoomWalls({ env, see }: { env: Environment; see: boolean }) {
  const t = 0.08;
  const h = HEIGHTS.roomWall;
  const walls: { c: V3; s: V3; south?: boolean }[] = [
    { c: [env.width / 2, h / 2, t / 2], s: [env.width + 2 * t, h, t], south: true },
    { c: [env.width / 2, h / 2, -env.height - t / 2], s: [env.width + 2 * t, h, t] },
    { c: [-t / 2, h / 2, -env.height / 2], s: [t, h, env.height] },
    { c: [env.width + t / 2, h / 2, -env.height / 2], s: [t, h, env.height] },
  ];
  return (
    <>
      {walls.map((w, i) => (
        <mesh key={i} position={w.c} receiveShadow castShadow={!w.south}>
          <boxGeometry args={w.s} />
          {/* From outside (observer), the near wall is see-through so it never hides the room. */}
          <meshStandardMaterial color={COLORS.wall} roughness={0.85} transparent={see} opacity={see ? (w.south ? 0.12 : 0.55) : 1} />
        </mesh>
      ))}
    </>
  );
}

function Cage({ o }: { o: Obstacle }) {
  const h = HEIGHTS.cage;
  const along = o.w > o.h;
  const len = along ? o.w : o.h;
  const n = Math.max(2, Math.round(len / 0.12));
  const bars = Array.from({ length: n + 1 }, (_, i) => (i / n) * len);
  return (
    <group>
      {bars.map((d, i) => {
        const p = along ? { x: o.x + d, y: o.y + o.h / 2 } : { x: o.x + o.w / 2, y: o.y + d };
        return (
          <mesh key={i} position={toScene(p, h / 2)} castShadow>
            <cylinderGeometry args={[0.012, 0.012, h, 6]} />
            <meshStandardMaterial color="#b91c1c" metalness={0.6} roughness={0.4} />
          </mesh>
        );
      })}
      {[0.05, h - 0.02].map((y) => (
        <mesh key={y} position={toScene({ x: o.x + o.w / 2, y: o.y + o.h / 2 }, y)}>
          <boxGeometry args={[along ? o.w : 0.03, 0.03, along ? 0.03 : o.h]} />
          <meshStandardMaterial color="#b91c1c" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Obstacles({ env }: { env: Environment }) {
  const edges = useMemo(() => new Map(env.obstacles.map((o) => [o.id, new THREE.BoxGeometry(o.w, 0.001, o.h)])), [env]);
  return (
    <>
      {env.obstacles.map((o) => {
        if (o.kind === "cage") return <Cage key={o.id} o={o} />;
        const b = obstacleBox(o);
        return (
          <group key={o.id}>
            <mesh position={b.center} castShadow receiveShadow>
              <boxGeometry args={b.size} />
              <meshStandardMaterial color={OBSTACLE_COLOR[o.kind]} roughness={0.8} metalness={0.1} />
            </mesh>
            {/* A faint accent line along the top edge, like the 2D map's outlines. */}
            <lineSegments position={[b.center[0], b.size[1] + 0.001, b.center[2]]}>
              <edgesGeometry args={[edges.get(o.id)!]} />
              <lineBasicMaterial color="#3b5568" />
            </lineSegments>
            {o.kind === "equipment" &&
              [0.4, 0.75, 1.1].map((y) => (
                <mesh key={y} position={toScene({ x: o.x + o.w / 2, y: o.y + o.h + 0.002 }, y)}>
                  <boxGeometry args={[o.w * 0.7, 0.02, 0.004]} />
                  <meshBasicMaterial color={COLORS.green} toneMapped={false} />
                </mesh>
              ))}
          </group>
        );
      })}
    </>
  );
}

const DOCK_EDGE = new THREE.PlaneGeometry(0.44, 0.44);

function Dock({ env }: { env: Environment }) {
  return (
    <group position={toScene(env.dock, 0.006)}>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[0.44, 0.44]} />
        <meshStandardMaterial color="#0d1a20" />
      </mesh>
      <lineSegments rotation-x={-Math.PI / 2}>
        <edgesGeometry args={[DOCK_EDGE]} />
        <lineBasicMaterial color={COLORS.accent} />
      </lineSegments>
    </group>
  );
}

function Ramps({ env }: { env: Environment }) {
  return (
    <>
      {env.special.map((sp) => {
        const rise = 0.45;
        const run = sp.zone.h;
        const angle = Math.atan2(rise, run);
        const len = Math.hypot(rise, run);
        return (
          <group key={sp.id} position={toScene({ x: sp.zone.x + sp.zone.w / 2, y: sp.zone.y + sp.zone.h / 2 }, rise / 2)}>
            {/* Slopes up toward the north wall (−Z), where the mezzanine would be. */}
            <mesh rotation-x={angle} castShadow receiveShadow>
              <boxGeometry args={[sp.zone.w, 0.03, len]} />
              <meshStandardMaterial color="#2a2112" emissive={COLORS.amber} emissiveIntensity={0.06} roughness={0.7} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/** The real card image when there is one, else the drawn placeholder. Keeps the image's own proportions. */
function useCardFace(card: Card, src: string | null | undefined) {
  const placeholder = useMemo(() => cardTexture(card), [card]);
  const [face, setFace] = useState<{ tex: THREE.Texture; aspect: number } | null>(null);
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
        setFace({ tex: t, aspect: img.width && img.height ? img.width / img.height : CARD_SIZE.w / CARD_SIZE.h });
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

function CardFrame({ env, card, src, bonus, target, onGo }: { env: Environment; card: Card; src?: string | null; bonus: boolean; target: boolean; onGo: (c: Card) => void }) {
  const { tex, aspect } = useCardFace(card, src);
  // Same height for every card; width follows the real card (a T206 is narrower than a modern card).
  const w = Math.min(CARD_SIZE.w * 1.15, CARD_SIZE.h * aspect);
  const place = useMemo(() => cardPlacement(env, card), [env, card]);
  const rim = target ? COLORS.accent : bonus ? COLORS.gold : "#5b4a1e";
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta < 6) onGo(card); // a click, not the end of an orbit drag
  };
  return (
    <group position={place.center} rotation-y={place.yaw}>
      <mesh position={[0, 0, -0.006]} castShadow>
        <boxGeometry args={[w + 0.03, CARD_SIZE.h + 0.03, 0.012]} />
        <meshStandardMaterial color={rim} emissive={rim} emissiveIntensity={target || bonus ? 0.45 : 0.1} />
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
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.42} roughness={0.55} />
      </mesh>
    </group>
  );
}

// ── Route ────────────────────────────────────────────────────────────────

function Route({ trip }: { trip: PublicTrip | null }) {
  const lines = useMemo(() => {
    if (!trip) return [];
    return trip.legs.map((leg) => {
      const geo = new THREE.BufferGeometry().setFromPoints(leg.path.map((p) => new THREE.Vector3(...toScene(p, 0.015))));
      const live = trip.status === "running" && !leg.done;
      const mat = new THREE.LineDashedMaterial({ color: COLORS.accent, dashSize: 0.14, gapSize: 0.09, transparent: true, opacity: live ? 0.95 : 0.3 });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      return line;
    });
  }, [trip]);
  useEffect(() => () => lines.forEach((l) => (l.geometry.dispose(), (l.material as THREE.Material).dispose())), [lines]);
  if (!trip) return null;
  return (
    <>
      {lines.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
      {trip.stops.map((s, i) => (
        <mesh key={i} position={toScene(s.point, 0.01)} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.1, 0.12, 40]} />
          <meshBasicMaterial color={s.done ? COLORS.green : COLORS.accent} transparent opacity={0.55} />
        </mesh>
      ))}
    </>
  );
}

// ── Marty ────────────────────────────────────────────────────────────────

function Marty({ poseRef, env, visible }: { poseRef: React.RefObject<Pose>; env: Environment; visible: boolean }) {
  const g = useRef<THREE.Group>(null);
  const r = env.robotRadius;
  useFrame(() => {
    const p = poseRef.current;
    if (!g.current || !p) return;
    g.current.position.set(...toScene(p, 0));
    g.current.rotation.y = p.heading;
  });
  return (
    <group ref={g} visible={visible}>
      <mesh position={[0, MARTY.bodyHeight / 2 + 0.02, 0]} castShadow>
        <boxGeometry args={[r * 1.9, MARTY.bodyHeight, r * 1.5]} />
        <meshStandardMaterial color="#cfd8e0" roughness={0.45} metalness={0.2} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 0.045, s * r * 0.85]} castShadow>
          <boxGeometry args={[r * 2.05, 0.09, 0.07]} />
          <meshStandardMaterial color="#1b232b" roughness={0.9} />
        </mesh>
      ))}
      {/* Camera lens at the front: where the FPV view is taken from. */}
      <mesh position={[r * 0.96, MARTY.camHeight - 0.01, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.035, 0.035, 0.03, 20]} />
        <meshStandardMaterial color="#0b1015" emissive={COLORS.accent} emissiveIntensity={0.8} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 0.3, 0]} color={COLORS.accent} intensity={0.6} distance={1.6} decay={2} />
    </group>
  );
}

// ── Cameras ──────────────────────────────────────────────────────────────

const ORBIT_HOME = (env: Environment) => ({ position: new THREE.Vector3(env.width / 2, 7.2, 5.2), target: new THREE.Vector3(env.width / 2, 0, -env.height / 2) });

function CameraRig({ mode, poseRef, env }: { mode: CameraMode; poseRef: React.RefObject<Pose>; env: Environment }) {
  const { camera, gl } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const yaw = useRef<number | null>(null);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (mode === "orbit") {
      cam.fov = 45;
      cam.near = 0.05;
      const home = ORBIT_HOME(env);
      cam.position.copy(home.position);
      const c = new OrbitControls(cam, gl.domElement);
      c.target.copy(home.target);
      c.enableDamping = true;
      c.dampingFactor = 0.08;
      c.maxPolarAngle = Math.PI / 2 - 0.06; // never under the floor
      c.minDistance = 1.5;
      c.maxDistance = 20;
      c.update();
      controls.current = c;
    } else {
      cam.fov = MARTY.fov;
      cam.near = 0.02;
      yaw.current = null;
    }
    cam.updateProjectionMatrix();
    return () => {
      controls.current?.dispose();
      controls.current = null;
    };
  }, [mode, camera, gl, env]);

  useFrame((_, dt) => {
    if (mode === "orbit") {
      controls.current?.update();
      return;
    }
    const p = poseRef.current;
    if (!p) return;
    // The pose is already smoothed; damp the yaw a touch more so turns feel like a camera, not a cut.
    const k = 1 - Math.exp(-dt / 0.06);
    if (yaw.current === null) yaw.current = p.heading;
    yaw.current += Math.atan2(Math.sin(p.heading - yaw.current), Math.cos(p.heading - yaw.current)) * k;
    const cam = fpvCamera({ ...p, heading: yaw.current });
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

function Labels({ env, slots, mode, trip, poseRef }: { env: Environment; slots: React.RefObject<LabelSlots>; mode: CameraMode; trip: PublicTrip | null; poseRef: React.RefObject<Pose> }) {
  const { camera, size } = useThree();
  const anchors = useMemo(
    () =>
      new Map(
        env.cards.map((c) => {
          const pl = cardPlacement(env, c);
          return [c.id, new THREE.Vector3(pl.center[0], pl.heightCenter + CARD_SIZE.h / 2 + 0.08, pl.center[2])];
        }),
      ),
    [env],
  );
  const v = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const nextAt = useMemo(() => new THREE.Vector3(), []);
  const nextStop = trip?.status === "running" ? trip.stops.find((s) => !s.done) : undefined;

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
    if (!s) return;
    camera.getWorldDirection(dir);
    const pose = poseRef.current;
    for (const c of env.cards) {
      const el = s.cards.get(c.id);
      const a = anchors.get(c.id)!;
      if (!el || !a) continue;
      const toCard = a.clone().sub(camera.position);
      const ahead = toCard.dot(dir) > 0;
      // FPV: label what Marty can plausibly "see": in front, within 4.5 m. Observer: everything on screen.
      const near = !pose || Math.hypot(c.position.x - pose.x, c.position.y - pose.y) < 4.5;
      place(el, a, ahead && (mode === "orbit" || near));
    }
    if (s.next) {
      if (!nextStop) place(s.next, v, false);
      else {
        nextAt.set(...toScene(nextStop.point, 0.35));
        place(s.next, nextAt, nextAt.clone().sub(camera.position).dot(dir) > 0);
      }
    }
  });
  return null;
}

// ── Scene ────────────────────────────────────────────────────────────────

function Lights({ env }: { env: Environment }) {
  const light = useMemo(() => {
    const l = new THREE.DirectionalLight("#e6eef6", 2.1);
    l.position.set(env.width / 2 + 3, 9, -env.height / 2 + 4);
    l.target.position.set(env.width / 2, 0, -env.height / 2);
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    const s = l.shadow.camera;
    s.left = -9;
    s.right = 9;
    s.top = 7;
    s.bottom = -7;
    s.near = 1;
    s.far = 25;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    return l;
  }, [env]);
  return (
    <>
      <hemisphereLight args={["#b7cadb", "#0b1015", 1.35]} />
      <ambientLight intensity={0.35} />
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}

/** Memoized: the pose changes every frame but is read through a ref, so the scene itself only re-renders when the trip, bonuses or mode change. */
const Scene = memo(function Scene({ env, poseRef, trip, bonuses, mode, art, onCardGo, slots }: Omit<Props, "pose" | "status" | "cardPoints"> & { poseRef: React.RefObject<Pose>; slots: React.RefObject<LabelSlots> }) {
  const bonusIds = new Set(bonuses.map((b) => b.cardId));
  const targetIds = new Set((trip?.status === "running" ? trip.stops : []).filter((s) => s.cardId && !s.done).map((s) => s.cardId!));
  return (
    <>
      <color attach="background" args={[COLORS.bg]} />
      {mode === "fpv" && <fog attach="fog" args={[COLORS.bg, 5, 16]} />}
      <Lights env={env} />
      <Floor env={env} />
      <RoomWalls env={env} see={mode === "orbit"} />
      <Obstacles env={env} />
      <Ramps env={env} />
      <Dock env={env} />
      {env.cards.map((c) => (
        <CardFrame key={c.id} env={env} card={c} src={art?.[c.id]?.front} bonus={bonusIds.has(c.id)} target={targetIds.has(c.id)} onGo={onCardGo} />
      ))}
      <Route trip={trip} />
      <Marty poseRef={poseRef} env={env} visible={mode === "orbit"} />
      <CameraRig mode={mode} poseRef={poseRef} env={env} />
      <Labels env={env} slots={slots} mode={mode} trip={trip} poseRef={poseRef} />
    </>
  );
});

const heading360 = (h: number) => Math.round((((h * 180) / Math.PI) % 360) + 360) % 360;

export default function Room3D(props: Props) {
  const { env, pose, mode, trip, bonuses, cardPoints } = props;
  // useFrame reads the latest pose from a ref, so the camera moves at display rate without re-creating the scene.
  const poseRef = useRef<Pose>(pose);
  poseRef.current = pose;
  const slots = useRef<LabelSlots>({ cards: new Map(), next: null });
  const goRef = useRef(props.onCardGo);
  goRef.current = props.onCardGo;
  const onGo = useCallback((c: Card) => goRef.current(c), []);
  const nextStop = trip?.status === "running" ? trip.stops.find((s) => !s.done) : undefined;
  const bonusAt = new Map(bonuses.map((b) => [b.cardId, b]));

  return (
    <div className={`three-wrap ${mode}`}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: MARTY.fov, near: 0.02, far: 60, position: [6, 6, 6] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
        fallback={<div className="three-fallback mono">3D needs WebGL, which this browser doesn&apos;t provide. The 2D map still works.</div>}
      >
        <Scene env={env} poseRef={poseRef} trip={trip} bonuses={bonuses} mode={mode} art={props.art} onCardGo={onGo} slots={slots} />
      </Canvas>

      <div className="three-labels" aria-hidden>
        {env.cards.map((c) => {
          const pts = (cardPoints[c.id] ?? 0) + (bonusAt.get(c.id)?.points ?? 0);
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
            <span>HDG {String(heading360(pose.heading)).padStart(3, "0")}°</span>
            <span>
              X {pose.x.toFixed(2)} Y {pose.y.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
