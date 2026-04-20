'use client';

import { useStats } from '@/lib/hooks';

export default function StatsBar() {
  const stats = useStats();

  const cards = [
    { label: 'Context Packages', value: stats.totalPackages, sub: 'TOTAL' },
    { label: 'Key Packages', value: stats.keyPackages, sub: 'SIG ≥ 9' },
    { label: 'Active Facts', value: stats.activeFacts, sub: 'CURRENT TRUTH' },
    { label: 'Projects', value: stats.totalProjects, sub: 'ACTIVE' },
    { label: 'Sessions', value: stats.totalSessions, sub: 'TRACKED' },
    { label: 'Last 24h', value: stats.recentActivity, sub: 'PACKAGES' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="rs-stat-tile">
          <div className="rs-stat-label">{card.label}</div>
          <div className="rs-stat-value">{card.value}</div>
          <div className="rs-stat-sub">{card.sub}</div>
        </div>
      ))}
    </div>
  );
}
