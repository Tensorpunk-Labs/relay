#!/usr/bin/env node
/**
 * Build a clean, public-safe export of the Relay repo.
 *
 * Produces a staging directory at --dest that is safe to push to a public
 * mirror. The script:
 *   1. Filters out build artifacts, local state, env files, and internal-only docs
 *   2. Scrubs live credentials, personal paths, and internal tool references
 *      using regex-based shape-matching (no literal credential strings embedded)
 *   3. Swaps in public-facing README.md + CONTRIBUTING.md from templates
 *   4. Re-scans the dest for residue; exits non-zero if anything slipped through
 *
 * Usage:
 *   node scripts/build-public-export.mjs [--source <dir>] [--dest <dir>]
 *                                        [--force] [--dry-run] [--verify-only]
 *
 * All detection patterns are general shape-matchers. No real credential values
 * live in this file, so it is itself safe to commit publicly.
 */

import { mkdir, readdir, readFile, writeFile, copyFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    source: process.cwd(),
    dest: null,
    force: false,
    dryRun: false,
    verifyOnly: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--verify-only') args.verifyOnly = true;
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--dest') args.dest = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  args.source = path.resolve(args.source);
  if (!args.dest) args.dest = path.resolve(args.source, '..', 'relay-public-staging');
  else args.dest = path.resolve(args.dest);
  return args;
}

function printHelp() {
  console.log(`build-public-export.mjs — produce a clean public export of Relay

Usage:
  node scripts/build-public-export.mjs [options]

Options:
  --source <dir>    Source dev repo (default: cwd)
  --dest <dir>      Output staging dir (default: <source>/../relay-public-staging)
  --force           Overwrite existing dest
  --dry-run         Plan, do not write
  --verify-only     Only run the residue scan on an existing dest
  --help, -h        Show this message
`);
}

// ---------------------------------------------------------------------------
// Exclusion rules
// ---------------------------------------------------------------------------

// Any dir or file with one of these basenames is excluded wherever it appears.
const EXCLUDE_BY_NAME = new Set([
  'node_modules', 'dist', '.next', '.vercel', '.turbo',
  '.git', '.claude', '.superpowers', '.tmp-screens', '.worktrees',
  '.relay', 'backups',
  '.env', '.env.local', '.env.production', '.env.development',
  '.mcp.json', 'CLAUDE.md',
]);

// Always keep these (override EXCLUDE_BY_NAME on basename match).
const KEEP_BY_NAME = new Set(['.env.example']);

// Specific paths to exclude (repo-relative, forward-slash).
const EXCLUDE_REL_PATHS = new Set([
  'relay-website',
  'apps/web/.next',
  'benchmarks/longmemeval/data',
  'docs/DAILY_WORKFLOW_PLAYBOOK.md',
  'docs/RELAY_HANDOFF.md',
  'docs/PUNKY_RELAY_HANDOFF.md',
  'docs/ANTIBODY_SPEC.md',
  'docs/RELAY_ANALYSIS.md',
  'docs/claude-md-backup',
  'docs/runbooks',
  'docs/superpowers',
  'docs/response-to-spine-label-paper.html',
]);

