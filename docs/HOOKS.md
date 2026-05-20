# Claude Code Hooks for Relay

Relay's experience improves when wired into Claude Code's hook events. None of the hooks below are required to use Relay — the MCP server and CLI work fine standalone — but each one adds a specific capability. Add what fits your workflow; skip what doesn't.

All snippets go in `~/.claude/settings.json` (your global Claude Code settings, NOT a per-project file).

---

## Hook 1 — `SessionStart` / orient bundle (recommended)

Auto-injects Relay's wake-up bundle at the start of every session so you start oriented against prior context without having to ask.

```json
"SessionStart": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node /absolute/path/to/relay/packages/cli/dist/index.js orient 2>/dev/null || true"
      }
    ]
  }
]
```

Substitute the absolute node path for `/absolute/path/to/relay/...` based on where you cloned the repo. Use `"relay orient 2>/dev/null || true"` if the CLI is linked globally.

The `2>/dev/null || true` keeps a malformed config or missing project from blocking session start.

---

## Hook 2 — `Stop` / auto-deposit (recommended)

Captures a context package at the end of every Claude Code turn that produced meaningful work. The deposit includes git branch, diff, changed files, last commit, and (with Hook 3 also wired) a `context_snapshot` of the files in scope this session.

```json
"Stop": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node /absolute/path/to/relay/packages/cli/dist/index.js deposit --auto --quiet"
      }
    ]
  }
]
```

Dedup is built in — back-to-back turns with the same git state don't produce duplicate packages. The `--quiet` flag suppresses stdout so it doesn't surface in the user-visible transcript.

You can add other Stop entries alongside (sound cues, notifications, etc.) — Claude Code runs them in declaration order.

---

## Hook 3 — `PostToolUse` / context_snapshot capture (recommended)

Without this hook, auto-deposits carry only git state. With it, auto-deposits also carry a `context_snapshot` — a structured inventory of every file the agent touched during the session, with role (read / edit / write / reference), category, line count, and a heavyweights ranking. The receiving session sees not just what was decided, but what was on the previous agent's desk.

**Add this block alongside the Stop and SessionStart hooks:**

```json
"PostToolUse": [
  {
    "matcher": "Read|Edit|Write|Glob|Grep|NotebookEdit|MultiEdit",
    "hooks": [
      {
        "type": "command",
        "command": "node /absolute/path/to/relay/packages/cli/dist/index.js hook log-tool"
      }
    ]
  }
]
```

### How it works

1. The hook fires for every file tool call. The handler extracts the file path from `tool_input` and appends a `{ts, session_id, tool, role, path}` record to `.relay/context-log.jsonl` in the current working directory.
2. When the Stop hook runs `relay deposit --auto`, the CLI reads that log, dedupes per path, picks the strongest role per file (write > edit > read > reference), counts touches, infers categories, approximates line counts by reading from disk, and synthesizes a `ContextSnapshot`.
3. The snapshot is attached to the package via the `context_snapshot` jsonb column, then the log is truncated so the next session starts fresh.
4. Sensitive path patterns (`.env*`, `credentials*`, `*.key`, `secrets/`, `.ssh/`, `.aws/`, `.gnupg/`, `id_rsa`) are replaced with `[redacted]` server-side by `@relay/core`'s `redactSensitivePaths` before persistence.

### Defensive by design

The handler **never throws and never blocks the hook chain**. If stdin is empty, malformed, or the disk is unwriteable, it exits 0 silently and the next auto-deposit just falls back to git-state-only. You can't break your hook chain by misconfiguring this hook.

### What's tracked

| Tool       | Field extracted    | Role assigned |
|------------|--------------------|----------------|
| Read       | `file_path`        | `read`         |
| Edit       | `file_path`        | `edit`         |
| MultiEdit  | `file_path`        | `edit`         |
| Write      | `file_path`        | `write`        |
| NotebookEdit | `notebook_path` (fallback `file_path`) | `edit` |
| Glob       | `path`             | `reference`    |
| Grep       | `path`             | `reference`    |

`Bash` is intentionally excluded — parsing command strings for paths is fragile and creates false positives. If you need command-level tracking, deposit manually with `relay deposit --context-snapshot <file>`.

### Picking up the change

Claude Code's settings watcher does NOT pick up `~/.claude/settings.json` changes in already-running sessions. After editing, either:

- Open `/hooks` in any active session (this reloads the config), or
- Restart Claude Code.

New sessions started after the edit pick up the hook automatically.

---

## Manual deposits with `context_snapshot`

Hook 3 covers auto-deposits. For **manual** deposits where the agent has actively curated which files matter:

- CLI: `relay deposit --title "..." --context-snapshot ./snap.json`
- MCP tool: pass a top-level `context_snapshot` object to `relay_deposit`

Both routes flow through the same validator and the same redaction step. The `/tpl-context-report` Claude Code skill (also bundled in `skills/`) emits JSON in the correct shape — pass `--deposit` to it to write a file ready for the CLI form.

See [relaymemory.com/context-snapshot](https://relaymemory.com/context-snapshot) for the full design.

---

## Putting it all together

A complete Relay-wired `~/.claude/settings.json` includes all three hooks:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node /path/to/relay/packages/cli/dist/index.js orient 2>/dev/null || true" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node /path/to/relay/packages/cli/dist/index.js deposit --auto --quiet" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Read|Edit|Write|Glob|Grep|NotebookEdit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "node /path/to/relay/packages/cli/dist/index.js hook log-tool" }
        ]
      }
    ]
  },
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["/path/to/relay/packages/mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://YOUR_PROJECT.supabase.co",
        "SUPABASE_ANON_KEY": "your-anon-key"
      }
    }
  }
}
```

With those three hooks plus the MCP server, every session boots oriented, every meaningful turn deposits, and every auto-deposit carries the context that produced it.
