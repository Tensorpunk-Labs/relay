import type { OrientationBundle, GradientDay, OrientPackage, RenderTier, RelayFact } from './types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function decodeJsonEscapes(s: string): string {
  if (!s) return s;
  if (s.indexOf('\\u') === -1) return s;
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16)),
  );
}

function ago(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  const decoded = decodeJsonEscapes(s);
  const trimmed = decoded.trim().replace(/\s+/g, ' ');
  return trimmed.length > n ? trimmed.slice(0, n - 1) + '\u2026' : trimmed;
}

/** Strip leading [KEY]/[SIG] prefix so we don't double-label. */
function cleanTitle(t: string): string {
  return t.replace(/^\s*\[(KEY|SIG)[^\]]*\]\s*/i, '');
}

/** Format a date as "Mon DD". */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Build the compressed-types string: "2 decisions, 1 handoff, 3 auto-deposits" */
function formatCompressedTypes(types: Record<string, number>): string {
  const parts: string[] = [];
  const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted) {
    parts.push(`${count} ${type}${count > 1 ? 's' : ''}`);
  }
  return parts.join(', ');
}

// ── Tier-Specific Renderers ─────────────────────────────────────────

function renderPackageFull(p: OrientPackage): string[] {
  const lines: string[] = [];
  const tier = p.significance >= 9 ? 'KEY' : 'SIG';
  const meta: string[] = [];
  if (p.topic) meta.push(`Topic: ${p.topic}`);
  if (p.artifact_type) meta.push(`Type: ${p.artifact_type}`);

  lines.push(`- **[${tier} ${p.significance}] ${truncate(cleanTitle(p.title), 80)}** \u2014 \`${p.id}\` (${ago(p.created_at)})`);
  if (p.handoff_note) {
    lines.push(`  > ${truncate(p.handoff_note, 180)}`);
  }
  if (meta.length > 0) {
    lines.push(`  ${meta.join(' | ')}`);
  }
  return lines;
}

function renderPackageMedium(p: OrientPackage): string[] {
  const lines: string[] = [];
  const tier = p.significance >= 9 ? 'KEY' : 'SIG';
  const tags: string[] = [];
  if (p.topic) tags.push(p.topic);
  if (p.artifact_type) tags.push(p.artifact_type);
  const tagStr = tags.length > 0 ? ` | ${tags.join(', ')}` : '';

  lines.push(`- **[${tier} ${p.significance}] ${truncate(cleanTitle(p.title), 80)}** \u2014 \`${p.id}\`${tagStr}`);
  if (p.promoted && p.handoff_note) {
    lines.push(`  > ${truncate(p.handoff_note, 80)}`);
  }
  return lines;
}

function renderPackageLight(p: OrientPackage): string[] {
  const tag = p.topic ? ` \u2014 ${p.topic}` : '';
  const tier = p.significance >= 9 ? 'KEY' : 'SIG';
  return [`- [${tier} ${p.significance}] ${truncate(cleanTitle(p.title), 60)}${tag}`];
}

// ── Main Formatter ──────────────────────────────────────────────────

/**
 * Render a gradient OrientationBundle as compact markdown.
 * Detail fades with age: full (0-1d) -> medium (2-5d) -> light (6-10d) -> minimal (11+d).
 * Significance >= promotion threshold bumps packages up one tier.
 */
