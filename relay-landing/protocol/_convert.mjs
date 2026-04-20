// One-shot converter: reads docs/AGENTIC_PROTOCOL.md and writes index.html
// using a hand-tuned page shell that matches the rest of the relay-landing
// site. Run with: node _convert.mjs
//
// This script is committed for reproducibility but is not served — it lives
// inside relay-landing/protocol/ alongside the generated index.html so the
// next person can re-run it after spec edits.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { marked } from 'marked';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Spec source: prefer the worktree copy if present; fall back to the
// canonical location in the main relay repo so this script works regardless
// of which checkout it runs from.
const SPEC_CANDIDATES = [
  resolve(__dirname, '../../docs/AGENTIC_PROTOCOL.md'),
  resolve('/path/to/relay'),
];
const SPEC_PATH = SPEC_CANDIDATES.find((p) => existsSync(p));
if (!SPEC_PATH) {
  throw new Error('Could not locate AGENTIC_PROTOCOL.md in any expected location.');
}
const OUT_PATH = resolve(__dirname, 'index.html');

const md = readFileSync(SPEC_PATH, 'utf8');

// Build a slugger that mirrors how we want to anchor sections.
// Headings like "## 1. The Problem" -> id "section-1"; "## Appendix A — ..." -> "appendix-a"; otherwise slugified.
function makeSlug(text, depth) {
  const trimmed = text.replace(/<[^>]+>/g, '').trim();
  // Section N pattern
  const sectionMatch = trimmed.match(/^(\d+)\./);
  if (sectionMatch && depth === 2) return `section-${sectionMatch[1]}`;
  const subsectionMatch = trimmed.match(/^(\d+)\.(\d+)/);
  if (subsectionMatch && depth === 3) return `section-${subsectionMatch[1]}-${subsectionMatch[2]}`;
  const appendixMatch = trimmed.match(/^Appendix\s+([A-Z])/i);
  if (appendixMatch) return `appendix-${appendixMatch[1].toLowerCase()}`;
  // Fallback: kebab-case
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

// Collect TOC as we render.
const toc = [];

const renderer = new marked.Renderer();

renderer.heading = function ({ text, depth, tokens }) {
  // Use the parser to render inline tokens, so we get inline code formatting etc.
  const inner = this.parser.parseInline(tokens);
  const slug = makeSlug(text, depth);
  if (depth === 2) toc.push({ depth, text: stripTags(inner), slug });
  // Subsections (depth 3) are also useful in TOC for top-level navigation
  if (depth === 3) toc.push({ depth, text: stripTags(inner), slug });
  return `<h${depth} id="${slug}"><a class="anchor" href="#${slug}" aria-hidden="true">#</a> ${inner}</h${depth}>\n`;
};

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '');
}

// Add a class to the table so CSS can style it.
renderer.table = function ({ header, rows }) {
  const headHtml = header
    .map((cell) => `<th${cell.align ? ` style="text-align:${cell.align}"` : ''}>${this.parser.parseInline(cell.tokens)}</th>`)
    .join('');
  const bodyHtml = rows
    .map(
      (row) =>
        '<tr>' +
        row
          .map((cell) => `<td${cell.align ? ` style="text-align:${cell.align}"` : ''}>${this.parser.parseInline(cell.tokens)}</td>`)
          .join('') +
        '</tr>'
    )
    .join('');
  return `<div class="table-wrap"><table class="spec-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>\n`;
};

// Code blocks: wrap with our themed pre/code.
renderer.code = function ({ text, lang }) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const langAttr = lang ? ` data-lang="${lang}"` : '';
  return `<pre class="code-pre"${langAttr}><code>${escaped}</code></pre>\n`;
};

// Inline code: keep <code> with our class.
renderer.codespan = function ({ text }) {
  return `<code>${text}</code>`;
};

// Horizontal rules become section separators.
renderer.hr = function () {
  return '<div class="spec-hr"></div>\n';
};

marked.setOptions({ renderer, gfm: true, breaks: false });
const body = marked.parse(md);

// Build TOC HTML — only depth 2 entries (the main sections).
const tocItems = toc
  .filter((t) => t.depth === 2)
  .map((t) => `<li><a href="#${t.slug}">${t.text}</a></li>`)
  .join('\n');

