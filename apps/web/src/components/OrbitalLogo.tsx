'use client';

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function GlowCore() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    const s = 0.18 + 0.03 * Math.sin(t * 1.5);
    meshRef.current.scale.set(s, s, s);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 24, 24]} />
      <meshBasicMaterial color="#d4f500" transparent opacity={0.95} />
    </mesh>
  );
}

function GlowHalo() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    const s = 0.35 + 0.08 * Math.sin(t * 1.2);
    meshRef.current.scale.set(s, s, s);
    (meshRef.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.05 * Math.sin(t * 1.8);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 24, 24]} />
      <meshBasicMaterial color="#d4f500" transparent opacity={0.18} />
    </mesh>
  );
}

function OrbitalRing({ radius, speed, tilt, color, thickness = 0.012 }: {
  radius: number;
  speed: number;
  tilt: [number, number, number];
  color: string;
  thickness?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.z = clock.getElapsedTime() * speed;
  });

  // Create ring from a torus
  return (
    <group rotation={tilt}>
      <group ref={groupRef}>
        <mesh>
          <torusGeometry args={[radius, thickness, 16, 100]} />
          <meshBasicMaterial color={color} transparent opacity={0.6} />
        </mesh>
        {/* Small orbiting node on the ring */}
        <mesh position={[radius, 0, 0]}>
          <sphereGeometry args={[0.025, 8, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} />
        </mesh>
      </group>
    </group>
  );
}

function OrbitalSystem() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    // Very slow overall rotation
    groupRef.current.rotation.y = clock.getElapsedTime() * 0.15;
  });

  return (
    <group ref={groupRef}>
      <GlowCore />
      <GlowHalo />

      {/* Inner ring — fast, tilted, cyan */}
      <OrbitalRing
        radius={0.38}
        speed={0.8}
        tilt={[0.3, 0.5, 0]}
        color="#00ddff"
        thickness={0.01}
      />

      {/* Middle ring — medium speed, opposite tilt, lime */}
      <OrbitalRing
        radius={0.55}
        speed={-0.5}
        tilt={[-0.6, 0.2, 0.3]}
        color="#d4f500"
        thickness={0.008}
      />

      {/* Outer ring — slow, wide tilt, dim cyan */}
      <OrbitalRing
        radius={0.75}
        speed={0.3}
        tilt={[0.8, -0.3, -0.2]}
        color="#00b8d4"
        thickness={0.006}
      />

      {/* Extra thin outer ring — dim lime */}
      <OrbitalRing
        radius={0.9}
        speed={-0.2}
        tilt={[-0.2, 0.7, 0.5]}
        color="#8fa800"
        thickness={0.004}
      />
    </group>
  );
}

export default function OrbitalLogo({ size = 64 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="inline-block">
      <Canvas camera={{ position: [0, 0, 2], fov: 45 }} gl={{ alpha: true }}>
        <OrbitalSystem />
      </Canvas>
    </div>
  );
}
