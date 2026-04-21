'use client';

import dynamic from 'next/dynamic';

const BrainCore = dynamic(() => import('@/components/BrainCore'), { ssr: false });

// Chromeless, transparent, zoomed-in embed for use as a compact visual
// flourish (iframed inside the landing's hero card above the wordmark).
// cameraZ + autoRotate give it life in a small frame without relying on
// the visitor to drag the camera around.
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
      <BrainCore windowDays={14} includeArchived={false} cameraZ={2.6} fov={40} autoRotate={true} />
    </div>
  );
}
