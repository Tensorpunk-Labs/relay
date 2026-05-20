---
name: tpl-context-report
description: Use when the user invokes /tpl-context-report. Inventories every file currently in the agent's conversation context, prints a grouped markdown table, and launches a self-contained HTML visualizer with copy-path and reveal-in-explorer affordances. Also serves as the live-mode preview of what a Relay deposit's context_snapshot field carries — pass --deposit to emit JSON suitable for `relay deposit --context-snapshot <file>` or the `context_snapshot` parameter on the `relay_deposit` MCP tool. Read-only — does not modify project files.
---

# tpl-context-report — Inventory & Visualize Conversation Context

When invoked, produce a structured inventory of every file the agent has touched or had loaded into context this session, then generate a self-contained HTML visualizer and open it in the user's default browser.

This skill plays two roles:

1. **Session-local introspection** — see what's in your agent's head right now (the default mode).
2. **Live-mode preview of a Relay deposit's `context_snapshot`** — Relay packages now carry an optional `context_snapshot` field that records exactly this inventory at deposit time. This skill produces the same JSON shape Relay expects; pass `--deposit` to write it to a file you can feed into `relay deposit --context-snapshot <file>` or the `relay_deposit` MCP tool's `context_snapshot` parameter.

No memory load. No edits.

## Invocation patterns

| Input | Behavior |
|---|---|
| `/tpl-context-report` | Full inventory + table + launch visualizer |
| `/tpl-context-report --no-browser` | Inventory + table only; write the HTML but do not open it |
| `/tpl-context-report --table-only` | Inventory + table only; skip HTML generation entirely |
| `/tpl-context-report --deposit` | Inventory + table + write a `context-snapshot.json` to the OS temp dir, ready to feed into `relay deposit --context-snapshot <file>`. Also writes the HTML viewer unless combined with `--table-only`. Tell the user the exact path and the exact CLI invocation to deposit it |
| `/tpl-context-report --deposit --inline` | Same as `--deposit`, but also print the JSON inline so the user can paste it directly into the `relay_deposit` MCP tool's `context_snapshot` field |

## Phase 1 — Enumerate context

Walk your own conversation context and collect every file reference. Sources to scan:

1. **Read tool calls** — every file you've read this session
2. **Edit / Write / NotebookEdit results** — every file you've modified or created
3. **SessionStart-loaded docs** — CLAUDE.md (global + project), MEMORY.md, any system-reminder bundles, Relay orient bundle
4. **Skill / plan files in flight** — superpowers plans, .retro files, EPIC_MASTER.md, PROJECT_HISTORY.md if loaded
5. **Tool-result file paths** — files surfaced by Glob/Grep that you actually opened
6. **User-attached paths** — paths the user pasted in messages that you then opened

Do NOT include:
- Files referenced only by name but never opened
- Transient bash output paths
- The HTML file this skill itself will generate

For each file, capture:
- **path** (absolute)
- **role** — `read` | `edit` | `write` | `session-load` | `plan` | `reference`
- **approx_size** — line count if known, else "?"
- **category** — see Phase 2
- **why** — one short phrase: why this file is in context (e.g. "current edit target", "loaded by SessionStart hook", "user pasted path", "superpowers plan in flight")

## Phase 2 — Categorize and group

Assign each file a category. Group similar files instead of listing each one when there are many:

| Category | Examples |
|---|---|
| `instructions` | CLAUDE.md, AGENTS.md, GEMINI.md, MEMORY.md |
| `plan-in-flight` | superpowers plans, EPIC_MASTER.md, active .retro files |
| `major-doc` | README.md, PROJECT_HISTORY.md, ARCHITECTURE.md, top-level docs |
| `source-code` | implementation files (.ts/.tsx/.py/.cpp/.rs/.go/.js/.jsx) |
| `config` | package.json, tsconfig.json, cmake files, .yaml/.toml/.ini |
| `test` | *.test.* / *.spec.* / tests/ folders |
| `script` | one-off scripts and CLI entrypoints |
| `data` | .json/.csv/.parquet fixtures the agent loaded |
| `binary-ref` | files the agent only listed/globbed but didn't read |
| `other` | anything that doesn't fit |

