'use client';

import { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { usePackages, useProjects } from '@/lib/hooks';
import { pulseVertex, pulseFragment } from '@/lib/pulseShader';
import { BackgroundMist } from './BrainCore';
import type { PackageRow } from '@/lib/supabase';

/**
 * RelayFlow — the second visualization mode, built around the relay metaphor
 * itself: every project is a relay station on an orbital ring, and every
 * context package is a transmission being relayed into the core. Where the
 * cortex view answers "which projects are biggest/most active right now",
 * this view answers "what is each project's transmission rhythm over time":
 *
 *  - Station size      → package count in the current window
 *  - Station heat      → how recently the project last deposited
 *  - Beam pulse traffic → deposit volume flowing into the core
 *  - History arc       → each package as a dot trailing the station,
 *                        newest at the station, oldest at the tail;
 *                        lime = KEY (sig >= 9), white-cyan = SIG (>= 6)
 */

const RING_RADIUS = 2.1;
const ARC_RADIUS = RING_RADIUS + 0.24;
const ARC_DOTS_MAX = 80;
const HOT_COLOR = new THREE.Color('#00ddff');
const COLD_COLOR = new THREE.Color('#27506b');

interface StationData {
  pid: string;
  name: string;
  count: number;
  angle: number;
  position: THREE.Vector3;
  color: THREE.Color;
  heat: number; // 0 (stale) .. 1 (deposited within the hour)
  lastActivity: string;
  packages: PackageRow[]; // newest first
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Recency → heat. Within an hour = 1, decaying to 0.15 over 30 days. */
function activityHeat(newestIso: string | undefined): number {
  if (!newestIso) return 0.15;
  const ageDays = (Date.now() - new Date(newestIso).getTime()) / 86_400_000;
  return Math.max(0.15, Math.min(1, 1 - ageDays / 30));
}

function buildStations(
  packages: PackageRow[],
  projects: { id: string; name: string; archived_at: string | null }[],
  includeArchived: boolean,
): StationData[] {
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const visibleIds = new Set(
    projects.filter((p) => includeArchived || !p.archived_at).map((p) => p.id),
  );
  const byProject = new Map<string, PackageRow[]>();
  for (const pkg of packages) {
    if (!visibleIds.has(pkg.project_id)) continue;
    const list = byProject.get(pkg.project_id) || [];
    list.push(pkg);
    byProject.set(pkg.project_id, list);
  }

  // Biggest stations first so the eye finds them, then spread evenly.
  const pids = [...byProject.keys()].sort(
    (a, b) => (byProject.get(b)?.length || 0) - (byProject.get(a)?.length || 0),
  );

  return pids.map((pid, i) => {
    const pkgs = (byProject.get(pid) || []).slice().sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const angle = (i / Math.max(pids.length, 1)) * Math.PI * 2;
    const heat = activityHeat(pkgs[0]?.created_at);
    return {
      pid,
      name: projectsById.get(pid)?.name || pid,
      count: pkgs.length,
      angle,
      position: new THREE.Vector3(
        Math.cos(angle) * RING_RADIUS,
        0,
        Math.sin(angle) * RING_RADIUS,
      ),
      color: COLD_COLOR.clone().lerp(HOT_COLOR, heat),
      heat,
      lastActivity: pkgs[0] ? timeAgo(pkgs[0].created_at) : '—',
      packages: pkgs,
    };
  });
}

/** The relay core — what every station transmits into. */
function Hub({ time }: { time: React.RefObject<{ value: number }> }) {
  const sphereRef = useRef<THREE.Mesh>(null);
  const cageRef = useRef<THREE.Mesh>(null);
  const ringARef = useRef<THREE.Mesh>(null);
  const ringBRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!time.current) return;
    const t = time.current.value;
    if (sphereRef.current) {
      const mat = sphereRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.45 + 0.15 * Math.sin(t * 1.2);
      const s = 1 + 0.04 * Math.sin(t * 1.2);
      sphereRef.current.scale.setScalar(s);
    }
    if (cageRef.current) {
      cageRef.current.rotation.y = t * 0.15;
      cageRef.current.rotation.x = t * 0.07;
    }
    if (ringARef.current) ringARef.current.rotation.z = t * 0.25;
    if (ringBRef.current) ringBRef.current.rotation.z = -t * 0.18;
  });

  return (
    <group>
      <mesh ref={sphereRef}>
        <sphereGeometry args={[0.22, 24, 24]} />
        <meshBasicMaterial color="#7be6ff" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={cageRef}>
        <icosahedronGeometry args={[0.36, 1]} />
        <meshBasicMaterial color="#00ddff" wireframe transparent opacity={0.22} />
      </mesh>
      <mesh ref={ringARef} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[0.52, 0.006, 8, 64]} />
        <meshBasicMaterial color="#00ddff" transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={ringBRef} rotation={[Math.PI / 1.7, 0.4, 0]}>
        <torusGeometry args={[0.62, 0.004, 8, 64]} />
        <meshBasicMaterial color="#5fe0ff" transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Faint guide ring the stations sit on. */
