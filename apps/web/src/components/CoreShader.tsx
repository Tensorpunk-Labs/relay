'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Ferrofluid-style ambient blobs — white + cyan only, ~3x faster drift
// to match the run-048 reskin reference. No matrix rain.
const blobVertex = `
  uniform float uTime;
  attribute float aScale;
  attribute float aPhase;
  attribute float aHue;
  varying float vAlpha;
  varying float vHue;

  void main() {
    vec3 pos = position;
    // 3x speed multiplier vs the previous shader
    pos.y += sin(uTime * 0.18 + aPhase) * 0.65;
    pos.x += cos(uTime * 0.135 + aPhase * 1.7) * 0.45;
    pos.z += sin(uTime * 0.105 + aPhase * 0.9) * 0.22;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aScale * (260.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;

    vAlpha = 0.06 + 0.02 * sin(uTime * 0.24 + aPhase);
    vHue = aHue;
  }
`;

const blobFragment = `
  varying float vAlpha;
  varying float vHue;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    // Soft circular falloff with a touch of edge
    float glow = 1.0 - smoothstep(0.0, 0.46, d);
    glow = pow(glow, 2.2);

    // White blobs vs cyan blobs based on aHue
    vec3 white = vec3(0.95, 0.97, 1.00);
    vec3 cyan  = vec3(0.00, 0.85, 1.00);
    vec3 color = mix(white, cyan, step(0.5, vHue));

    gl_FragColor = vec4(color, glow * vAlpha);
  }
`;

function FerrofluidBlobs({ count = 6 }: { count?: number }) {
  const mesh = useRef<THREE.Points>(null);
  const uniforms = useRef({ uTime: { value: 0 } });

  const [positions, scales, phases, hues] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const sc = new Float32Array(count);
    const ph = new Float32Array(count);
    const hu = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4;
      // Big soft blobs — pumped scale so the ferrofluid blooms reach across
      sc[i] = 14.0 + Math.random() * 8.0;
      ph[i] = Math.random() * Math.PI * 2;
      // Half white (0), half cyan (1)
      hu[i] = i < count / 2 ? 0.0 : 1.0;
    }
    return [pos, sc, ph, hu];
  }, [count]);

  useFrame((_, delta) => {
    uniforms.current.uTime.value += delta;
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aScale" args={[scales, 1]} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
        <bufferAttribute attach="attributes-aHue" args={[hues, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={blobVertex}
        fragmentShader={blobFragment}
        uniforms={uniforms.current}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export default function CoreShader() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 5], fov: 60 }} gl={{ alpha: true }}>
        <FerrofluidBlobs count={6} />
      </Canvas>
    </div>
  );
}
