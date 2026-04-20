'use client';

import { useRef, useMemo, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { usePackages, useProjects } from '@/lib/hooks';
import GradientRings from './GradientRings';

// Cluster colour palette — derived from the run-048 waveform particle
// system: cyan body, white-cyan highlights, plus a lime peak accent.
// We tilt all projects toward cool hues so the network reads as a
// single flowing system instead of a rainbow.
const PROJECT_COLORS: Record<string, string> = {};
const PALETTE = [
  '#00ddff', // cyan (primary)
  '#7be6ff', // white-cyan
  '#aaf0ff', // pale cyan
  '#3cb4ff', // mid-cyan
  '#d4f500', // lime peak (one slot — the "yellow-green spark" projects)
  '#5fe0ff', // bright cyan
];

function getProjectColor(projectId: string, index: number): string {
  if (!PROJECT_COLORS[projectId]) {
    PROJECT_COLORS[projectId] = PALETTE[index % PALETTE.length];
  }
  return PROJECT_COLORS[projectId];
}

/**
 * Brain-like layered structure:
 * - Core (brainstem): largest project at center
 * - Inner layer (limbic): next largest projects, tight around core
 * - Outer layer (cortex): smaller projects, spread wider on X axis
 *
 * Wider than tall (like a real brain), uses full 3D depth.
 */
function generateClusterCenters(
  projectIds: string[],
  packageCounts: Map<string, number>,
): Map<string, THREE.Vector3> {
  const centers = new Map<string, THREE.Vector3>();

  const sorted = [...projectIds].sort(
    (a, b) => (packageCounts.get(b) || 0) - (packageCounts.get(a) || 0),
  );

  if (sorted.length === 0) return centers;

  // Core — largest project
  centers.set(sorted[0], new THREE.Vector3(0, 0, 0));

  // Assign layers based on relative size
  const maxCount = packageCounts.get(sorted[0]) || 1;

  for (let i = 1; i < sorted.length; i++) {
    const count = packageCounts.get(sorted[i]) || 0;
    const sizeRatio = count / maxCount;

    // Bigger projects stay closer to core (inner layer), smaller go to cortex
    const layer = sizeRatio > 0.3 ? 0.6 : sizeRatio > 0.1 ? 1.0 : 1.4;

    // Fibonacci sphere placement within the layer
    const phi = Math.acos(1 - 2 * (i + 0.5) / Math.max(sorted.length, 2));
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;

    centers.set(sorted[i], new THREE.Vector3(
      layer * Math.sin(phi) * Math.cos(theta) * 1.8, // wide on X
      layer * Math.sin(phi) * Math.sin(theta) * 0.9,  // shorter on Y
      layer * Math.cos(phi) * 1.1,                     // decent depth on Z
    ));
  }

  return centers;
}

function generateNodePosition(center: THREE.Vector3, index: number, total: number): THREE.Vector3 {
  // Tight fibonacci sphere — cluster radius grows slowly with count
  const clusterRadius = 0.25 + Math.sqrt(Math.min(total, 50)) * 0.07;
  const phi = Math.acos(1 - 2 * (index + 0.5) / Math.max(total, 1));
  const theta = Math.PI * (1 + Math.sqrt(5)) * index;
  const r = clusterRadius * (0.5 + Math.random() * 0.5);
  return new THREE.Vector3(
    center.x + r * Math.sin(phi) * Math.cos(theta),
    center.y + r * Math.sin(phi) * Math.sin(theta),
    center.z + r * Math.cos(phi),
  );
}

interface NodeData {
  position: THREE.Vector3;
  color: string;
  isRecent: boolean;
  projectId: string;
  significance: number;
}

function DataNodes({ nodes, time, hoveredProject }: { nodes: NodeData[]; time: React.RefObject<{ value: number }>; hoveredProject: string | null }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const colorRef = useRef<THREE.InstancedBufferAttribute>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const phases = useMemo(() => nodes.map(() => Math.random() * Math.PI * 2), [nodes]);

  const colors = useMemo(() => {
    const arr = new Float32Array(nodes.length * 3);
    for (let i = 0; i < nodes.length; i++) {
      const c = new THREE.Color(nodes[i].color);
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    return arr;
  }, [nodes]);

  useFrame(() => {
    if (!meshRef.current || !time.current) return;
    const t = time.current.value;
    for (let i = 0; i < nodes.length; i++) {
      const isHovered = hoveredProject && nodes[i].projectId === hoveredProject;
      const isDimmed = hoveredProject && !isHovered;

      // High significance pulses brighter regardless of recency
      const sigBoost = nodes[i].significance >= 9 ? 0.15 : nodes[i].significance >= 6 ? 0.08 : 0;
      const pulse = isHovered
        ? 0.8 + 0.2 * Math.sin(t * 3 + phases[i])
        : nodes[i].isRecent
        ? 0.7 + 0.3 * Math.sin(t * 2 + phases[i])
        : (0.5 + sigBoost) + 0.2 * Math.sin(t * 0.4 + phases[i]);

      // Significance drives base size: KEY (>=9) = large, SIG (>=6) = medium, low = small
      const sig = nodes[i].significance;
      const sigSize = sig >= 9 ? 0.055 : sig >= 6 ? 0.045 : 0.035;
      const baseSize = isHovered ? 0.06 : nodes[i].isRecent ? Math.max(0.05, sigSize) : sigSize;
      const s = baseSize * pulse * (isDimmed ? 0.5 : 1.0);
      dummy.position.copy(nodes[i].position);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (nodes.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, nodes.length]}>
      <sphereGeometry args={[1, 10, 10]} />
      <instancedBufferGeometry>
        <bufferAttribute ref={colorRef} attach="attributes-color" args={[colors, 3]} />
      </instancedBufferGeometry>
      <meshBasicMaterial color="#4dc9f6" transparent opacity={0.9} />
    </instancedMesh>
  );
}

function ClusterEdges({ nodes, indices, time, hoveredProject, projectId, color }: {
  nodes: NodeData[];
  indices: number[];
  time: React.RefObject<{ value: number }>;
  hoveredProject: string | null;
  projectId: string;
  color: string;
}) {
  const lineRef = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const edges: [number, number][] = [];
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        if (nodes[indices[i]].position.distanceTo(nodes[indices[j]].position) < 0.7) {
          edges.push([indices[i], indices[j]]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(edges.length * 6);
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i];
      positions[i * 6] = nodes[a].position.x;
      positions[i * 6 + 1] = nodes[a].position.y;
      positions[i * 6 + 2] = nodes[a].position.z;
      positions[i * 6 + 3] = nodes[b].position.x;
      positions[i * 6 + 4] = nodes[b].position.y;
      positions[i * 6 + 5] = nodes[b].position.z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [nodes, indices]);

  useFrame(() => {
    if (!lineRef.current || !time.current) return;
    const t = time.current.value;
    const mat = lineRef.current.material as THREE.LineBasicMaterial;
    const isHovered = hoveredProject === projectId;
    const isDimmed = hoveredProject && !isHovered;
    const base = indices.length < 10 ? 0.2 : indices.length < 30 ? 0.12 : 0.06;
    mat.opacity = isDimmed ? 0.02 : isHovered ? base + 0.25 + 0.05 * Math.sin(t * 0.5) : base + 0.03 * Math.sin(t * 0.3);
  });

  return (
    <lineSegments ref={lineRef} geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.1} />
    </lineSegments>
  );
}

// Inter-cluster edges (connections between different projects)
function BridgeEdges({ nodes, time, hoveredProject }: { nodes: NodeData[]; time: React.RefObject<{ value: number }>; hoveredProject: string | null }) {
  const lineRef = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const edges: [number, number][] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].projectId !== nodes[j].projectId && nodes[i].position.distanceTo(nodes[j].position) < 0.7) {
          edges.push([i, j]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(edges.length * 6);
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i];
      positions[i * 6] = nodes[a].position.x;
      positions[i * 6 + 1] = nodes[a].position.y;
      positions[i * 6 + 2] = nodes[a].position.z;
      positions[i * 6 + 3] = nodes[b].position.x;
      positions[i * 6 + 4] = nodes[b].position.y;
      positions[i * 6 + 5] = nodes[b].position.z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [nodes]);

  useFrame(() => {
    if (!lineRef.current || !time.current) return;
    const mat = lineRef.current.material as THREE.LineBasicMaterial;
    mat.opacity = hoveredProject ? 0.01 : 0.04;
  });

  return (
    <lineSegments ref={lineRef} geometry={geometry}>
      <lineBasicMaterial color="#4dc9f6" transparent opacity={0.04} />
    </lineSegments>
  );
}

