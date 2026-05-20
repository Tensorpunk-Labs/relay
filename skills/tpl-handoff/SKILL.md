---
name: tpl-handoff
description: Use when the user invokes /tpl-handoff. Exports the current conversation context to a self-contained handoff .md document — agent instructions at the top, human-readable summary in the middle, suggested next actions at the bottom — so any fresh agent or human can pick up the work without scrollback. Useful at session end, before context compaction, before switching machines, or when delegating to a collaborator.
---

# tpl-handoff — Context Handoff Document Generator

When invoked, write a single Markdown file that any agent (Claude / GPT / Gemini / a human) can read cold and resume the work. The document has three layers:

1. **Header — agent instructions.** Tells the receiving agent how to read this file, what context to load, and how to behave (don't re-explore, trust the summary, ask before destructive actions).
2. **Summary — what's happening and where we are.** For both the user and the agent. Phase, decisions, in-flight artifacts, open questions, working directory, relevant memory.
3. **Suggested next actions.** Concrete moves the agent can offer the user. If the work is repo bootstrap or deployment, walk through the bootstrap steps so the receiving agent can offer the user a step-by-step.

This is the **portable handoff format** — distinct from Relay deposits (which live in Supabase) and from `/tpl-context-report` (which is a session-local visualizer).

## Invocation patterns

| Input | Behavior |
|---|---|
| `/tpl-handoff` | Write to `./HANDOFF-<ISO-date>.md` in current working directory |
| `/tpl-handoff <path>` | Write to user-specified path (absolute or relative) |
| `/tpl-handoff --deposit` | Also create a Relay deposit linking to the file (uses the project mapped to cwd) |
| `/tpl-handoff --stdout` | Print the document to chat instead of writing to disk (for quick paste-around) |

If a file already exists at the target path, ask before overwriting unless the user passed `--force`.

## Phase 1 — Gather context

Pull together everything the handoff needs. Sources:

1. **Conversation state** — what the user asked, what decisions were made, what artifacts you produced, open questions you raised
2. **Working directory** — `pwd` + a brief `ls` of the top level so the receiving agent knows the repo shape
3. **Memory** — read `MEMORY.md` index; surface only entries clearly relevant to the active work (do NOT dump the whole thing)
4. **Active plans / epics** — if a superpowers plan, EPIC_MASTER.md, or .retro file is in flight, link to it
5. **Recent file activity** — files read/edited/written this session (same enumeration logic as `/tpl-context-report`)
6. **Project CLAUDE.md** — note its location so the receiving agent can load it
7. **Relay project id** — if cwd maps to a project in `~/.relay/config.json`, name it

Do NOT include sensitive material:
- Tokens / API keys / secrets — never. Even if they appear in CLAUDE.md, redact in the handoff.
- `.env` content — never.
- Anything the user flagged as private during the session.

## Phase 2 — Detect "task shape"

The suggestions section depends on what the work actually is. Classify:

| Shape | Trigger | Suggestion style |
|---|---|---|
| `bootstrap-repo` | New repo being set up, CLAUDE.md being written, package.json being initialized | Step-by-step bootstrap walkthrough |
| `feature-in-flight` | Plan or epic exists with completed + remaining stages | Resume at next stage with explicit pick-up pointer |
| `debug-in-flight` | Active investigation, failing test or symptom unresolved | Hypothesis list + next experiment to run |
| `design-exploration` | Brainstorm or architecture discussion, no commits yet | Decision points list + recommended next conversation |
| `shipping` | Code complete, awaiting deploy / PR / launch | Pre-flight checklist + launch steps |
| `research` | Reading docs, gathering info, no implementation | Findings summary + recommended decision |
| `mixed / other` | Multiple threads interleaved | List each thread with its own pick-up pointer |

Pick exactly one shape. If genuinely ambiguous, use `mixed` and name the threads.

## Phase 3 — Write the document

Use this template literally. Fill in the bracketed sections.

```markdown
# Handoff — [short title naming the work]

> **Generated:** [ISO timestamp]
> **From session by:** [actor_id from relay config, default "jordan"]
> **Working directory:** `[absolute cwd]`
> **Task shape:** `[shape from Phase 2]`
> **Relay project (if any):** `[proj_id — name]` or `(none — cwd not mapped)`

---

## For the receiving agent — read this first

You are picking up an in-progress task from a previous session. Before responding to the user:

1. **Load the working directory's `CLAUDE.md`** at `[path]` — it has project-specific rules that override defaults.
2. **Glance at `MEMORY.md`** at `C:\Users\TensorPunk\.claude\projects\X--Tensorpunk\memory\MEMORY.md` — only pull individual memory files if the summary below points to them by name.
3. **Trust this document's summary** — do not re-explore the codebase to "verify what's been done." If you doubt a claim, ask the user; don't burn context re-deriving it.
4. **Honor the open questions** below before taking actions that would foreclose them.
5. **Do NOT take destructive actions** (force push, rm -rf, dropping tables, force-overwriting files) without confirming with the user first, even if the previous session was mid-flow on something destructive.
6. **Skill discipline** — if a superpowers or tpl skill applies to the next step, invoke it before responding.

When you respond to the user, your first message should be a short orient ("I've read the handoff — you're at X, next step is Y; ready when you are") so they know you actually loaded the context.

---

## Summary — where we are

**What we set out to do:** [1-2 sentence statement of the user's goal in this work]

**What's done:**
- [bullet per completed artifact or decision, with file paths in backticks where applicable]

**What's in flight:**
- [bullet per partially-done item with current state and what remains]

**Decisions made (and why):**
- [bullet per decision: "Chose X over Y because Z"]

**Open questions:**
- [bullet per unresolved question]

**Files in context (the ones that matter):**
- `path` — [one-phrase reason it matters]
- [3-8 entries, the ones a fresh agent should actually load. Not an exhaustive dump.]

**Relevant memory entries (load on demand):**
- `MEMORY.md → [memory-name]` — [one-phrase summary]
- [only entries directly relevant to this work]

---

## Suggested next actions

[Depends on task shape — pick the appropriate block below. Use ONE block, not all of them.]

### If `bootstrap-repo`:

To bootstrap this repo, the receiving agent should offer the user this walkthrough:

1. [Concrete step: install deps / run init script / create config — with the exact command]
2. [Next concrete step]
3. ...
4. **Verify:** [how to verify the bootstrap succeeded]
5. **First commit:** [what to commit and the suggested commit message]

The receiving agent should ask "want me to run this for you, or talk you through it?" before executing.

### If `feature-in-flight`:

- **Pick up at:** [single most natural next action — be specific, name the file and line if possible]
- **Then:** [the step after that]
- **Watch for:** [known gotchas or constraints the previous session discovered]

### If `debug-in-flight`:

- **Symptom:** [one line]
- **What we've ruled out:** [bullet list]
- **Leading hypothesis:** [current best theory]
- **Next experiment:** [exact command or change to try]

### If `design-exploration`:

- **Open decisions:** [list]
- **Tradeoffs already mapped:** [brief]
- **Suggested next conversation:** [a specific prompt the user could ask the receiving agent]

### If `shipping`:

- **Pre-flight checklist:**
  - [ ] [item]
  - [ ] [item]
- **Launch sequence:** [steps in order]
- **Rollback plan if it goes wrong:** [one line]

### If `research`:

- **Key findings:** [bullets]
- **Recommendation:** [one-line synthesis]
- **Decision the user needs to make:** [framed as a question]

### If `mixed`:

For each thread, give: [thread name] → [pick-up pointer]

---

## Quick orient script for the receiving agent

If the user just says "go" or "continue" after this handoff loads, the receiving agent should:

1. [Specific first action — usually a Read or a status check]
2. [Specific second action]
3. Report back with a one-line orient before doing anything that writes to disk.
```

## Phase 4 — Optional Relay mirror

If `--deposit` was passed, after writing the file:

1. Detect the relay project from cwd → `~/.relay/config.json` project_paths
2. Call `relay_deposit` (MCP tool) with:
   - `title`: `[HANDOFF] <short title>`
   - `description`: 2-3 sentence summary
   - `handoff_note`: contents of the Summary section
   - `open_questions`: array from the Open Questions section
   - `decisions`: array from Decisions Made section
3. Tell the user: "Mirrored to Relay as `pkg_<id>`. The file is the canonical artifact; the deposit is a pointer."

If cwd doesn't map to any project, ask the user which project to deposit to (offer "Tensorpunk Meta" / "the developer Thoughts" as defaults) or skip the deposit with a note.

## Phase 5 — Report back

Tell the user:

```
Wrote handoff to <path> (<N lines, ~M words>).
Task shape: <shape>.
[If --deposit: Mirrored to Relay as pkg_<id> in <project-name>.]
[If --stdout: handoff printed above.]

To use this handoff in a fresh session, send the file path as the first user message — the receiving agent will read the "For the receiving agent" header and orient itself.
```

## Behavior rules

1. **Be specific.** A handoff that says "we worked on the auth system" is useless. A handoff that says "edited `src/auth/session.ts:42` to handle expired refresh tokens; tests still failing in `auth.test.ts:128`" is useful. Names, paths, line numbers.

2. **Don't dump.** The handoff is curated, not exhaustive. Skip files that don't matter to resuming the work. The receiving agent can always re-explore if needed — but having to filter through 80 file paths to find the 4 that matter wastes context.

3. **No invented work.** Only include decisions, artifacts, and questions that actually happened in the conversation. If you're not sure something was decided, don't claim it was.

4. **Redact secrets.** Tokens, keys, .env values — never appear in the handoff. If a token would naturally belong in a "next step" instruction, write `<TOKEN>` and tell the user to substitute.

5. **One task shape per handoff.** If a session spanned three unrelated threads, write three handoffs OR use `mixed` shape — don't pretend it was one coherent task.

6. **Respect `--stdout`.** If the user wants the doc inline, don't also write it to disk.

7. **Don't over-explain the format.** The receiving agent will read the doc; you don't need to narrate it back to the current user.

## What this skill is not

- **Not a Relay deposit on its own** — deposits live in Supabase, handoffs live in files. Use `--deposit` to do both. Use `relay_deposit` alone if you don't need a portable doc.
- **Not a context report** — for an inventory + visualizer of files in context, use `/tpl-context-report`.
- **Not a memory store** — use `/store-memory` if a fact deserves persistence across all future sessions.
- **Not a commit log** — git history covers what changed; this covers why and what's next.

## Examples

### Example 1 — feature-in-flight handoff

```markdown
# Handoff — Direction magnitude UI for ExampleTool

> Generated: 2026-05-20T14:32:00Z
> From session by: jordan
> Working directory: `X:\Tensorpunk\_repos\projects\LatentSamplerJUCE`
> Task shape: `feature-in-flight`
> Relay project: `proj_70cb0538559c43a49c9cb248ff94cd0c — LatentSamplerJUCE`

---

## For the receiving agent — read this first
[... standard header ...]

## Summary — where we are

**What we set out to do:** Surface per-direction magnitude in the UI so users can see why a direction at the same "amount" knob position can sound dramatically different.

**What's done:**
- Added `magnitude` field to `Direction` struct in `Source/Directions/Direction.h:14`
- Wired magnitude through to scale calc in `Source/Engine/FXChain.cpp:88`
- Persistence writes magnitude to JSON (`Source/Directions/DirectionStore.cpp`)

**What's in flight:**
- UI badge showing magnitude next to direction name — JSX scaffolded in `WebUI/src/DirectionCard.tsx` but not yet styled

**Decisions made:**
- L2-normalize direction, store magnitude separately — matches Python reference impl (memory: ExampleTool Direction System)
- Default magnitude 1.0 for factory directions so existing presets behave unchanged

**Open questions:**
- Should the badge show raw magnitude or a normalized "weight" (e.g. "1.0x" vs "100%")?
- Do legacy presets need a one-time migration to backfill magnitude=1.0, or does default-on-load suffice?

**Files in context (the ones that matter):**
- `Source/Directions/Direction.h` — struct definition
- `Source/Engine/FXChain.cpp` — scale calculation
- `WebUI/src/DirectionCard.tsx` — UI in flight

**Relevant memory entries:**
- `MEMORY.md → ExampleTool Direction System` — Python reference impl + persistence path

---

## Suggested next actions

- **Pick up at:** Style the magnitude badge in `WebUI/src/DirectionCard.tsx` — design token for the value is `--accent-amber`, match the existing pill style from `BadgeRow.tsx`.
- **Then:** Resolve the open question about raw vs normalized display with the developer before merging.
- **Watch for:** `VST3_DEBUG_LOG.txt` shows the magnitude correctly applied at runtime — verify after rebuild.

---

## Quick orient script for the receiving agent

1. Read `WebUI/src/DirectionCard.tsx` to see where the scaffold landed
2. Read `WebUI/src/BadgeRow.tsx` for the pill style to match
3. Report back with: "I see the magnitude badge scaffold — ready to style. Raw or normalized display?"
```

### Example 2 — bootstrap-repo handoff (shortened)

```markdown
# Handoff — Bootstrap relay-android repo

> Task shape: `bootstrap-repo`

## Summary — where we are
**What we set out to do:** Create a new Android client repo for the Relay context protocol.
**What's done:** Empty dir scaffolded at `/path/to/relay-android`. No code yet.

## Suggested next actions

To bootstrap this repo:

1. `cd /path/to/relay-android`
2. `git init && git branch -m main`
3. Create `gradle/wrapper/` from the standard Android template
4. Write minimal `app/build.gradle.kts` targeting SDK 34, min 26
5. Write `CLAUDE.md` with project-specific Kotlin/Android conventions
6. **Verify:** `./gradlew tasks` runs without error
7. **First commit:** "feat: scaffold Relay Android client"

The receiving agent should ask "want me to run these for you, or talk you through it?" before executing any step.
```

## Length target

A typical handoff is 80-150 lines. If yours is shorter than 50 lines, you're missing context. If it's longer than 200 lines, you're dumping instead of curating.