**Generalization rule:** when 3+ files share both a directory and an extension, collapse them into a single row like `src/components/*.tsx (12 files, ~3,400 lines total)`. Keep individual rows for `instructions`, `plan-in-flight`, and `major-doc` — those always list individually because they steer agent behavior.

## Phase 3 — Identify the heavyweights

Rank files by token weight (rough line-count proxy) and mark:
- **Top 3 biggest** — these dominate the context budget
- **Top 3 most-referenced** — files you've touched multiple times this session
- **Stale loads** — files loaded early in the session and not referenced since (candidates for /clear if context pressure is a concern)

## Phase 4 — Print the markdown report

Output structure (keep it tight; this is a scan, not a transcript):

```markdown
## Context Report — <ISO date + short time>

**Session shape:** <N files in context, ~M lines total, dominant categories: X, Y, Z>

### Steering docs
| Path | Role | Lines | Why |
|---|---|---|---|
| ... | instructions / plan-in-flight / major-doc rows, individually listed | | |

### Code & config
| Path / Group | Role | Lines | Why |
|---|---|---|---|
| ... | collapsed where 3+ files share dir+ext | | |

### Heavyweights
- **Biggest:** `path` (~N lines) — <why it's big>
- **Most touched:** `path` (X reads/edits)
- **Stale loads:** <files loaded but unused for the last several turns>

### Visualizer
Opened in default browser: `<path to generated HTML>`
(Or, if `--no-browser`: "Written to <path>; open manually with `start <path>`")
```

## Phase 4.5 — Emit deposit JSON (only with `--deposit`)

Skip this phase unless `--deposit` was passed.

Write the inventory in `ContextSnapshot` shape (see `@relay/core/types`) to:

```
C:\Users\TensorPunk\AppData\Local\Temp\tpl-reports\context-snapshot-<YYYYMMDD-HHMMSS>.json
```

(Bash path: `/c/Users/TensorPunk/AppData/Local/Temp/tpl-reports/...`)

Shape:

```json
{
  "session_shape": { "files": 8, "lines": 1101, "dominant_categories": ["instructions", "major-doc"] },
  "files": [
    { "path": "...", "role": "read", "category": "major-doc", "lines": 181, "why": "..." }
  ],
  "heavyweights": {
    "biggest":      [{ "path": "...", "metric": 270, "note": "..." }],
    "most_touched": [{ "path": "...", "metric": 2,   "note": "..." }],
    "stale":        [{ "path": "...", "metric": null, "note": "..." }]
  },
  "category_totals": { "instructions": 420, "major-doc": 651, "config": 30 }
}
```

After writing, tell the user the exact path AND the exact commands to deposit it. Examples:

```bash
# CLI deposit attaching the snapshot
relay deposit \
  --title "[SIG] your title here" \
  --description "..." \
  --context-snapshot "C:\\Users\\TensorPunk\\AppData\\Local\\Temp\\tpl-reports\\context-snapshot-<ts>.json"
```

```
# Or via the relay_deposit MCP tool: paste the JSON as the
# `context_snapshot` parameter (top-level argument, not nested
# inside `description`). The MCP tool will validate the shape
# and reject with a clear error if it's malformed.
```

If `--inline` was also passed, print the JSON inline in the chat (fenced) so the user can copy-paste directly.

**Sensitive paths are redacted server-side** by `redactSensitivePaths` in `@relay/core` before persistence — patterns: `.env*`, `credentials*`, `*.key`, `secrets/`, `.ssh/`, `.aws/`. Don't pre-redact in the skill; let core handle it canonically so the rule is single-sourced.

## Phase 5 — Generate the HTML visualizer

Skip this phase if `--table-only`.

Write a **single self-contained HTML file** (inline CSS + JS, no external assets) to:

```
C:\Users\TensorPunk\AppData\Local\Temp\tpl-reports\tpl-context-report-<YYYYMMDD-HHMMSS>.html
```

