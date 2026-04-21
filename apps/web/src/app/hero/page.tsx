'use client';

import dynamic from 'next/dynamic';

const CoreShader = dynamic(() => import('@/components/CoreShader'), { ssr: false });
const BrainCore = dynamic(() => import('@/components/BrainCore'), { ssr: false });

// Chromeless page — rendered full-bleed so the landing can iframe it
// as a living visual backdrop above the hero card. No topbar, no stats,
// no controls. The background waves + the 3D cortex carry the whole thing.
export default function HeroEmbed() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--rs-bg, #0a0c10)',
      }}
    >
      <CoreShader />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'auto',
        }}
      >
        <BrainCore windowDays={14} includeArchived={false} />
      </div>
    </div>
  );
}