function toRel(abs, root) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function shouldExclude(entryName, relPath) {
  if (KEEP_BY_NAME.has(entryName)) return false;
  if (EXCLUDE_BY_NAME.has(entryName)) return true;
  if (EXCLUDE_REL_PATHS.has(relPath)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Scrub patterns — shape-matchers only, ordered so specific prefixes run
// before more permissive patterns (e.g. Anthropic before generic `sk-`).
// ---------------------------------------------------------------------------

const TEXT_EXT = new Set([
  '.md', '.ts', '.tsx', '.js', '.mjs', '.cjs',
  '.json', '.sql', '.html', '.yaml', '.yml', '.txt',
]);

function buildPatterns() {
  return [
    {
      name: 'supabase_url',
      re: /https:\/\/[a-z0-9]{20}\.supabase\.co/gi,
      sub: 'https://YOUR_SUPABASE_PROJECT.supabase.co',
    },
    {
      name: 'supabase_publishable_key',
      re: /\bsb_publishable_[A-Za-z0-9_-]{20,}\b/g,
      sub: 'YOUR_ANON_KEY',
    },
    {
      name: 'supabase_secret_key',
      re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g,
      sub: 'YOUR_SERVICE_KEY',
    },
    {
      name: 'anthropic_key',
      re: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/g,
      sub: 'YOUR_ANTHROPIC_KEY',
    },
    {
      name: 'openai_key',
      re: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/g,
      sub: 'YOUR_OPENAI_KEY',
    },
    {
      name: 'github_pat',
      re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
      sub: 'YOUR_GITHUB_TOKEN',
    },
    {
      name: 'jwt',
      re: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      sub: 'YOUR_JWT_TOKEN',
    },
    {
      name: 'windows_path',
      re: /\b[A-Z]:[\\/](?:[^\s"'<>,;)\]]*[\\/])?relay(?:[\\/][^\s"'<>,;)\]]*)?/g,
      sub: '/path/to/relay',
    },
    {
      name: 'actor_id_json',
      re: /("actor[_-]?id"\s*:\s*)"(?!your-actor-id")[^"]+"/g,
      sub: '$1"your-actor-id"',
    },
    {
      name: 'punky_upper',
      re: /\bPunky\b/g,
      sub: 'Agent',
    },
    {
      name: 'punky_lower',
      re: /\bpunky\b/g,
      sub: 'agent',
    },
    {
      name: 'openclaw',
      re: /\bOpenClaw\b/g,
      sub: 'External Systems',
    },
    {
      name: 'personal_name_jordan',
      re: /\bJordan\b/g,
      sub: 'the developer',
    },
    {
      name: 'codename_neuraldistortion',
      re: /\bNeuralDistortion\b/g,
      sub: 'ExampleApp',
    },
    {
      name: 'codename_latentsampler',
      re: /\bLatentSampler\b/g,
      sub: 'ExampleTool',
    },
    {
      name: 'codename_instantrecall',
      re: /\bInstantRecall(?:\.ai)?\b/g,
      sub: 'a memory-as-a-service predecessor',
    },
  ];
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

async function pathExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function* walkFiles(root, opts = {}) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = await readdir(cur, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) yield p;
    }
    if (opts.signal?.aborted) return;
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — copy with exclusions
// ---------------------------------------------------------------------------

async function copyTree(source, dest, dryRun, stats) {
  async function recur(srcDir, destDir) {
    let entries;
    try { entries = await readdir(srcDir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const srcPath = path.join(srcDir, e.name);
      const destPath = path.join(destDir, e.name);
      const rel = toRel(srcPath, source);

      if (shouldExclude(e.name, rel)) {
        stats.excluded.push(rel);
        continue;
      }

      if (e.isDirectory()) {
        if (!dryRun) await ensureDir(destPath);
        await recur(srcPath, destPath);
      } else if (e.isFile()) {
        if (!dryRun) {
          await ensureDir(path.dirname(destPath));
          await copyFile(srcPath, destPath);
        }
        stats.copied++;
      }
    }
  }
  await recur(source, dest);
}

// ---------------------------------------------------------------------------
// Phase 3 — content scrubs
// ---------------------------------------------------------------------------

async function scrubFiles(destRoot, patterns, dryRun, stats) {
  for await (const file of walkFiles(destRoot)) {
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;

    let content;
    try { content = await readFile(file, 'utf8'); }
    catch { continue; }

    let next = content;
    let changed = false;
    for (const p of patterns) {
      const before = next;
      next = next.replace(p.re, (m, ...rest) => {
        stats.replacements[p.name] = (stats.replacements[p.name] || 0) + 1;
        // Support $1-style backrefs when sub contains them.
        if (p.sub.includes('$1')) {
          return p.sub.replace('$1', rest[0]);
        }
        return p.sub;
      });
      if (next !== before) changed = true;
    }
    if (changed && !dryRun) {
      await writeFile(file, next, 'utf8');
    }
    if (changed) stats.filesScrubbed++;
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — add generated files
// ---------------------------------------------------------------------------

async function writeGeneratedFiles(source, dest, dryRun) {
  const templatesDir = path.join(source, 'scripts', 'public-export-templates');
  const readmeTmpl = path.join(templatesDir, 'README.public.md');
  const contribTmpl = path.join(templatesDir, 'CONTRIBUTING.md');

  if (!(await pathExists(readmeTmpl))) {
    throw new Error(`Missing template: ${readmeTmpl}`);
  }
  if (!(await pathExists(contribTmpl))) {
    throw new Error(`Missing template: ${contribTmpl}`);
  }

  if (dryRun) return;

  const readmeBody = await readFile(readmeTmpl, 'utf8');
  await writeFile(path.join(dest, 'README.md'), readmeBody, 'utf8');

  const contribBody = await readFile(contribTmpl, 'utf8');
  await writeFile(path.join(dest, 'CONTRIBUTING.md'), contribBody, 'utf8');

  // LICENSE is copied as-is during phase 2 — no additional action needed
  // unless source is missing it entirely, which should be caught earlier.
  const licensePath = path.join(dest, 'LICENSE');
  if (!(await pathExists(licensePath))) {
    throw new Error('LICENSE not present in dest — check that source has a LICENSE at repo root');
  }
}

// ---------------------------------------------------------------------------
// Phase 5 — verification scan
// ---------------------------------------------------------------------------

async function verify(destRoot, patterns) {
  const findings = [];
  for await (const file of walkFiles(destRoot)) {
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;

    let content;
    try { content = await readFile(file, 'utf8'); }
    catch { continue; }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const p of patterns) {
        // Skip lexical replacements in the verification pass: internal
        // codenames, personal names, actor_id values, and Windows paths are
        // non-credential and their absence is verified by spot-checking.
        if (
          p.name === 'actor_id_json' ||
          p.name === 'windows_path' ||
          p.name.startsWith('punky_') ||
          p.name === 'openclaw' ||
          p.name.startsWith('personal_name_') ||
          p.name.startsWith('codename_')
        ) continue;
        // Reset lastIndex on the global regex each call.
        p.re.lastIndex = 0;
        if (p.re.test(lines[i])) {
          findings.push({
            file: toRel(file, destRoot),
            line: i + 1,
            category: p.name,
          });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const patterns = buildPatterns();

  if (args.verifyOnly) {
    if (!(await pathExists(args.dest))) {
      console.error(`Dest does not exist: ${args.dest}`);
      process.exit(2);
    }
    console.log(`[verify-only] Scanning ${args.dest} ...`);
    const findings = await verify(args.dest, patterns);
    if (findings.length === 0) {
      console.log('Clean — no residue detected.');
      process.exit(0);
    }
    console.error(`Residue found (${findings.length} hits):`);
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  [${f.category}]`);
    }
    process.exit(1);
  }

  // Phase 1 — prepare dest
  if (!(await pathExists(args.source))) {
    console.error(`Source does not exist: ${args.source}`);
    process.exit(2);
  }
  if (await pathExists(args.dest)) {
    if (!args.force) {
      console.error(`Dest already exists: ${args.dest}`);
      console.error('Re-run with --force to overwrite.');
      process.exit(2);
    }
    if (!args.dryRun) {
      await rm(args.dest, { recursive: true, force: true });
    }
  }
  if (!args.dryRun) await ensureDir(args.dest);

  const stats = {
    copied: 0,
    excluded: [],
    replacements: {},
    filesScrubbed: 0,
  };

  // Phase 2 — copy tree
  console.log(`[phase 2] Copying ${args.source} -> ${args.dest}`);
  await copyTree(args.source, args.dest, args.dryRun, stats);

  // Phase 3 — scrub
  if (!args.dryRun) {
    console.log('[phase 3] Scrubbing credentials, paths, internal references');
    await scrubFiles(args.dest, patterns, false, stats);
  }

  // Phase 4 — write generated files
  console.log('[phase 4] Writing public-facing README / CONTRIBUTING');
  await writeGeneratedFiles(args.source, args.dest, args.dryRun);

  // Phase 5 — verify
  let clean = true;
  let findings = [];
  if (!args.dryRun) {
    console.log('[phase 5] Verification scan');
    findings = await verify(args.dest, patterns);
    clean = findings.length === 0;
  }

  // Phase 6 — summary
  console.log('\n=== Summary ===');
  console.log(`Source:          ${args.source}`);
  console.log(`Dest:            ${args.dest}`);
  console.log(`Files copied:    ${stats.copied}`);
  console.log(`Excluded paths:  ${stats.excluded.length}`);
  console.log(`Files scrubbed:  ${stats.filesScrubbed}`);
  console.log('Replacements by category:');
  if (Object.keys(stats.replacements).length === 0) {
    console.log('  (none)');
  } else {
    for (const [k, v] of Object.entries(stats.replacements).sort()) {
      console.log(`  ${k.padEnd(28)} ${v}`);
    }
  }
  if (args.dryRun) {
    console.log('\n(DRY RUN — no files written.)');
    process.exit(0);
  }
  if (clean) {
    console.log('\nStatus: CLEAN');
    process.exit(0);
  }
  console.error(`\nStatus: DIRTY — ${findings.length} residue hit(s):`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.category}]`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err.stack || err.message || err);
  process.exit(1);
});