function OrbitRing() {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[RING_RADIUS, 0.0025, 6, 128]} />
      <meshBasicMaterial color="#3cb4ff" transparent opacity={0.12} />
    </mesh>
  );
}

/** One relay station: dish marker + uplink ring, sized by package count. */
function Station({
  station,
  hoveredProject,
  setHoveredProject,
  onClickProject,
  time,
}: {
  station: StationData;
  hoveredProject: string | null;
  setHoveredProject: (id: string | null) => void;
  onClickProject?: (id: string) => void;
  time: React.RefObject<{ value: number }>;
}) {
  const coreRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const isHovered = hoveredProject === station.pid;
  const isDimmed = hoveredProject !== null && !isHovered;
  const size = 0.05 + 0.022 * Math.log2(1 + station.count);

  useFrame(() => {
    if (!time.current) return;
    const t = time.current.value;
    if (coreRef.current) {
      const mat = coreRef.current.material as THREE.MeshBasicMaterial;
      const pulse = 0.55 + station.heat * 0.3 + 0.15 * Math.sin(t * (1 + station.heat * 2) + station.angle * 7);
      mat.opacity = isDimmed ? pulse * 0.25 : isHovered ? Math.min(1, pulse + 0.3) : pulse;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * (0.3 + station.heat * 0.5);
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = isDimmed ? 0.06 : isHovered ? 0.6 : 0.25;
    }
  });

  return (
    <group position={station.position}>
      <mesh
        ref={coreRef}
        onPointerEnter={() => setHoveredProject(station.pid)}
        onPointerLeave={() => setHoveredProject(null)}
        onClick={() => onClickProject?.(station.pid)}
      >
        <octahedronGeometry args={[size, 0]} />
        <meshBasicMaterial color={station.color} transparent opacity={0.8} />
      </mesh>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[size + 0.05, 0.003, 6, 32]} />
        <meshBasicMaterial color={station.color} transparent opacity={0.25} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <Html position={[0, -0.24, 0]} center distanceFactor={5}>
        <div
          className="text-center whitespace-nowrap cursor-pointer select-none"
          style={{ opacity: isDimmed ? 0.2 : 1, transition: 'opacity 0.2s' }}
          onPointerEnter={() => setHoveredProject(station.pid)}
          onPointerLeave={() => setHoveredProject(null)}
          onClick={() => onClickProject?.(station.pid)}
        >
          <div
            className="font-semibold tracking-wide"
            style={{
              color: `#${station.color.getHexString()}`,
              fontSize: isHovered ? '13px' : '10px',
              textShadow: isHovered ? `0 0 12px #${station.color.getHexString()}` : 'none',
              transition: 'all 0.2s',
            }}
          >
            {station.name}
          </div>
          <div className="text-[9px] text-white/40">
            {station.count} pkg{station.count !== 1 ? 's' : ''} · {station.lastActivity}
          </div>
        </div>
      </Html>
    </group>
  );
}

/** Faint bezier beams from every station into the hub. Built imperatively —
    JSX <line> collides with the SVG element type, so THREE.Line objects go
    through <primitive> instead. */
function Beams({ stations, hoveredProject }: { stations: StationData[]; hoveredProject: string | null }) {
  const lines = useMemo(
    () =>
      stations.map((s) => {
        const mid = s.position.clone().multiplyScalar(0.45);
        mid.y = 0.55;
        const curve = new THREE.QuadraticBezierCurve3(s.position.clone(), mid, new THREE.Vector3(0, 0, 0));
        const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
        const mat = new THREE.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.06 });
        return new THREE.Line(geo, mat);
      }),
    [stations],
  );

  useFrame(() => {
    for (let i = 0; i < lines.length; i++) {
      const s = stations[i];
      const isHovered = hoveredProject === s.pid;
      const isDimmed = hoveredProject !== null && !isHovered;
      (lines[i].material as THREE.LineBasicMaterial).opacity = isDimmed
        ? 0.015
        : isHovered
        ? 0.35
        : 0.06 + s.heat * 0.06;
    }
  });

  return (
    <>
      {lines.map((l, i) => (
        <primitive key={`beam-${stations[i].pid}`} object={l} />
      ))}
    </>
  );
}

