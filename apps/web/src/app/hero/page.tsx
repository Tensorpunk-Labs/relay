'use client';

import dynamic from 'next/dynamic';

const BrainCore = dynamic(() => import('@/components/BrainCore'), { ssr: false });

// Chromeless, transparent embed. Designed to be iframed as a backdrop
// layer behind the landing's hero card — the host page provides its own
// background gradient and the brain floats on top of it.
export default function HeroEmbed() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'transparent',
      }}
    >
      <BrainCore windowDays={14} includeArchived={false} />
    </div>
  );
}