export function formatOrientationBundle(b: OrientationBundle): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Relay orientation \u2014 ${b.project_id} (${decodeJsonEscapes(b.project_name)})`);
  lines.push(
    `_${b.window_days}-day window, ${b.recent_package_count} packages` +
    `${b.total_open_questions > 0 ? `, ${b.total_open_questions} open question${b.total_open_questions === 1 ? '' : 's'}` : ''}` +
    `${b.total_active_facts > 0 ? `, ${b.total_active_facts} active fact${b.total_active_facts === 1 ? '' : 's'}` : ''}` +
    `_`,
  );
  lines.push('');

  // ── Day groups ──
  let i = 0;
  while (i < b.days.length) {
    const day = b.days[i];

    if (day.base_tier === 'full') {
      const label = day.age_days === 0 ? 'Today' : day.age_days === 1 ? 'Yesterday' : formatDate(day.date);
      const heading = day.age_days <= 1 ? label : `${label} (${day.age_days}d ago)`;
      lines.push(`## ${heading}`);
      for (const p of day.preserved) {
        lines.push(...renderPackageFull(p));
      }
      if (day.compressed_count > 0) {
        lines.push(`  _\u2026and ${day.compressed_count} more: ${formatCompressedTypes(day.compressed_types)}_`);
      }
      lines.push('');
      i++;

    } else if (day.base_tier === 'medium') {
      const mediumDays: GradientDay[] = [];
      while (i < b.days.length && b.days[i].base_tier === 'medium') {
        mediumDays.push(b.days[i]);
        i++;
      }
      const first = mediumDays[0];
      const last = mediumDays[mediumDays.length - 1];
      const range = mediumDays.length === 1
        ? `${formatDate(first.date)} (${first.age_days}d ago)`
        : `${formatDate(last.date)}\u2013${formatDate(first.date)} (${last.age_days}-${first.age_days}d ago)`;
      lines.push(`## ${range}`);
      for (const d of mediumDays) {
        for (const p of d.preserved) {
          lines.push(...renderPackageMedium(p));
        }
        if (d.compressed_count > 0) {
          lines.push(`  _\u2026and ${d.compressed_count} more: ${formatCompressedTypes(d.compressed_types)}_`);
        }
      }
      lines.push('');

    } else if (day.base_tier === 'light') {
      const lightDays: GradientDay[] = [];
      while (i < b.days.length && b.days[i].base_tier === 'light') {
        lightDays.push(b.days[i]);
        i++;
      }
      const first = lightDays[0];
      const last = lightDays[lightDays.length - 1];
      const range = lightDays.length === 1
        ? `${formatDate(first.date)} (${first.age_days}d ago)`
        : `${formatDate(last.date)}\u2013${formatDate(first.date)} (${last.age_days}-${first.age_days}d ago)`;
      lines.push(`## ${range}`);
      for (const d of lightDays) {
        for (const p of d.preserved) {
          lines.push(...renderPackageLight(p));
        }
      }
      const totalCompressed = lightDays.reduce((s, d) => s + d.compressed_count, 0);
      if (totalCompressed > 0) {
        const mergedTypes: Record<string, number> = {};
        for (const d of lightDays) {
          for (const [t, c] of Object.entries(d.compressed_types)) {
            mergedTypes[t] = (mergedTypes[t] ?? 0) + c;
          }
        }
        const totalAll = lightDays.reduce((s, d) => s + d.preserved.length + d.compressed_count, 0);
        lines.push(`  _${totalAll} packages: ${formatCompressedTypes(mergedTypes)}_`);
      }
      lines.push('');

    } else {
      // Minimal tier: topic activity counts only
      const minDays: GradientDay[] = [];
      while (i < b.days.length && b.days[i].base_tier === 'minimal') {
        minDays.push(b.days[i]);
        i++;
      }
      const totalPkgs = minDays.reduce((s, d) => s + d.preserved.length + d.compressed_count, 0);
      if (totalPkgs > 0) {
        const first = minDays[0];
        const last = minDays[minDays.length - 1];
        const range = minDays.length === 1
          ? `${formatDate(first.date)} (${first.age_days}d ago)`
          : `${formatDate(last.date)}\u2013${formatDate(first.date)} (${last.age_days}-${first.age_days}d ago)`;
        lines.push(`## ${range}`);
        const topicMap: Record<string, number> = {};
        for (const d of minDays) {
          for (const p of d.preserved) {
            const key = p.topic ?? 'other';
            topicMap[key] = (topicMap[key] ?? 0) + 1;
          }
          if (d.compressed_count > 0) {
            const dayTopic = d.preserved[0]?.topic ?? 'other';
            topicMap[dayTopic] = (topicMap[dayTopic] ?? 0) + d.compressed_count;
          }
        }
        const topicStr = Object.entries(topicMap)
          .sort((a, b) => b[1] - a[1])
          .map(([t, c]) => `${t}: ${c}`)
          .join(' | ');
        lines.push(`_${topicStr}_`);
        lines.push('');
      }
    }
  }

  // ── Latest handoff ──
  if (b.latest_handoff) {
    const alreadyRendered = b.days.some((d) =>
      d.preserved.some((p) => p.id === b.latest_handoff!.package_id),
    );
    if (!alreadyRendered) {
      lines.push(`## Latest handoff (${ago(b.latest_handoff.created_at)})`);
      lines.push(`_${truncate(cleanTitle(b.latest_handoff.title), 80)}_ \u2014 \`${b.latest_handoff.package_id}\``);
      lines.push(`> ${truncate(b.latest_handoff.handoff_note, 220)}`);
      lines.push('');
    }
  }

  // ── Active facts ──
  if (b.active_facts.length > 0) {
    lines.push('## Active facts');
    for (const f of b.active_facts) {
      const value = `**${decodeJsonEscapes(f.subject)}** ${decodeJsonEscapes(f.relation)} **${decodeJsonEscapes(f.object)}**`;
      lines.push(`- ${value} _(since ${ago(f.valid_from)})_`);
    }
    if (b.total_active_facts > b.active_facts.length) {
      lines.push(`- _\u2026and ${b.total_active_facts - b.active_facts.length} more (use \`relay facts query\` for the full set)_`);
    }
    lines.push('');
  }

  // ── Open questions ──
  if (b.open_questions.length > 0) {
    lines.push('## Open questions');
    for (const q of b.open_questions) {
      lines.push(`- ${truncate(q, 140)}`);
    }
    lines.push('');
  }

  // Footer
  lines.push('_Auto-loaded by Relay session orient. Deposit proactively at key moments (`relay_deposit`). Use `relay_pull_context` for more, `relay_orchestrate` for the full digest._');

  return lines.join('\n');
}
