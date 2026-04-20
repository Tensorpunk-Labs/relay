'use client';

import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface GradientRingsProps {
  windowDays: number;
}

const RING_CONFIG = [
  { tier: 'full',    baseRadius: 0.4, baseOpacity: 0.25, speed: 0.010 },
  { tier: 'medium',  baseRadius: 0.7, baseOpacity: 0.15, speed: 0.008 },
  { tier: 'light',   baseRadius: 1.0, baseOpacity: 0.08, speed: 0.006 },
  { tier: 'minimal', baseRadius: 1.3, baseOpacity: 0.04, speed: 0.004 },
] as const;

const CYAN = new THREE.Color('#00ddff');
const NEUTRAL_WINDOW = 14;

export default function GradientRings({ windowDays }: GradientRingsProps) {
  const ringsRef = useRef<THREE.Group>(null);
  const targetScale = windowDays / NEUTRAL_WINDOW;

  const animated = useRef(
    RING_CONFIG.map((cfg) => ({
      scale: 1,
      opacity: cfg.baseOpacity,
    })),
  );

  const materials = useMemo(
    () =>
      RING_CONFIG.map((cfg) =>
        new THREE.MeshBasicMaterial({
          color: CYAN,
          transparent: true,
          opacity: cfg.baseOpacity,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    [],
  );

  const geometries = useMemo(
    () =>
      RING_CONFIG.map((cfg) =>
        new THREE.RingGeometry(cfg.baseRadius - 0.01, cfg.baseRadius + 0.01, 64),
      ),
    [],
  );

  useFrame((_, delta) => {
    if (!ringsRef.current) return;
    const time = performance.now() * 0.001;

    ringsRef.current.children.forEach((child, i) => {
      const cfg = RING_CONFIG[i];
      const anim = animated.current[i];
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;

      // Lerp scale toward target
      anim.scale += (targetScale - anim.scale) * Math.min(delta * 3, 1);

      // Determine target opacity based on whether this tier is "in window"
      const tierDayEnd = [1, 5, 10, 14][i];
      const inWindow = windowDays >= tierDayEnd;
      const targetOpacity = inWindow
        ? cfg.baseOpacity + 0.05
        : cfg.baseOpacity * 0.3;

      // Lerp opacity
      anim.opacity += (targetOpacity - anim.opacity) * Math.min(delta * 3, 1);

      // Breathing
      const breath = Math.sin(time * 0.5 + i * 1.5) * 0.01;

      mat.opacity = Math.max(0, anim.opacity + breath);
      mesh.scale.setScalar(anim.scale);
      mesh.rotation.z += cfg.speed * delta;
    });
  });

  return (
    <group ref={ringsRef} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.3, 0]}>
      {RING_CONFIG.map((cfg, i) => (
        <mesh key={cfg.tier} geometry={geometries[i]} material={materials[i]} />
      ))}
    </group>
  );
}