In bash, use the git-bash drive prefix: `/c/Users/TensorPunk/AppData/Local/Temp/tpl-reports/...`. **Do NOT use `/tmp` or `$TEMP` from this bash** — they resolve to a sandbox location that Windows `start` cannot find. Always write to `/c/Users/.../Temp/tpl-reports/`, and create the `tpl-reports` subdir first with `cmd //c "if not exist <dir> mkdir <dir>"`. (On non-Windows, `$TMPDIR` or `/tmp` is fine — this trap is Windows-bash-specific.)

The HTML must include all data as an inline `<script>const DATA = {...}</script>` block — no fetches, no network. It must work fully offline and survive being emailed or pasted around.

### Visualizer requirements

The page MUST:

1. **Render a sortable table** of every file with columns: path, role, category, lines, why
2. **Render a size treemap or bar chart** showing relative weight by category — pure SVG/Canvas, no chart libraries
3. **Per-row copy button** that copies the absolute path to clipboard via `navigator.clipboard.writeText`
4. **Per-row "reveal" link** that opens `file:///<parent dir>` in a new tab so the OS file browser surfaces the folder
5. **Search box** that filters rows live by path / why text
6. **Category filter chips** — click to toggle visibility
7. **Heavyweights panel** at the top — biggest 3, most-touched 3, stale loads
8. **Session-shape header** — same numbers as the markdown report

### Visual style

Match Tensorpunk aesthetic — dark background, phosphor accents, monospace for paths. Do NOT pull in external fonts or CSS frameworks. Inline a minimal style:

- Background `#0a0a0c`, foreground `#d9d9d9`
- Accent green-cyan `#7fffd4` for interactive elements
- Amber `#ffb347` for heavyweights
- `font-family: ui-monospace, "JetBrains Mono", Consolas, monospace`
- Generous spacing, no rounded corners on tables, sharp 1px borders

The HTML should feel like a terminal readout, not a SaaS dashboard.

### Launch

After writing the file:

```bash
start "" "<absolute-path-to-html>"   # Windows
# or
open "<absolute-path-to-html>"        # macOS
xdg-open "<absolute-path-to-html>"    # Linux
```

(Pick the right one for the current platform — check `process.platform` or assume Windows on this machine since CLAUDE.md says platform: win32.)

No web server needed — the HTML is fully self-contained and runs from `file://`. If the user explicitly asks for an HTTP server (some browsers restrict `file://` clipboard access), fall back to:

```bash
python -m http.server --directory "<dir>" 0   # let OS pick a free port
```

…and report the URL. But default is `file://` — simpler, no port management, no leftover processes.

## Behavior rules

1. **Read-only.** This skill never edits project files. The only write is the HTML in TEMP.
2. **No invented files.** If you're not sure whether a file is "in context," don't include it. The report's value is accuracy.
3. **Honest emptiness.** If the session is fresh and only CLAUDE.md + MEMORY.md are loaded, say so cleanly. Don't pad the report.
4. **Don't re-read everything.** Estimate sizes from your existing knowledge of files. Only re-read a file if you genuinely don't know its shape and it matters for the report.
5. **No meta-narration.** Don't say "I am now scanning context." Just produce the report.
6. **Respect --table-only.** Some sessions (CI, headless) can't open browsers. Honor the flag.
7. **Surface plans-in-flight prominently.** If a superpowers plan or epic is active, it goes at the top of "Steering docs" — that's what an agent picking up the handoff needs to see first.

## What this skill is not

- **Not a memory loader** — use `/read-memory`.
- **Not a deposit** — use `relay_deposit` if you want to persist this snapshot.
- **Not a handoff doc** — use `/tpl-handoff` for that (it generates an agent-readable .md instead of a visualizer).
- **Not a context compactor** — this is observation only; it does not summarize or evict anything.

## Length target

Markdown report: ~25-40 lines max. Visualizer HTML: ~400-600 lines including data. If either runs longer, you're over-doing it.