/**
 * WaveformPulses — particles flowing along network edges, styled after
 * the run-048 helix waveform shader. Uses additive-blended Points with
 * a custom shader so the particles glow when they overlap. Each
 * particle gets one of four colour tiers, matching the waveform's
 * "cyan body / white-cyan highlights / white spark / lime peak" story.
 */
const PARTICLES_PER_EDGE = 4;
const MAX_PARTICLES = 600;

const pulseVertex = `
  uniform float uTime;
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (180.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const pulseFragment = `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float glow = 1.0 - smoothstep(0.0, 0.5, r);
    glow = pow(glow, 2.0);
    gl_FragColor = vec4(vColor, glow * vAlpha);
  }
`;

function WaveformPulses({
  nodes,
  time,
  hoveredProject,
}: {
  nodes: NodeData[];
  time: React.RefObject<{ value: number }>;
  hoveredProject: string | null;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const positionsAttrRef = useRef<THREE.BufferAttribute>(null);
  const alphaAttrRef = useRef<THREE.BufferAttribute>(null);

  const edges = useMemo(() => {
    const result: [number, number][] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].position.distanceTo(nodes[j].position) < 0.7) {
          result.push([i, j]);
        }
      }
    }
    return result;
  }, [nodes]);

  // Build particle metadata: which edge, speed, offset, jitter, colour, base alpha, base size
  const particles = useMemo(() => {
    if (edges.length === 0) return null;
    const count = Math.min(MAX_PARTICLES, edges.length * PARTICLES_PER_EDGE);
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const meta = Array.from({ length: count }, (_, i) => {
      const edgeIdx = i % edges.length;
      const speed = 0.18 + Math.random() * 0.45;
      const offset = Math.random();
      // Jitter in the perpendicular plane so particles don't sit on the line
      const jitterAxis = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      const jitterAmt = (Math.random() - 0.5) * 0.05;

      // Colour tier — same distribution as run-048 waveform:
      //   55% cyan body, 30% white-cyan highlights, 12% white sparks, 3% lime peaks
      const roll = Math.random();
      let r: number, g: number, b: number;
      let baseSize: number;
      let baseAlpha: number;
      if (roll < 0.55) {
        // Dominant cyan body
        r = (20 + Math.random() * 40) / 255;
        g = (200 + Math.random() * 30) / 255;
        b = (245 + Math.random() * 10) / 255;
        baseSize = 0.10 + Math.random() * 0.06;
        baseAlpha = 0.55 + Math.random() * 0.35;
      } else if (roll < 0.85) {
        // White-cyan highlight
        r = (170 + Math.random() * 40) / 255;
        g = (235 + Math.random() * 15) / 255;
        b = 252 / 255;
        baseSize = 0.08 + Math.random() * 0.05;
        baseAlpha = 0.5 + Math.random() * 0.35;
      } else if (roll < 0.97) {
        // Bright white sparks
        r = (220 + Math.random() * 30) / 255;
        g = (245 + Math.random() * 10) / 255;
        b = 250 / 255;
        baseSize = 0.07 + Math.random() * 0.06;
        baseAlpha = 0.7 + Math.random() * 0.25;
      } else {
        // Lime peak sparks
        r = 220 / 255;
        g = 240 / 255;
        b = 0;
        baseSize = 0.13 + Math.random() * 0.06;
        baseAlpha = 0.85 + Math.random() * 0.15;
      }
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      sizes[i] = baseSize;
      alphas[i] = baseAlpha;

      return { edgeIdx, speed, offset, jitterAxis, jitterAmt, baseAlpha };
    });
    return { count, positions, sizes, alphas, colors, meta };
  }, [edges]);

  useFrame(() => {
    if (!pointsRef.current || !time.current || !particles || edges.length === 0) return;
    const t = time.current.value;
    const { positions, alphas, meta, count } = particles;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const p = meta[i];
      const edge = edges[p.edgeIdx];
      if (!edge) continue;
      const [a, b] = edge;
      const progress = (t * p.speed + p.offset) % 1;
      // Slight ease-in-out so particles cluster gently at endpoints
      const eased = progress;
      tmp.lerpVectors(nodes[a].position, nodes[b].position, eased);
      // Perpendicular jitter
      tmp.addScaledVector(p.jitterAxis, p.jitterAmt);
      positions[i * 3] = tmp.x;
      positions[i * 3 + 1] = tmp.y;
      positions[i * 3 + 2] = tmp.z;

      // Dim particles whose edge belongs to a non-hovered project
      if (hoveredProject) {
        const aProj = nodes[a].projectId;
        const bProj = nodes[b].projectId;
        const onHovered = aProj === hoveredProject || bProj === hoveredProject;
        alphas[i] = onHovered ? p.baseAlpha * 1.3 : p.baseAlpha * 0.18;
      } else {
        // Slow breathing modulation so the stream feels alive
        const breathe = 0.85 + 0.15 * Math.sin(t * 0.6 + i * 0.13);
        alphas[i] = p.baseAlpha * breathe;
      }
    }
    if (positionsAttrRef.current) positionsAttrRef.current.needsUpdate = true;
    if (alphaAttrRef.current) alphaAttrRef.current.needsUpdate = true;
  });

  if (!particles) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          ref={positionsAttrRef}
          attach="attributes-position"
          args={[particles.positions, 3]}
        />
        <bufferAttribute attach="attributes-aSize" args={[particles.sizes, 1]} />
        <bufferAttribute
          ref={alphaAttrRef}
          attach="attributes-aAlpha"
          args={[particles.alphas, 1]}
        />
        <bufferAttribute attach="attributes-aColor" args={[particles.colors, 3]} />
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
 * BackgroundMist — slow drifting white-cyan haze particles behind the
 * network, ported from the run-048 waveform mist droplets.
 */
function BackgroundMist({ count = 220, time }: { count?: number; time: React.RefObject<{ value: number }> }) {
  const pointsRef = useRef<THREE.Points>(null);

  const [positions, sizes, alphas, colors, phases] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    const al = new Float32Array(count);
    const co = new Float32Array(count * 3);
    const ph = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 5;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 5;
      sz[i] = 0.05 + Math.random() * 0.05;
      al[i] = 0.05 + Math.random() * 0.10;
      // Cool white-cyan haze
      co[i * 3] = (200 + Math.random() * 30) / 255;
      co[i * 3 + 1] = (235 + Math.random() * 15) / 255;
      co[i * 3 + 2] = 252 / 255;
      ph[i] = Math.random() * Math.PI * 2;
    }
    return [pos, sz, al, co, ph];
  }, [count]);

  useFrame(() => {
    if (!pointsRef.current || !time.current) return;
    const t = time.current.value;
    const posAttr = pointsRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const baseY = ((i * 17) % 100) / 100 - 0.5;
      const drift = Math.sin(t * 0.04 + phases[i]) * 0.4;
      posAttr.setY(i, baseY * 3 + drift);
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aAlpha" args={[alphas, 1]} />
        <bufferAttribute attach="attributes-aColor" args={[colors, 3]} />
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

function BrainMesh({ hoveredProject, setHoveredProject, onClickProject, windowDays, includeArchived }: { hoveredProject: string | null; setHoveredProject: (id: string | null) => void; onClickProject?: (id: string) => void; windowDays: number; includeArchived: boolean }) {
  const time = useRef({ value: 0 });
  const groupRef = useRef<THREE.Group>(null);
  // Always fetch the full project list (archived + active) so names resolve
  // even when an archived project's packages still appear in the window.
  // The `includeArchived` prop then decides whether to keep archived
  // clusters in the cortex or drop them entirely — matches the "Active
  // Projects" / "All Projects" toggle in page.tsx.
  const { projects } = useProjects({ includeArchived: true });
  const { packages } = usePackages();

  const clusterInfo = useMemo(() => {
    const projectsById = new Map(projects.map((p) => [p.id, p]));
    const visibleIds = new Set(
      projects.filter((p) => includeArchived || !p.archived_at).map((p) => p.id),
    );
    // Packages whose project is hidden (archived + toggle off) or missing
    // (stray orphan row) are dropped rather than falling back to a raw-ID
    // cluster. Previously they rendered with `pid.replace('proj_', '')` —
    // that's where the ugly hex strings in the cortex came from.
    const visiblePackages = packages.filter((p) => visibleIds.has(p.project_id));
    const projectIds = [...new Set(visiblePackages.map((p) => p.project_id))];
    const packageCounts = new Map<string, number>();
    for (const pid of projectIds) {
      packageCounts.set(pid, visiblePackages.filter((p) => p.project_id === pid).length);
    }
    const centers = generateClusterCenters(projectIds, packageCounts);
    return projectIds.map((pid, pi) => {
      const center = centers.get(pid) || new THREE.Vector3(0, 0, 0);
      const color = getProjectColor(pid, pi);
      const count = packageCounts.get(pid) || 0;
      const project = projectsById.get(pid);
      const name = project?.name || pid;
      return { pid, center, color, count, name };
    });
  }, [projects, packages, includeArchived]);

  const nodes: NodeData[] = useMemo(() => {
    if (projects.length === 0) return [];
    const now = Date.now();
    const recentThreshold = 60 * 60 * 1000;

    const result: NodeData[] = [];
    for (const cluster of clusterInfo) {
      const projectPkgs = packages.filter((p) => p.project_id === cluster.pid);
      for (let i = 0; i < projectPkgs.length; i++) {
        const isRecent = now - new Date(projectPkgs[i].created_at).getTime() < recentThreshold;
        result.push({
          position: generateNodePosition(cluster.center, i, projectPkgs.length),
          color: cluster.color,
          isRecent,
          projectId: cluster.pid,
          significance: projectPkgs[i].significance ?? 0,
        });
      }
    }
    return result;
  }, [projects, packages, clusterInfo]);

  useFrame((_, delta) => {
    time.current.value += delta;
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.06;
    }
  });

  return (
    <group ref={groupRef}>
      <DataNodes nodes={nodes} time={time} hoveredProject={hoveredProject} />
      {clusterInfo.map((cluster) => {
        const indices = nodes.map((n, i) => n.projectId === cluster.pid ? i : -1).filter((i) => i >= 0);
        return (
          <ClusterEdges
            key={`edges-${cluster.pid}`}
            nodes={nodes}
            indices={indices}
            time={time}
            hoveredProject={hoveredProject}
            projectId={cluster.pid}
            color={cluster.color}
          />
        );
      })}
      <BridgeEdges nodes={nodes} time={time} hoveredProject={hoveredProject} />
      <BackgroundMist time={time} />
      <GradientRings windowDays={windowDays} />
      <WaveformPulses nodes={nodes} time={time} hoveredProject={hoveredProject} />
      {clusterInfo.map((cluster) => {
        const isHovered = hoveredProject === cluster.pid;
        const isDimmed = hoveredProject && !isHovered;
        return (
          <Html
            key={cluster.pid}
            position={[cluster.center.x, cluster.center.y - 0.65, cluster.center.z]}
            center
            distanceFactor={5}
          >
            <div
              className="text-center whitespace-nowrap cursor-pointer select-none"
              style={{ opacity: isDimmed ? 0.25 : 1, transition: 'opacity 0.2s' }}
              onPointerEnter={() => setHoveredProject(cluster.pid)}
              onPointerLeave={() => setHoveredProject(null)}
              onClick={() => onClickProject?.(cluster.pid)}
            >
              <div
                className="font-semibold tracking-wide"
                style={{
                  color: cluster.color,
                  fontSize: isHovered ? '13px' : '11px',
                  textShadow: isHovered ? `0 0 12px ${cluster.color}` : 'none',
                  transition: 'all 0.2s',
                }}
              >
                {cluster.name}
              </div>
              <div className="text-[9px] text-white/40">
                {cluster.count} pkg{cluster.count !== 1 ? 's' : ''}
              </div>
            </div>
          </Html>
        );
      })}
    </group>
  );
}

export default function BrainCore({ onClickProject, windowDays = 14, onWindowChange, includeArchived = false }: { onClickProject?: (id: string) => void; windowDays?: number; onWindowChange?: (days: number) => void; includeArchived?: boolean } = {}) {
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);

  return (
    <div className="w-full h-full overflow-hidden relative">
      <Canvas camera={{ position: [0, 0.15, 3], fov: 50 }} gl={{ alpha: true }}>
        <BrainMesh hoveredProject={hoveredProject} setHoveredProject={setHoveredProject} onClickProject={onClickProject} windowDays={windowDays} includeArchived={includeArchived} />
        <OrbitControls
          enableZoom={true}
          enablePan={true}
          enableRotate={true}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
          autoRotate={false}
          minDistance={1.2}
          maxDistance={8}
          zoomSpeed={0.5}
          panSpeed={0.5}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI * 5 / 6}
        />
      </Canvas>

    </div>
  );
}
