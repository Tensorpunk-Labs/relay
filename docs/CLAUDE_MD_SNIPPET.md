# CLAUDE.md snippet

Paste this into your own `CLAUDE.md` (project or global) to teach Claude Code how to use Relay. It's the same guidance the bundled `using-relay` skill carries, but lives at `CLAUDE.md` — which means it's **always on** for every session in the project instead of activating on demand.

Use the skill if you want Relay to stay out of the way until needed. Use this snippet if you want every session to be oriented through Relay automatically.

---

```markdown
## Relay — Context Flow Protocol

Relay is the context layer for this project. Every session should orient against it on start and deposit meaningful state on exit.

**How:**
- `relay_pull_context` (MCP) or `relay pull --latest` (CLI) at session start.
- `relay_deposit` proactively at significant moments — major decisions, milestones, direction-changing discoveries, handoffs.
- Use `relay_orchestrate` when you need a broader view across recent sessions.

**Deposit shape.** Pass `decisions`, `open_questions`, `handoff_note` as **top-level JSON args**, never as XML tags inside `description`. Prefix the title with `[KEY]` (significance 9+) or `[SIG]` (6-8). Skip trivial code changes — the stop hook auto-captures git state.

**When to deposit:**
- A major decision, strategy shift, or approach change
- A milestone shipped
- New information that changed direction
- A critical open question surfaced or resolved
- Session wind-down or context-switch

**When not to deposit:**
- Routine code changes
- Mid-conversation progress before a conclusion
- Every commit or small fix

**Install state.** If `~/.relay/config.json` is missing, walk the user through: pick a backend (SQLite = zero-config, or BYO Supabase), set `actor-id`, register the MCP server in Claude Code config. Then restart Claude Code so the MCP server comes up.

**Project ID.** If this repo has its own `CLAUDE.md` with a `Relay Project ID`, deposit and pull against that ID. Otherwise `relay status` shows the current project based on CWD.
```

---

## Optional: repo-level `Relay Project ID`

If you want agents to deposit into a specific Relay project for this repo, add a small header to your `CLAUDE.md`:

```markdown
## Relay Project ID
`proj_your_project_id_here`
```

Agents that read `CLAUDE.md` will pick this up and target it for deposits. No config changes needed.

## Global vs project

You can put the snippet in either:

- **`~/.claude/CLAUDE.md`** (global) — applies to every Claude Code session on your machine
- **`<repo>/CLAUDE.md`** (per-project) — applies when working inside that repo

Per-project is usually what you want for the `Relay Project ID` header. The generic Relay guidance can live globally so every project benefits without duplication.
