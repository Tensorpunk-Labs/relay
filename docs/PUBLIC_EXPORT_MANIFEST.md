# Public Export Manifest

Human-readable companion to `scripts/build-public-export.mjs`. Documents what lands in the public GitHub mirror, what is deliberately withheld, and what gets scrubbed on the way through.

## Purpose

The dev tree (`gitlab.com/tensorpunk-labs/projects/relay`) carries things the public repo must not:

- Agent instruction files (`CLAUDE.md`, `.claude/` settings, `.mcp.json`)
- Internal handoff docs, runbooks, and personal workflow playbooks
- Live Supabase / Anthropic / OpenAI / GitHub credentials embedded in configs and examples
- Windows-rooted absolute paths that leak directory layout
- References to internal codenames and tooling that aren't meaningful to outside readers
- An `actor_id` field that identifies a specific operator

The export script is the single source of truth for how to turn the dev tree into a public repo. This document mirrors it in prose so a human can audit the behavior without reading the code.

## Included categories

Everything in the dev tree, _except_ what's listed under "Excluded" below, is copied as-is into the staging directory. In particular, the following are shipped:

- `packages/core`, `packages/cli`, `packages/mcp`, `packages/api`, `packages/orchestrator`, `packages/storage-sqlite` — all source and tests
- `apps/web` — Next.js dashboard source (minus `.next/` cache)
- `supabase/migrations/` — all schema migrations
- `docs/` — architecture, specs, roadmap, protocol (minus internal docs listed below)
- `benchmarks/` — harness source (minus large generated data)
- `scripts/` — all scripts, including `build-public-export.mjs` itself and the `public-export-templates/` directory
- `LICENSE` (BSL 1.1) — copied as-is
- `.env.example` — kept even though other `.env*` variants are excluded
- `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `README.md` (then overwritten by the public README — see phase 4)

## Excluded items

### Build artifacts and caches (regen-able, bloaty)
- `node_modules/` — installed by consumers
- `dist/` — built from source
- `.next/`, `.vercel/`, `.turbo/` — framework caches
- `apps/web/.next/` — explicit Next.js build cache
- `benchmarks/longmemeval/data/` — large benchmark dataset, pulled on demand

### Git / IDE / agent state (per-machine, not portable)
- `.git/` — the staging dir gets its own history
- `.claude/`, `.superpowers/`, `.tmp-screens/`, `.worktrees/` — agent session + tooling state

### Relay local state (per-operator)
- `.relay/` — local CLI state (session cursor, etc.)
- `backups/` — local Supabase backups

### Environment files (live credentials)
- `.env`, `.env.local`, `.env.production`, `.env.development` — excluded
- `.env.example` — **kept** (intentionally generic, documents required vars)

### Local config (operator-specific)
- `.mcp.json` — MCP server registry, contains absolute paths and env bindings
- `CLAUDE.md` — agent instructions, not relevant to public consumers

### Internal docs (workflow / handoffs, not public-facing)
- `docs/DAILY_WORKFLOW_PLAYBOOK.md` — operator daily ritual
- `docs/RELAY_HANDOFF.md` — internal session handoff template
- `docs/PUNKY_RELAY_HANDOFF.md` — internal tool bridge notes
- `docs/claude-md-backup/` — snapshots of agent instruction files
- `docs/runbooks/` — operational runbooks for the operator's environment
- `docs/superpowers/` — references to a private agent toolkit
- `docs/response-to-spine-label-paper.html` — unrelated external-collaboration artifact

### Orphans
- `relay-website/` — legacy directory with no inbound references; public website is separate

## Scrubbed categories

Text files (extensions: `.md .ts .tsx .js .mjs .cjs .json .sql .html .yaml .yml .txt`) pass through a regex-based scrubber. Detection uses **generic shape-matching**; the script does not embed real credential values. Replacement counts per category are printed in the summary.

| Category | Shape | Replaced with |
|---|---|---|
| Supabase project URL | `https://<20-char-slug>.supabase.co` | `https://YOUR_SUPABASE_PROJECT.supabase.co` |
| Supabase publishable / anon key | `sb_publishable_<long-token>` | `YOUR_ANON_KEY` |
| Supabase service-role key | `sb_secret_<long-token>` | `YOUR_SERVICE_KEY` |
| Anthropic API key | `sk-ant-<long-token>` | `YOUR_ANTHROPIC_KEY` |
| OpenAI API key | `sk-[proj-/svcacct-]<long-token>` (excludes `sk-ant-`) | `YOUR_OPENAI_KEY` |
| GitHub personal access token | `gh[pousr]_<36+ alnum>` | `YOUR_GITHUB_TOKEN` |
| JWT-shaped token (three base64url segments, `eyJ`-prefixed) | `eyJ...`.`eyJ...`.`...` | `YOUR_JWT_TOKEN` |
| Windows absolute path containing `relay` | `<DriveLetter>:\...\relay[\...]` | `/path/to/relay` |
| `actor_id` field value (not already genericized) | `"actor_id": "your-actor-id"` | `"actor_id": "your-actor-id"` |
| Internal tool codenames | internal tool names (see `buildPatterns()`) | neutral terms (`Agent`, `External Systems`) |
| Personal names | operator's given name | `the developer` |

Order matters: specific prefixes (Anthropic, Supabase `sb_*`) are applied before more permissive patterns (generic `sk-`, JWT) so the narrower match wins.

## How to run

From the dev repo root:

```bash
node scripts/build-public-export.mjs --source . --dest ../relay-public-staging
```

Useful flags:

| Flag | Effect |
|---|---|
| `--force` | Overwrite an existing dest dir |
| `--dry-run` | Walk + report without writing; does not perform phase 5 verify |
| `--verify-only` | Skip everything else; re-scan an existing dest and exit accordingly |

## Verification behavior

After scrubbing (phase 5), the script re-scans every text file in the dest for any credential-shape residue. For each hit it prints:

```
packages/api/src/foo.ts:123  [supabase_url]
```

It deliberately prints **only the file path, line number, and category** — never the matched content — so the verification log itself is safe to share.

Exit codes:

- `0` — clean (or dry-run / successful verify-only)
- `1` — residue found, or fatal error
- `2` — bad arguments, missing source, dest exists without `--force`

Lexical replacements (internal codenames, personal names, `actor_id`, Windows paths) are **not** part of the verify pass — those are cosmetic normalizations, not security-critical residue. Absence is verified by spot-checking the diff rather than by regex scan.

## When to re-run

Re-run after every significant ship — the stated trigger in `CLAUDE.md` is phrases like "deploy to GitHub", "release to GitHub", "push to GitHub", "publish to GitHub", "mirror the public repo". Typical cases:

- A new package or major feature lands on `main`
- Public docs change (`README.md`, `docs/AGENTIC_PROTOCOL.md`, `ARCHITECTURE.md`)
- A new migration is added
- Version bump
- A new credential pattern needs to be scrubbed (update `buildPatterns()` first, then re-run)

## Workflow around the script

1. Land changes on `main` in the dev repo.
2. `node scripts/build-public-export.mjs --source . --dest ../relay-public-staging --force`
3. Review the summary — every category count should be what you expect, and status should be `CLEAN`.
4. Eyeball `../relay-public-staging/` — structure, presence of LICENSE + README + CONTRIBUTING, absence of `CLAUDE.md` / `.claude/` / internal docs.
5. If the staging dir is already a git repo pointed at `github.com/tensorpunk-labs/relay`, commit and push. If not, initialize it, add the remote, push.

If verify fails, **do not push**. Investigate the hit, decide whether it's a true positive (need to scrub or exclude the source), update the script or the source, and re-run.
