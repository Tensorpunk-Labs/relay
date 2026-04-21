---
name: using-relay
description: Use at session start, or when the user mentions Relay, context flow, cross-session memory, agentic handoffs, or running `relay` commands. Teaches how to pull context on entry, deposit proactively at significant moments, and orient against prior sessions via the Relay CLI + MCP tools.
---

# Using Relay

Relay is a **context flow protocol** for human-agent teams. Context packages capture what happened in a session — decisions, open questions, files changed, a handoff note — so the next session (yours or another agent's) starts oriented instead of cold.

If this skill activated, treat Relay as the context layer for this session. Do the steps below in order.

## 1. First-run setup (once per machine)

Check for `~/.relay/config.json`. If it doesn't exist, walk the user through setup before doing anything else:

1. Confirm the `relay` CLI is reachable: `relay --version`. If not, point them at the repo README (build with `pnpm build`, then `pnpm --filter @relay/cli link --global`).
2. Ask them which backend to use:
   - **SQLite** (zero config, local file, good for solo use): `relay config set storage sqlite`
   - **Supabase** (shared backend, multi-actor): needs `SUPABASE_URL` and `SUPABASE_ANON_KEY`; `relay config set storage supabase`, then set those values
3. Set identity: `relay config set actor-id <their-actor-id>` and `relay config set actor-type human`

If config already exists, skip this section.

## 2. Session start — pull context

At the beginning of any working session, orient yourself:

- MCP form (preferred when available): call the `relay_pull_context` tool
- CLI form: `relay pull --latest` (or `relay pull --project <id> --latest`)

Read what the previous session left. State **one sentence** summarizing it to the user so they know you're oriented.

If the project needs a broader view, call `relay_orchestrate` (or `relay orchestrate`) — it assembles all recent packages across the project for synthesis.

## 3. When to deposit — proactively, at key moments

Do **not** wait for the user to say "deposit." Deposit when something meaningful happened:

- A major decision (architecture choice, strategy shift, approach change)
- A milestone shipped (feature complete, merge to main, benchmark run)
- New information changed direction (competitive analysis, bug discovery, feedback)
- Critical open questions surfaced or were resolved
- A handoff moment — you're about to context-switch or the session is winding down

Do **not** deposit for:
- Routine code changes — the stop hook auto-captures git state
- Mid-conversation progress before a conclusion
- Every commit or small fix

**Self-assess significance.** Would the deposit include `decisions_made`, `open_questions`, or a meaningful `handoff_note`? Would it score >= 7 on a 1–10 significance scale? If yes, deposit. If not, skip.

## 4. How to deposit correctly

Use the `relay_deposit` MCP tool with **top-level JSON arguments** — never XML-style tags embedded in the description string.

Correct shape:
```json
{
  "title": "[KEY] Auth rewrite shipped — Supabase RLS active on prod",
  "description": "Short prose summary of what happened and why.",
  "decisions": ["Chose Supabase RLS over app-layer ACLs because X", "Deferred SSO to v0.3"],
  "open_questions": ["Do we need per-row policies for the audit log?"],
  "handoff_note": "Next session: run the migration dry-run on staging, then flip the flag in prod.",
  "topic": "infrastructure",
  "artifact_type": "milestone"
}
```

Prefix the title with `[KEY]` for major milestones (significance >= 9) or `[SIG]` for notable decisions (significance 6–8).

If you catch yourself writing `<parameter name="...">...</parameter>` inside the `description` string, stop — those fields go in as top-level arguments, not XML inside prose. A malformed deposit still commits but the structured fields come back empty.

## 5. CLI surface (for scripting and manual use)

| Command | Purpose |
|---------|---------|
| `relay pull --latest` | Pull the most recent package for the current project |
| `relay deposit --auto` | Deposit with git state auto-detection (stop-hook form) |
| `relay deposit --title "..." --handoff "..."` | Manual deposit with explicit fields |
| `relay status` | Project overview — recent packages, open questions |
| `relay orchestrate` | Assemble a full-project digest for synthesis |
| `relay orchestrate --focus "<topic>"` | Focused digest on one area |
| `relay projects list` | List all registered projects |
| `relay session start --project <id>` | Start a tracked session (optional) |
| `relay config show` | Show current config |

Most usage is conversational — Claude Code calls the MCP tools behind the scenes. The CLI is for scripting, debugging, and situations where MCP isn't available.

## 6. Project identification

Each repo can declare a `Relay Project ID` in its `CLAUDE.md`. If present, use that project ID for deposits and pulls in that repo. If not, `relay_status` with no args shows the current project based on CWD; `relay projects list` enumerates options.

## 7. The one-line principle

Relay's value is the context *between* sessions, not the context *within* one. If the only thing the next session needs is already in the code or the commit message, skip the deposit. If the next session would have to re-derive a judgment call you already made — deposit.

---

*Relay is BSL 1.1 source-available. Protocol spec: `docs/AGENTIC_PROTOCOL.md`. Full CLI reference and architecture: `README.md`, `ARCHITECTURE.md`.*