/** Pulses travelling along the beams — context being relayed into the core. */
function BeamPulses({
  stations,
  time,
  hoveredProject,
}: {
  stations: StationData[];
  time: React.RefObject<{ value: number }>;
  hoveredProject: string | null;
}) {
  const positionsAttrRef = useRef<THREE.BufferAttribute>(null);
  const alphaAttrRef = useRef<THREE.BufferAttribute>(null);

  const data = useMemo(() => {
    if (stations.length === 0) return null;
    const curves = stations.map((s) => {
      const mid = s.position.clone().multiplyScalar(0.45);
      mid.y = 0.55;
      return new THREE.QuadraticBezierCurve3(s.position.clone(), mid, new THREE.Vector3(0, 0, 0));
    });
    // Traffic scales with deposit volume: 2..10 pulses per station.
    const meta: { stationIdx: number; speed: number; offset: number; baseAlpha: number }[] = [];
    stations.forEach((s, i) => {
      const pulses = Math.max(2, Math.min(10, Math.round(2 + s.count / 8)));
      for (let p = 0; p < pulses; p++) {
        meta.push({
          stationIdx: i,
          speed: 0.10 + Math.random() * 0.22 + s.heat * 0.1,
          offset: Math.random(),
          baseAlpha: 0.4 + s.heat * 0.45,
        });
      }
    });
    const count = meta.length;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    meta.forEach((m, i) => {
      const c = stations[m.stationIdx].color;
      // Pulses run slightly hotter than their station so traffic reads bright.
      colors[i * 3] = Math.min(1, c.r + 0.25);
      colors[i * 3 + 1] = Math.min(1, c.g + 0.25);
      colors[i * 3 + 2] = Math.min(1, c.b + 0.15);
      sizes[i] = 0.09 + Math.random() * 0.05;
      alphas[i] = m.baseAlpha;
    });
    return { curves, meta, count, positions, sizes, alphas, colors };
  }, [stations]);

  useFrame(() => {
    if (!data || !time.current) return;
    const t = time.current.value;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < data.count; i++) {
      const m = data.meta[i];
      const progress = (t * m.speed + m.offset) % 1;
      data.curves[m.stationIdx].getPoint(progress, tmp);
      data.positions[i * 3] = tmp.x;
      data.positions[i * 3 + 1] = tmp.y;
      data.positions[i * 3 + 2] = tmp.z;
      const pid = stations[m.stationIdx].pid;
      if (hoveredProject) {
        data.alphas[i] = pid === hoveredProject ? Math.min(1, m.baseAlpha * 1.5) : m.baseAlpha * 0.12;
      } else {
        // Pulses brighten as they approach the core — the relay completing.
        data.alphas[i] = m.baseAlpha * (0.7 + 0.5 * progress);
      }
    }
    if (positionsAttrRef.current) positionsAttrRef.current.needsUpdate = true;
    if (alphaAttrRef.current) alphaAttrRef.current.needsUpdate = true;
  });

  if (!data) return null;

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute ref={positionsAttrRef} attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[data.sizes, 1]} />
        <bufferAttribute ref={alphaAttrRef} attach="attributes-aAlpha" args={[data.alphas, 1]} />
        <bufferAttribute attach="attributes-aColor" args={[data.colors, 3]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={pulseVertex}
        fragmentShader={pulseFragment}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/**
 * HistoryArcs — every package as a dot trailing its station along the orbit:
 * newest at the station, oldest at the end of the tail. Dot size/colour carry
 * significance (lime = KEY, white-cyan = SIG). This is the per-project
 * "transmission log" the cortex view can't show.
 */
function HistoryArcs({
  stations,
  hoveredProject,
}: {
  stations: StationData[];
  hoveredProject: string | null;
}) {
  const alphaAttrRef = useRef<THREE.BufferAttribute>(null);

  const data = useMemo(() => {
    if (stations.length === 0) return null;
    const slotSweep = ((Math.PI * 2) / Math.max(stations.length, 1)) * 0.72;
    const now = Date.now();
    const oldest = Math.max(
      ...stations.map((s) =>
        s.packages.length ? now - new Date(s.packages[s.packages.length - 1].created_at).getTime() : 0,
      ),
      1,
    );

    const entries: { x: number; y: number; z: number; size: number; alpha: number; r: number; g: number; b: number; stationIdx: number }[] = [];
    stations.forEach((s, si) => {
      const shown = s.packages.slice(0, ARC_DOTS_MAX);
      for (const pkg of shown) {
        const age = now - new Date(pkg.created_at).getTime();
        // sqrt spreads the (usually dense) recent cluster out a little
        const ageT = Math.sqrt(Math.min(1, age / oldest));
        const angle = s.angle - ageT * slotSweep;
        const radius = ARC_RADIUS + (Math.random() - 0.5) * 0.05;
        const sig = pkg.significance ?? 0;
        const isKey = sig >= 9;
        const isSig = sig >= 6;
        entries.push({
          x: Math.cos(angle) * radius,
          y: -0.1 + (Math.random() - 0.5) * 0.03,
          z: Math.sin(angle) * radius,
          size: isKey ? 0.13 : isSig ? 0.09 : 0.055,
          alpha: (isKey ? 0.95 : isSig ? 0.7 : 0.4) * (1 - ageT * 0.45),
          r: isKey ? 212 / 255 : isSig ? 190 / 255 : 30 / 255,
          g: isKey ? 245 / 255 : isSig ? 240 / 255 : 210 / 255,
          b: isKey ? 0 : isSig ? 252 / 255 : 250 / 255,
          stationIdx: si,
        });
      }
    });

    const count = entries.length;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const stationIdxOf = new Int32Array(count);
    const baseAlphas = new Float32Array(count);
    entries.forEach((e, i) => {
      positions[i * 3] = e.x;
      positions[i * 3 + 1] = e.y;
      positions[i * 3 + 2] = e.z;
      sizes[i] = e.size;
      alphas[i] = e.alpha;
      baseAlphas[i] = e.alpha;
      colors[i * 3] = e.r;
      colors[i * 3 + 1] = e.g;
      colors[i * 3 + 2] = e.b;
      stationIdxOf[i] = e.stationIdx;
    });
    return { count, positions, sizes, alphas, colors, stationIdxOf, baseAlphas };
  }, [stations]);

  useFrame(() => {
    if (!data) return;
    for (let i = 0; i < data.count; i++) {
      const pid = stations[data.stationIdxOf[i]]?.pid;
      data.alphas[i] = hoveredProject
        ? pid === hoveredProject
          ? Math.min(1, data.baseAlphas[i] * 1.5)
          : data.baseAlphas[i] * 0.1
        : data.baseAlphas[i];
    }
    if (alphaAttrRef.current) alphaAttrRef.current.needsUpdate = true;
  });

  if (!data) return null;

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[data.sizes, 1]} />
        <bufferAttribute ref={alphaAttrRef} attach="attributes-aAlpha" args={[data.alphas, 1]} />
        <bufferAttribute attach="attributes-aColor" args={[data.colors, 3]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={pulseVertex}
        fragmentShader={pulseFragment}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function FlowMesh({
  hoveredProject,
  setHoveredProject,
  onClickProject,
  windowDays,
  includeArchived,
  showAll,
}: {
  hoveredProject: string | null;
  setHoveredProject: (id: string | null) => void;
  onClickProject?: (id: string) => void;
  windowDays: number;
  includeArchived: boolean;
  showAll: boolean;
}) {
  const time = useRef({ value: 0 });
  const groupRef = useRef<THREE.Group>(null);
  const { projects } = useProjects({ includeArchived: true });
  const { packages } = usePackages(showAll ? { all: true } : { windowDays });

  const stations = useMemo(
    () => buildStations(packages, projects, includeArchived),
    [packages, projects, includeArchived],
  );

  useFrame((_, delta) => {
    time.current.value += delta;
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.04;
    }
  });

  return (
    <group ref={groupRef}>
      <Hub time={time} />
      <OrbitRing />
      <Beams stations={stations} hoveredProject={hoveredProject} />
      <BeamPulses stations={stations} time={time} hoveredProject={hoveredProject} />
      <HistoryArcs stations={stations} hoveredProject={hoveredProject} />
      <BackgroundMist time={time} count={160} />
      {stations.map((station) => (
        <Station
          key={station.pid}
          station={station}
          hoveredProject={hoveredProject}
          setHoveredProject={setHoveredProject}
          onClickProject={onClickProject}
          time={time}
        />
      ))}
    </group>
  );
}

export default function RelayFlow({
  onClickProject,
  windowDays = 14,
  includeArchived = false,
  showAll = false,
  cameraZ = 4.2,
  fov = 50,
}: {
  onClickProject?: (id: string) => void;
  windowDays?: number;
  includeArchived?: boolean;
  showAll?: boolean;
  cameraZ?: number;
  fov?: number;
} = {}) {
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);

  return (
    <div className="w-full h-full overflow-hidden relative">
      <Canvas camera={{ position: [0, 1.6, cameraZ], fov }} gl={{ alpha: true }}>
        <FlowMesh
          hoveredProject={hoveredProject}
          setHoveredProject={setHoveredProject}
          onClickProject={onClickProject}
          windowDays={windowDays}
          includeArchived={includeArchived}
          showAll={showAll}
        />
        <OrbitControls
          enableZoom={true}
          enablePan={true}
          enableRotate={true}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
          minDistance={1.5}
          maxDistance={9}
          zoomSpeed={0.5}
          panSpeed={0.5}
          minPolarAngle={Math.PI / 8}
          maxPolarAngle={Math.PI * 5 / 8}
        />
      </Canvas>
    </div>
  );
}