const HEAD = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Agentic Protocol &mdash; v0.1 &middot; Relay</title>
  <meta name="description" content="The Agentic Protocol v0.1 — open specification for how AI agents and humans exchange enriched context across sessions, tools, and vendors. Wire format, interaction model, and conformance levels. Reference implementation: Relay.">
  <meta name="keywords" content="Agentic Protocol, AI memory protocol, context flow protocol, agent interoperability, MCP, Relay, Tensorpunk Labs, open spec, agent protocol RFC">
  <link rel="canonical" href="https://relaymemory.com/protocol/">

  <meta property="og:title" content="The Agentic Protocol — v0.1">
  <meta property="og:description" content="Open specification for how AI agents and humans exchange enriched context across sessions, tools, and vendors. Reference implementation: Relay.">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://relaymemory.com/protocol/">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="The Agentic Protocol — v0.1">
  <meta name="twitter:description" content="Open specification for AI agent context exchange. Wire format, interaction model, conformance levels.">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "headline": "The Agentic Protocol — v0.1",
    "description": "Open specification defining how AI agents and humans exchange enriched context across sessions, tools, and vendors. Wire format, interaction model, conformance levels.",
    "url": "https://relaymemory.com/protocol/",
    "author": { "@type": "Organization", "name": "Tensorpunk Labs", "url": "https://tensorpunklabs.com" },
    "publisher": { "@type": "Organization", "name": "Tensorpunk Labs", "url": "https://tensorpunklabs.com" },
    "about": { "@type": "SoftwareApplication", "name": "Relay", "applicationCategory": "DeveloperApplication" }
  }
  </script>

  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%2300ddff'/><text x='50%25' y='56%25' text-anchor='middle' dominant-baseline='middle' font-family='JetBrains Mono,monospace' font-weight='700' font-size='20' fill='%23000'>R</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Jost:wght@500;600;700;800;900&display=swap" rel="stylesheet">

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-primary: #0a0c10;
      --bg-secondary: #131418;
      --bg-card: #181a1f;
      --border: #1e2028;
      --text-primary: #ededed;
      --text-secondary: #8a8d98;
      --text-tertiary: #555860;
      --cyan: #00ddff;
      --cyan-dim: #0099bb;
      --lime: #d4f500;
      --neu-raised:
        10px 10px 24px 0 rgba(2, 3, 5, 0.92),
        -6px -6px 18px 0 rgba(30, 32, 40, 0.28);
      --neu-inset:
        inset 4px 4px 10px 0 rgba(2, 3, 5, 0.8),
        inset -3px -3px 8px 0 rgba(30, 32, 40, 0.3);
    }

    html, body {
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: 'Inter', -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    #bg-canvas { position: fixed; inset: 0; z-index: 0; display: block; }
    .ambient {
      position: fixed; inset: 0; z-index: 1; pointer-events: none;
      background:
        radial-gradient(ellipse 60% 50% at 25% 20%, rgba(0,221,255,0.08), transparent 60%),
        radial-gradient(ellipse 50% 40% at 78% 82%, rgba(212,245,0,0.05), transparent 60%),
        radial-gradient(ellipse 120% 100% at 50% 50%, transparent 40%, rgba(10,12,16,0.55) 100%);
      mix-blend-mode: screen;
    }
    .grain {
      position: fixed; inset: -50%; z-index: 2; pointer-events: none; opacity: 0.06;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    }

    .topbar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 20;
      padding: 20px 28px;
      display: flex; align-items: center; justify-content: space-between;
      pointer-events: none;
      background: linear-gradient(180deg, rgba(10,12,16,0.85) 0%, transparent 100%);
    }
    .mark { display: inline-flex; align-items: center; gap: 10px; pointer-events: auto; text-decoration: none; }
    .mark-icon { font-family: 'Futura', 'Jost', sans-serif; font-weight: 700; font-size: 22px; color: var(--text-primary); }
    .mark-text { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; color: var(--text-secondary); letter-spacing: 2px; text-transform: uppercase; }
    .mark-text b { color: var(--text-primary); font-weight: 700; }

    .topnav { display: flex; align-items: center; gap: 4px; pointer-events: auto; }
    .topnav a {
      font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
      color: var(--text-tertiary); letter-spacing: 1.5px; text-transform: uppercase;
      text-decoration: none; padding: 7px 12px; border-radius: 8px;
      transition: color 0.15s, background 0.15s;
    }
    .topnav a:hover { color: var(--cyan); background: rgba(0,221,255,0.06); }
    .topnav a.active { color: var(--cyan); background: rgba(0,221,255,0.08); border: 1px solid rgba(0,221,255,0.18); }

    /* Layout: sidebar TOC + content */
    .layout {
      position: relative; z-index: 10;
      max-width: 1280px; margin: 0 auto;
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      gap: 36px;
      padding: 110px 24px 80px;
    }
    aside.toc-side {
      position: sticky; top: 110px; align-self: start;
      max-height: calc(100vh - 130px);
      overflow-y: auto;
      padding: 22px 18px;
      background: rgba(19,20,24,0.6);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(255,255,255,0.04);
      border-radius: 14px;
      box-shadow: var(--neu-raised);
    }
    aside.toc-side .toc-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; font-weight: 700; color: var(--text-tertiary);
      letter-spacing: 2.5px; text-transform: uppercase;
      margin-bottom: 12px; padding: 0 6px;
    }
    aside.toc-side ol {
      list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 2px;
      counter-reset: toc;
    }
    aside.toc-side li { margin: 0; }
    aside.toc-side li a {
      display: block;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px; font-weight: 500;
      color: var(--text-secondary); text-decoration: none;
      padding: 6px 10px; border-radius: 6px;
      line-height: 1.4;
      transition: color 0.12s, background 0.12s;
    }
    aside.toc-side li a:hover { color: var(--cyan); background: rgba(0,221,255,0.06); }

    /* Mobile TOC (collapsible details block at top) */
    details.toc-mobile {
      display: none;
      margin: 0 0 28px;
      background: rgba(19,20,24,0.65);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 14px 18px;
    }
    details.toc-mobile summary {
      cursor: pointer; user-select: none;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; font-weight: 700;
      color: var(--cyan); letter-spacing: 2px; text-transform: uppercase;
    }
    details.toc-mobile ol {
      list-style: none; padding: 12px 0 0; margin: 0;
      display: flex; flex-direction: column; gap: 4px;
    }
    details.toc-mobile li a {
      display: block; padding: 6px 8px; border-radius: 6px;
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
      color: var(--text-secondary); text-decoration: none;
    }
    details.toc-mobile li a:hover { color: var(--cyan); background: rgba(0,221,255,0.06); }

    /* Content card */
    main.spec {
      background: rgba(13,15,20,0.55);
      backdrop-filter: blur(18px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.04);
      border-radius: 18px;
      padding: 48px clamp(24px, 4vw, 56px);
      box-shadow: var(--neu-raised);
      position: relative;
      min-width: 0;
    }
    main.spec::after {
      content: ""; position: absolute; inset: 0;
      border-radius: 18px; padding: 1px; pointer-events: none;
      background: linear-gradient(140deg, rgba(0,221,255,0.18), transparent 50%, rgba(212,245,0,0.08));
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: xor; mask-composite: exclude;
      opacity: 0.6;
    }

    /* Header / hero block */
    .spec-header {
      margin-bottom: 36px;
      padding-bottom: 28px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .spec-eyebrow {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; font-weight: 700;
      color: var(--cyan); letter-spacing: 4px;
      text-transform: uppercase; margin-bottom: 14px;
    }
    .spec-title {
      font-family: 'Jost', 'Futura', sans-serif;
      font-size: clamp(34px, 5.2vw, 54px);
      font-weight: 800; letter-spacing: 0.01em;
      line-height: 1.05;
      background: linear-gradient(180deg, #ffffff 0%, #63676f 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 12px;
    }
    .spec-meta {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px; color: var(--text-secondary);
      letter-spacing: 0.5px;
    }
    .spec-meta span { color: var(--lime); }

    /* Typography */
    main.spec h1, main.spec h2, main.spec h3, main.spec h4 {
      font-family: 'Inter', sans-serif;
      color: var(--text-primary);
      letter-spacing: -0.4px;
      line-height: 1.25;
      scroll-margin-top: 96px;
    }
    main.spec h1 { display: none; } /* The "# The Agentic Protocol" is replaced by .spec-header */
    main.spec h2 {
      font-size: 26px; font-weight: 800;
      margin: 48px 0 16px;
      padding-top: 12px;
      border-top: 1px solid rgba(0,221,255,0.1);
    }
    main.spec h2:first-of-type { margin-top: 0; padding-top: 0; border-top: none; }
    main.spec h3 {
      font-size: 19px; font-weight: 700;
      color: var(--cyan);
      margin: 32px 0 12px;
    }
    main.spec h4 {
      font-size: 15px; font-weight: 700;
      color: var(--text-primary);
      margin: 22px 0 8px;
      text-transform: uppercase; letter-spacing: 1px;
    }
    main.spec a.anchor {
      color: var(--text-tertiary);
      text-decoration: none;
      font-weight: 400;
      margin-right: 8px;
      opacity: 0;
      transition: opacity 0.15s, color 0.15s;
    }
    main.spec h2:hover a.anchor,
    main.spec h3:hover a.anchor,
    main.spec h4:hover a.anchor { opacity: 1; }
    main.spec a.anchor:hover { color: var(--cyan); }

    main.spec p {
      font-size: 14.5px; line-height: 1.75;
      color: var(--text-secondary);
      margin: 0 0 16px;
    }
    main.spec p strong { color: var(--text-primary); font-weight: 700; }
    main.spec p em { color: var(--text-primary); font-style: italic; }

    main.spec ul, main.spec ol {
      margin: 0 0 18px 0;
      padding-left: 24px;
      color: var(--text-secondary);
      font-size: 14.5px; line-height: 1.7;
    }
    main.spec li { margin-bottom: 6px; }
    main.spec li strong { color: var(--text-primary); }

    main.spec a:not(.anchor) {
      color: var(--cyan);
      text-decoration: none;
      border-bottom: 1px solid rgba(0,221,255,0.25);
      transition: border-color 0.15s;
    }
    main.spec a:not(.anchor):hover { border-color: var(--cyan); }

    /* Inline code */
    main.spec code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
      background: rgba(0,221,255,0.07);
      color: var(--cyan);
      padding: 2px 6px;
      border-radius: 4px;
      word-break: break-word;
    }

    /* Code blocks */
    main.spec pre.code-pre {
      background: rgba(8, 10, 14, 0.85);
      border: 1px solid rgba(0,221,255,0.12);
      border-radius: 10px;
      padding: 16px 20px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
      line-height: 1.65;
      color: #c5d8e0;
      overflow-x: auto;
      margin: 12px 0 20px;
      box-shadow: inset 0 1px 8px rgba(0,0,0,0.4);
    }
    main.spec pre.code-pre code {
      background: transparent;
      padding: 0;
      color: inherit;
      font-size: inherit;
      border-radius: 0;
    }

    /* Tables */
    main.spec .table-wrap {
      overflow-x: auto;
      margin: 12px 0 24px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.05);
      background: rgba(10,12,16,0.45);
    }
    main.spec table.spec-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      min-width: 480px;
    }
    main.spec table.spec-table th {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9.5px; font-weight: 700;
      color: var(--text-tertiary); letter-spacing: 1.8px;
      text-transform: uppercase;
      text-align: left;
      padding: 12px 14px;
      background: rgba(0,221,255,0.04);
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    main.spec table.spec-table td {
      padding: 11px 14px;
      vertical-align: top;
      color: var(--text-secondary);
      line-height: 1.55;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    main.spec table.spec-table tr:last-child td { border-bottom: none; }
    main.spec table.spec-table td code,
    main.spec table.spec-table th code {
      font-size: 11.5px;
      white-space: nowrap;
    }

    /* HR -> separator */
    main.spec .spec-hr {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(0,221,255,0.18) 50%, transparent);
      margin: 36px 0;
    }

    /* Footer */
    footer {
      position: relative; z-index: 10;
      max-width: 1280px; margin: 0 auto;
      padding: 32px 24px;
      display: flex; justify-content: space-between;
      align-items: center; flex-wrap: wrap; gap: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: var(--text-tertiary);
      letter-spacing: 1.5px; text-transform: uppercase;
      border-top: 1px solid rgba(255,255,255,0.03);
    }
    footer a { color: var(--text-secondary); text-decoration: none; }
    footer a:hover { color: var(--cyan); }

    @media (max-width: 980px) {
      .layout { grid-template-columns: 1fr; gap: 0; padding-top: 100px; }
      aside.toc-side { display: none; }
      details.toc-mobile { display: block; }
      main.spec { padding: 32px 22px; }
    }
    @media (max-width: 640px) {
      .topbar { padding: 14px 16px; }
      .topnav a { padding: 5px 8px; font-size: 10px; letter-spacing: 1px; }
      .layout { padding: 90px 14px 40px; }
      main.spec { padding: 24px 18px; border-radius: 14px; }
      main.spec h2 { font-size: 22px; margin-top: 36px; }
      main.spec h3 { font-size: 17px; }
      main.spec p, main.spec li { font-size: 14px; }
    }
  </style>
</head>
<body>

  <canvas id="bg-canvas"></canvas>
  <div class="ambient"></div>
  <div class="grain"></div>

  <div class="topbar">
    <a href="https://tensorpunklabs.com" target="_blank" class="mark">
      <div class="mark-icon">&Oslash;</div>
      <div class="mark-text"><b>Tensorpunk</b> &nbsp;Labs &nbsp;<span style="color:var(--cyan);">// RELAY</span></div>
    </a>
    <nav class="topnav">
      <a href="/">Home</a>
      <a href="/setup/">Setup</a>
      <a href="/cli/">CLI</a>
      <a href="/protocol/" class="active">Protocol</a>
      <a href="/dashboard/">Dashboard</a>
    </nav>
  </div>

  <div class="layout">
    <aside class="toc-side" aria-label="Table of contents">
      <div class="toc-label">Contents</div>
      <ol>
${tocItems.replace(/^/gm, '        ')}
      </ol>
    </aside>

    <main class="spec">
      <div class="spec-header">
        <div class="spec-eyebrow">&sect; specification</div>
        <h1 class="spec-title">The Agentic Protocol</h1>
        <div class="spec-meta">
          Version <span>0.1</span> &middot; Status <span>Active Draft &mdash; Reference Implementation Shipping</span>
        </div>
      </div>

      <details class="toc-mobile">
        <summary>&sect; Contents</summary>
        <ol>
${tocItems.replace(/^/gm, '          ')}
        </ol>
      </details>

`;

const FOOT = `
    </main>
  </div>

  <footer>
    <a href="https://tensorpunklabs.com" target="_blank">Tensorpunk Labs</a>
    <span>BSL 1.1 &middot; Open Source</span>
    <a href="mailto:contact@tensorpunk.com">contact@tensorpunk.com</a>
  </footer>

  <script type="importmap">
  { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js" } }
  </script>
  <script type="module">
    import * as THREE from 'three';
    const canvas = document.getElementById('bg-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x0a0c10, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 100);
    camera.position.z = 4;

    const NODE_COUNT = 120;
    const EDGE_COUNT = 180;
    const positions = new Float32Array(NODE_COUNT * 3);
    const phases = new Float32Array(NODE_COUNT);
    const CLUSTERS = [
      { x: -1.5, y: 0.5, z: -0.5, r: 1.2 },
      { x: 1.2, y: -0.3, z: 0.3, r: 1.0 },
      { x: 0.0, y: 0.8, z: -0.8, r: 0.9 },
      { x: -0.3, y: -0.8, z: 0.6, r: 0.8 },
    ];
    const velocities = new Float32Array(NODE_COUNT * 3);
    for (let i = 0; i < NODE_COUNT; i++) {
      const c = CLUSTERS[i % CLUSTERS.length];
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = c.r * (0.3 + Math.random() * 0.7);
      positions[i*3+0] = c.x + r * Math.sin(phi) * Math.cos(theta);
      positions[i*3+1] = c.y + r * Math.sin(phi) * Math.sin(theta);
      positions[i*3+2] = c.z + r * Math.cos(phi);
      velocities[i*3+0] = (Math.random()-0.5) * 0.003;
      velocities[i*3+1] = (Math.random()-0.5) * 0.003;
      velocities[i*3+2] = (Math.random()-0.5) * 0.002;
      phases[i] = Math.random() * Math.PI * 2;
    }

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    nodeGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    const nodeMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: \`attribute float aPhase; uniform float uTime; varying float vAlpha; varying float vLime;
        void main() { vec3 p = position; p.x += sin(uTime*0.2+aPhase)*0.06; p.y += cos(uTime*0.18+aPhase*1.3)*0.05;
        vec4 mv = modelViewMatrix * vec4(p,1.0); float b = 0.8+0.2*sin(uTime*0.5+aPhase);
        gl_PointSize = (20.0/-mv.z)*b; gl_Position = projectionMatrix*mv;
        vAlpha = 0.35+0.25*sin(uTime*0.35+aPhase*0.7); vLime = step(0.88, fract(aPhase*7.13)); }\`,
      fragmentShader: \`varying float vAlpha; varying float vLime;
        void main() { float d = length(gl_PointCoord-0.5); if (d>0.5) discard;
        float g = pow(1.0-d*2.0, 2.8); vec3 col = mix(vec3(0.0,0.87,1.0), vec3(0.83,0.96,0.0), vLime);
        gl_FragColor = vec4(col, g*vAlpha); }\`,
    });
    scene.add(new THREE.Points(nodeGeo, nodeMat));

    const edgePairs = [];
    for (let i = 0; i < EDGE_COUNT; i++) {
      const a = Math.floor(Math.random()*NODE_COUNT);
      let b = Math.floor(Math.random()*NODE_COUNT);
      if (b===a) b = (a+1)%NODE_COUNT;
      edgePairs.push(a, b);
    }
    const edgePositions = new Float32Array(EDGE_COUNT * 6);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.04, blending: THREE.AdditiveBlending, depthWrite: false });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    scene.add(edges);

    const PULSE_COUNT = 80;
    const pulsePositions = new Float32Array(PULSE_COUNT * 3);
    const pulseData = [];
    for (let i = 0; i < PULSE_COUNT; i++) {
      pulseData.push({ edge: Math.floor(Math.random()*EDGE_COUNT), t: Math.random(), speed: 0.002+Math.random()*0.005 });
    }
    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3));
    const pulseMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: \`void main() { vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize=5.0/-mv.z; gl_Position=projectionMatrix*mv; }\`,
      fragmentShader: \`void main() { float d=length(gl_PointCoord-0.5); if (d>0.5) discard;
        float g=pow(1.0-d*2.0,3.5); gl_FragColor=vec4(0.0,0.87,1.0,g*0.8); }\`,
    });
    scene.add(new THREE.Points(pulseGeo, pulseMat));

    const clock = new THREE.Clock();
    let glitch = 0;
    function animate() {
      requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const dt = clock.getDelta();
      nodeMat.uniforms.uTime.value = t;
      const pos = nodeGeo.attributes.position.array;
      for (let i = 0; i < NODE_COUNT; i++) {
        const c = CLUSTERS[i % CLUSTERS.length];
        for (let j = 0; j < 3; j++) {
          const idx = i*3+j;
          pos[idx] += velocities[idx] * Math.sin(t*0.3+phases[i]);
          const center = [c.x, c.y, c.z][j];
          if (Math.abs(pos[idx]-center) > c.r*1.2) velocities[idx] *= -0.8;
        }
      }
      nodeGeo.attributes.position.needsUpdate = true;
      const ePos = edgeGeo.attributes.position.array;
      for (let i = 0; i < EDGE_COUNT; i++) {
        const a = edgePairs[i*2], b = edgePairs[i*2+1];
        for (let j = 0; j < 3; j++) {
          ePos[i*6+j] = pos[a*3+j];
          ePos[i*6+3+j] = pos[b*3+j];
        }
      }
      edgeGeo.attributes.position.needsUpdate = true;
      glitch += dt;
      if (glitch > 3+Math.random()*4) {
        edgeMat.opacity = 0.15+Math.random()*0.1;
        setTimeout(() => { edgeMat.opacity = 0.04; }, 80+Math.random()*120);
        glitch = 0;
      }
      const pPos = pulseGeo.attributes.position.array;
      for (let i = 0; i < PULSE_COUNT; i++) {
        const pd = pulseData[i];
        pd.t += pd.speed;
        if (pd.t > 1) { pd.t = 0; pd.edge = Math.floor(Math.random()*EDGE_COUNT); }
        const a = edgePairs[pd.edge*2], b = edgePairs[pd.edge*2+1];
        for (let j = 0; j < 3; j++) {
          pPos[i*3+j] = pos[a*3+j] + (pos[b*3+j]-pos[a*3+j]) * pd.t;
        }
      }
      pulseGeo.attributes.position.needsUpdate = true;
      camera.position.x = Math.sin(t*0.04) * 0.6;
      camera.position.y = Math.cos(t*0.025) * 0.4;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }
    animate();
    function resize() {
      camera.aspect = innerWidth/innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight, false);
    }
    addEventListener('resize', resize);
    resize();
  </script>
</body>
</html>
`;

writeFileSync(OUT_PATH, HEAD + body + FOOT, 'utf8');
console.log(`Wrote ${OUT_PATH} (${(HEAD + body + FOOT).length} bytes, ${toc.filter(t => t.depth === 2).length} TOC entries)`);
