# Relay Skills for Claude Code

Optional Claude Code skills that teach an agent how to use Relay — the context flow protocol this repo implements. Skills are on-demand behavior packs; install a skill and Claude Code invokes it when the situation matches.

## What's here

| Skill | Triggers | Purpose |
|-------|----------|---------|
| `using-relay` | Session start, or when the user mentions relay / context flow / agentic handoffs | Teaches the deposit / pull / orient workflow and the MCP + CLI surface |

More skills (per-command wrappers, workflow automations) may follow. For now a single meta-skill keeps the install footprint minimal.

## Install

Skills live in `~/.claude/skills/<name>/SKILL.md`. Copy the skill folder into your Claude Code skills directory:

**macOS / Linux:**
```bash
mkdir -p ~/.claude/skills
cp -r skills/using-relay ~/.claude/skills/
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force -Path "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse -Force skills\using-relay "$HOME\.claude\skills\"
```

Then restart Claude Code so the skill registry reloads.

## Prerequisite: install the Relay CLI

The skill expects the `relay` CLI on PATH (or a `node packages/cli/dist/index.js` shim). From this repo:

```bash
pnpm install
pnpm build
pnpm --filter @relay/cli link --global   # makes `relay` available globally
```

If you prefer not to link globally, the skill will use the node path form automatically.

## Alternative: global agent instructions

If you'd rather have Relay always-on (rather than on-demand via the skill), paste the [CLAUDE.md snippet](../docs/CLAUDE_MD_SNIPPET.md) into your global `CLAUDE.md` (or a project-level one). That bootstraps every session into Relay without needing to trigger the skill.

The skill form is lighter (loads only when needed); the CLAUDE.md form is always-on. Pick the one that matches your workflow.

## License

Skills are covered by the same BSL 1.1 license as the rest of this repo. See `LICENSE`.
