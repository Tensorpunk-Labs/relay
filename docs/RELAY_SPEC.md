# RELAY — Specification Document
### Continuous Context Flow for Human-Agent Teams
**Version:** 0.1 — R&D / Foundational  
**Status:** Active Design  
**Intent:** Industry standard protocol for agentic coordination  

---

## 0. The North Star

Every design decision in this system should be evaluated against a single question:

**Does this make the collective smarter?**

Not faster. Not more efficient. Smarter — as a unit.

Every tool, framework, and methodology that came before Relay was built to make *individual actors* more productive and then coordinate them. Scrum coordinates individual humans. IDEs make individual developers faster. Even most "AI tools" augment a single person's workflow. The coordination between actors has always been the expensive, lossy, human-bottlenecked part.

Relay is built on a different premise: **the collective is the product.**

The human-agent team — its shared memory, its accumulated context, its emergent pattern recognition across many parallel workstreams — is the thing being engineered. Individual productivity is a side effect, not the goal.

This means Relay is not a project management tool. It is not a developer tool. It is not an AI wrapper. It is **cognitive infrastructure** — the layer that makes it possible for a group of humans and agents to function as a single, progressively smarter organism over time.

The analogy is not Jira. The analogy is the printing press — infrastructure that made collective human intelligence possible at a scale and fidelity that wasn't achievable before it existed.

The north star metric, when we get there: **does a team running on Relay produce insights, decisions, and outcomes that none of its individual members — human or agent — could have produced alone?** If yes, the system is working. Everything else is implementation detail.

---

## Table of Contents

0. [The North Star](#0-the-north-star)

1. [Philosophy & Core Principles](#1-philosophy--core-principles)
2. [Why Scrum Fails. Why Kanban Is Close. Why We Need Relay.](#2-why-scrum-fails-why-kanban-is-close-why-we-need-relay)
3. [The Core Primitive: Context Packages](#3-the-core-primitive-context-packages)
4. [The Context Diff (.cdiff)](#4-the-context-diff-cdiff)
5. [System Architecture](#5-system-architecture)
6. [The Context Core (Cloud Layer)](#6-the-context-core-cloud-layer)
7. [Vector DB & RAG — Design Decision](#7-vector-db--rag--design-decision)
8. [The Master Orchestrator](#8-the-master-orchestrator)
9. [CLI Tool — relay-cli](#9-cli-tool--relay-cli)
10. [MCP Server Integration](#10-mcp-server-integration)
11. [InstantRecall Integration](#11-instantrecall-integration)
12. [Phase 1: Personal Multi-Instance Setup](#12-phase-1-personal-multi-instance-setup)
13. [Phase 2: Team Coordination Layer](#13-phase-2-team-coordination-layer)
14. [Phase 3: Product / Frontend Vision](#14-phase-3-product--frontend-vision)
15. [Data Models](#15-data-models)
16. [Supabase Schema](#16-supabase-schema)
17. [API Contracts](#17-api-contracts)
18. [Future-Proofing & Standards Philosophy](#18-future-proofing--standards-philosophy)
19. [Open Questions & Design Decisions Log](#19-open-questions--design-decisions-log)
20. [The Lattice Integration — Swarm Research as a Relay Producer](#20-the-lattice-integration--swarm-research-as-a-relay-producer)
21. [AgenticDashboard / External Systems — Existing System Unification](#21-agenticdashboard--openclaw--existing-system-unification)
22. [The Relay Rules Engine — Reactive Automation Layer](#22-the-relay-rules-engine--reactive-automation-layer)
23. [InstantRecall Deep Analysis — Architecture, Assets & Relay Integration Map](#23-instantrecall-deep-analysis--architecture-assets--relay-integration-map)

---

## 1. Philosophy & Core Principles

### The Central Idea

**Work is not a list of tasks. Work is a flow of enriched context.**

Every unit of work — whether completed by a human, an agent, or a combination — produces an artifact that fully equips the next actor to continue without synchronous explanation. This is the foundational break from all prior project management paradigms.

Relay is not a project management tool. It is a **context flow protocol** — an open, agent-native standard for how work moves, what it carries with it, and how any actor (human or AI) can orient themselves at any point in a project's lifetime.

### The Six Principles

**1. Context is the unit of work, not the task.**  
A task is an instruction. Context is an instruction plus everything you'd need to execute it intelligently — decisions made, files produced, constraints discovered, open questions surfaced. Relay ships context, not tickets.

**2. Agents are first-class participants.**  
Agents don't consume tickets. They claim work, produce context, surface blockers, and hand off. The system is designed for them natively, not adapted for them as an afterthought.

**3. Coordination is pull-based and async by default.**  
There is no sprint. There is no standup. There is no forced cadence. Work moves when it's ready. Humans review when it's relevant. The system creates urgency signals, not calendar-driven rituals.

**4. Human checkpoints are intentional design elements, not interruptions.**  
Humans are not the default worker with agents as helpers. Humans are deliberate decision gates in a flow. When human judgment is needed, it is an explicit node in the work graph — known in advance, not discovered at 2pm on a Tuesday.

**5. The work graph is the ground truth.**  
Not a board. Not a spreadsheet. A living, traversable graph where every node is a context package, every edge is a dependency or handoff, and every actor can navigate it programmatically or visually.

**6. The system should be invisible to the flow.**  
The best infrastructure disappears. Relay should feel like a natural extension of how an agent or human already works — not a platform they have to "use."

---

## 2. Why Scrum Fails. Why Kanban Is Close. Why We Need Relay.

### The Problem with Scrum

Scrum was engineered around human cognitive constraints:

- **Two-week sprints** exist because humans need artificial forcing functions to commit, estimate, and reflect. Agents don't have this constraint. Their throughput is elastic.
- **Velocity as a metric** assumes human capacity is roughly stable. Agentic capacity scales non-linearly.
- **Retrospectives** exist to surface emotional and interpersonal blockers. These don't apply to agents.
- **Story points and estimation** assume uncertainty in execution time. An agent either completes a well-specified task or surfaces a blocker immediately.
- **Standups** exist because tribal knowledge lives in people's heads. If context lives in packages, there is nothing to stand up for.

Scrum imposes a **human biological rhythm** on work that agents can do asynchronously and non-linearly. It cargo-cults organizational solutions built for a fundamentally different kind of worker.

### Why Kanban Is Closer

Kanban is better because it's **flow-based rather than time-boxed**. Work moves when it's ready. WIP limits prevent overload. There's no sprint deadline forcing premature "done" declarations.

But Kanban still falls short for agentic teams:

- Cards are thin. They contain instructions but not context — a human pulls a card and uses tribal knowledge to fill the gap. An agent has no such fallback.
- The board is flat. There's no lineage, no causal chain, no way to see why something is in a state.
- Handoffs are implicit. When a card moves to "Review," what exactly is the reviewer getting? Kanban doesn't answer this.
- **Context transfer is completely unmodeled.** This is the hardest problem in agentic teams, and Kanban ignores it entirely.

### What Relay Adds

Relay takes Kanban's flow-based core and extends it with:

- **Rich context packaging** at every handoff
- **Explicit handoff protocols** (agent-to-agent, agent-to-human, human-to-agent)
- **A graph model** instead of a board — work has lineage, causality, and dependency structure
- **Agent-native primitives** — work units that agents can claim, process, and deposit without human translation
- **Persistent shared context** so every instance of every agent on a team starts oriented

---

## 3. The Core Primitive: Context Packages

### What Is a Context Package?

A context package is a **self-contained, portable work artifact** — a `.zip` file that any actor can open and immediately orient from. It contains everything the next actor needs. Nothing is assumed from tribal knowledge.

Think of it as: **mission briefing + flight recorder + deliverables folder**.

The zip format is intentional:
- Lightweight and universal
- No unknown behavior if an agent pulls one cold — it opens it, reads the manifest, understands the whole structure
- Can contain any file type (code, images, wireframes, docs, data)
- Easy to version, store, transfer, archive

### Package Structure

```
context-package-{id}.relay.zip
├── manifest.json          # Machine-readable metadata (the index)
├── CONTEXT.md             # Human + agent readable — the main briefing
├── CLAUDE.md              # Claude-specific entry point (points to CONTEXT.md + relay instructions)
├── .cdiff                 # Context diff from previous package in lineage (see §4)
├── deliverables/
│   ├── *.ts / *.py / *   # Any code files produced
│   ├── *.html             # Wireframes, UI artifacts
│   ├── *.md               # Sub-documents, specs, notes
│   ├── *.png / *.jpg      # Design assets, screenshots, diagrams
│   └── *.json             # Data artifacts, configs
└── resources/             # Input materials consumed during this work unit
    └── *                  # Reference docs, research, dependencies
```

### manifest.json

```json
{
  "relay_version": "0.1",
  "package_id": "pkg_01j...",
  "created_at": "2025-04-03T12:00:00Z",
  "created_by": {
    "type": "agent",
    "id": "claude-instance-abc123",
    "session_id": "sess_xyz"
  },
  "title": "Implement auth middleware — JWT validation layer",
  "description": "Short human-readable summary of what this package contains",
  "status": "pending_review",
  "review_type": "human",
  "parent_package_id": "pkg_01i...",
  "child_package_ids": [],
  "dependencies": ["pkg_01h...", "pkg_01g..."],
  "tags": ["auth", "backend", "security"],
  "project_id": "proj_abc",
  "node_graph_position": { "x": 4, "y": 2 },
  "deliverables": [
    { "path": "deliverables/auth.middleware.ts", "type": "code", "language": "typescript" },
    { "path": "deliverables/auth-flow.html", "type": "wireframe" }
  ],
  "open_questions": [
    "Should token expiry be configurable per environment or global?",
    "Do we refresh silently or force re-login on expiry?"
  ],
  "decisions_made": [
    "Used RS256 over HS256 — asymmetric signing is better for multi-service architecture",
    "Middleware is stateless — no session store dependency"
  ],
  "handoff_note": "Ready for human security review. See open_questions above before proceeding.",
  "estimated_next_actor": "human",
  "context_diff_ref": ".cdiff"
}
```

### CONTEXT.md

The main briefing file. Written in plain Markdown so both humans and agents can read it fluently. Structure:

```markdown
# [Task Title]

## What This Package Is
Brief orientation — what was done, why, what it produced.

## Background & Prior Context
What the agent or human knew coming in. Summarizes the parent package's key points.

## What Was Done
Step-by-step account of execution. Not a log — a narrative. What was tried, what was decided, what changed.

## Decisions Made
- Decision 1: Rationale
- Decision 2: Rationale

## Deliverables
- `deliverables/auth.middleware.ts` — The middleware implementation
- `deliverables/auth-flow.html` — Visual flow diagram

## Open Questions (Unresolved)
Things discovered during execution that require human judgment or further research before the next step.

## What's Next
Recommended next actions. Who/what should act next. What they need to know.

## Handoff Note
[Specific message to the next actor]
```

### CLAUDE.md

A Claude-native entry point that every Claude instance will naturally honor:

```markdown
# RELAY CONTEXT ENTRY POINT

This project is managed under the Relay protocol.
Context Core: https://your-relay-instance.vercel.app
Project ID: proj_abc
Package ID: pkg_01j...

## How to Orient
1. Read `CONTEXT.md` for the full briefing on this work unit
2. Check `manifest.json` for metadata, open questions, and handoff notes
3. Review `.cdiff` to understand what changed from the previous state
4. Deliverables are in `deliverables/`

## When You Complete Work
Use `relay deposit` or the Relay MCP tool to package and submit your output.
The system will guide you through the context package creation.

## Open Questions Requiring Your Attention
[Pulled from manifest.json at package time]
```

---

## 4. The Context Diff (.cdiff)

### Philosophy

A `.cdiff` file answers: **"What changed between the last context state and this one?"**

This is not source code diff. It's a **project state diff** — tracking changes to decisions, files, open questions, status, and context narrative.

### Decision: Don't Fork Git

Forking Git's source would give us a lot for free (delta compression, history traversal, branch model) but adds enormous complexity, a C codebase dependency, and a steep deviation from the web-native stack. More importantly, Git diffs code. We need to diff *structured context*.

The right approach is a **lightweight JSON-based diff format** that is purpose-built for context packages.

### .cdiff Format

```json
{
  "relay_version": "0.1",
  "diff_id": "cdiff_...",
  "from_package": "pkg_01i...",
  "to_package": "pkg_01j...",
  "timestamp": "2025-04-03T12:30:00Z",
  "actor": { "type": "agent", "id": "claude-instance-abc123" },
  "changes": {
    "status": {
      "from": "in_progress",
      "to": "pending_review"
    },
    "open_questions": {
      "added": [
        "Should token expiry be configurable per environment or global?"
      ],
      "resolved": [
        "Which signing algorithm to use?"
      ]
    },
    "decisions_made": {
      "added": [
        "Used RS256 over HS256 — asymmetric signing preferred for multi-service"
      ]
    },
    "deliverables": {
      "added": ["deliverables/auth.middleware.ts", "deliverables/auth-flow.html"],
      "removed": [],
      "modified": []
    },
    "context_summary_delta": "Agent implemented JWT middleware using RS256. Two open questions surfaced around token expiry configuration. Security review checkpoint inserted before next phase."
  }
}
```

### Context Diff Utility (relay-diff)

A simple utility included in `relay-cli` that:
- Generates `.cdiff` automatically when depositing a package
- Can render a human-readable diff summary from any `.cdiff`
- Supports chaining — walk the lineage of a work thread via the `from_package` chain

Future: a visual `.cdiff` viewer in the Relay frontend that renders like a PR diff but for project context.

---

## 5. System Architecture

### Overview

```
┌─────────────────────────────────────────────────────────┐
│                    RELAY ECOSYSTEM                       │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │  relay-cli   │    │  relay MCP   │    │  Relay    │  │
│  │  (terminal)  │    │  (Claude     │    │  Frontend │  │
│  │              │    │   native)    │    │  (future) │  │
│  └──────┬───────┘    └──────┬───────┘    └─────┬─────┘  │
│         │                  │                   │        │
│         └──────────────────┼───────────────────┘        │
│                            │                            │
│                    ┌───────▼────────┐                   │
│                    │  Relay API     │                   │
│                    │  (Vercel Edge) │                   │
│                    └───────┬────────┘                   │
│                            │                            │
│              ┌─────────────┼──────────────┐             │
│              │             │              │             │
│     ┌────────▼──┐  ┌───────▼────┐  ┌─────▼──────┐      │
│     │ Supabase  │  │  Supabase  │  │  Supabase  │      │
│     │ Postgres  │  │  Storage   │  │  pgvector  │      │
│     │ (graph,   │  │  (package  │  │  (semantic │      │
│     │  meta)    │  │   zips)    │  │   search)  │      │
│     └───────────┘  └────────────┘  └────────────┘      │
└─────────────────────────────────────────────────────────┘
```

### Components

| Component | Role | Tech |
|-----------|------|------|
| `relay-cli` | Terminal interface for all Relay operations | Node.js / TypeScript |
| `relay-mcp` | MCP server — Claude-native tool access | MCP SDK / TypeScript |
| Relay API | REST + WebSocket edge API | Vercel Edge Functions |
| Context Core DB | Structured metadata, graph, packages | Supabase Postgres |
| Context Core Storage | Raw `.relay.zip` package files | Supabase Storage |
| Vector Store | Semantic search across context | Supabase pgvector |
| Master Orchestrator | All-seeing context intelligence agent | Claude API (Sonnet) |
| Relay Frontend | Visual graph, team dashboard, review UI | Next.js / Vercel |

---

## 6. The Context Core (Cloud Layer)

### What It Is

The Context Core is the **central persistent memory** for all Relay activity. It is not just storage — it is an organized, queryable, semantically searchable graph of all context packages, their relationships, their states, and their lineages.

It serves as the "shared brain" that all Claude instances connect to — whether they're running locally on one developer's machine or across a distributed team.

### Core Responsibilities

- Store all context packages (zip + extracted metadata)
- Maintain the work graph (nodes = packages, edges = dependencies/handoffs)
- Track package status and review states
- Expose semantic search across all context (via pgvector)
- Serve the Master Orchestrator with full graph traversal capability
- Emit events for status changes (websocket / webhook)
- Manage project and team membership

### Deployment

Hosted on **Vercel + Supabase**:
- API routes on Vercel Edge Functions (zero cold start for CLI/MCP calls)
- Postgres on Supabase (graph data, metadata, user/team state)
- Supabase Storage buckets for raw `.relay.zip` files
- pgvector extension for embedding-based search

### Why Supabase

- Postgres gives us full relational modeling for the graph
- pgvector is a first-class extension — no separate vector DB infrastructure
- Supabase Storage handles binary blob (zip) storage natively
- Real-time subscriptions are built in (useful for status updates, orchestrator events)
- Row-level security maps cleanly to team/project permissions
- Open source — self-hostable, which is critical for enterprise adoption

---

## 7. Vector DB & RAG — Design Decision

### Is It Overengineering?

**No — and here's why it's actually load-bearing.**

The case against: "We have structured metadata, just query Postgres." For simple lookups (find package by ID, list open packages in project) — yes, Postgres is sufficient.

But the Master Orchestrator changes the equation entirely. For the Orchestrator to do its job — understanding the high-level state of a project by traversing potentially hundreds of context packages — it needs **semantic retrieval**, not keyword search.

Consider:
- "What decisions have been made about authentication across the whole project?"
- "Are there any open questions that seem related to each other across different work threads?"
- "What context is most relevant to this new task I'm about to start?"

These questions cannot be answered with SQL. They require embeddings.

### The Right Approach: pgvector, Not a Separate Service

Use Supabase's `pgvector` extension — embeddings live in the same Postgres database as everything else. No additional infrastructure, no separate API, no sync problem.

What gets embedded:
- The full text of each `CONTEXT.md`
- Each decision string
- Each open question string
- The `handoff_note` from each `manifest.json`

When to embed: at deposit time — when a context package is submitted, the Relay API generates embeddings via Claude's embedding API (or OpenAI's) and stores them alongside the package metadata.

This gives us semantic search across the entire context history of a project with minimal additional complexity. It's the right call.

### RAG in the System

RAG is used in two places:

1. **Agent orientation at session start** — when a Claude instance connects to Relay at the start of a session, it retrieves the most semantically relevant recent context packages for the project it's working on. It doesn't dump everything — it retrieves what's relevant.

2. **Master Orchestrator synthesis** — the Orchestrator uses RAG to build high-level project understanding across a potentially unbounded number of packages, without consuming the entire history in one context window.

---

## 8. The Master Orchestrator

### Concept

The Master Orchestrator is an agent that has **read access to the entire Context Core** and is responsible for understanding and synthesizing the high-level state of one or more projects.

It is not a manager. It is not an executor. It is an **all-seeing eye** — a synthesis layer that exists to make the system's emergent state visible and navigable.

### What It Does

- **Project health synthesis** — given the full graph of a project, produce a plain-language summary of where things stand, what's blocked, what's progressing, and what human attention is needed.
- **Cross-thread pattern detection** — identify open questions across different work threads that are actually the same question; surface implicit dependencies the graph doesn't explicitly model yet.
- **Prioritization recommendations** — given the current state, recommend what should be worked on next and by whom/what.
- **Onboarding briefings** — when a new agent or human joins a project, the Orchestrator produces a complete orientation package from the graph history.
- **Anomaly surfacing** — identify packages that have been in a state too long, open questions that are blocking multiple downstream threads, or context drift (agent work diverging from stated project goals).

### Why This Is Interesting

This is where **emergent behavior** becomes visible. When you have 50+ context packages in a graph and a single agent that can semantically traverse all of them, you start to see things that no individual participant — human or agent — could see. The Orchestrator doesn't just read the graph; it *understands it at a level of abstraction* that's impossible when you're inside the work.

The output quality should be noticeably different from just having more context — it should surface second-order insights. This is the part of the system most worth stress-testing early.

### Architecture

The Orchestrator is not a persistent process. It is invoked:
- On demand via `relay orchestrate` CLI command
- On a scheduled basis (e.g., daily digest)
- Triggered by threshold events (e.g., N packages in `pending_review`, a blocker has been open for X hours)

It uses:
1. Structured graph traversal (Postgres queries) for the skeleton
2. Semantic retrieval (pgvector) for relevant context detail
3. Claude Sonnet for synthesis — a single, well-constructed prompt with retrieved context

Output: a structured Orchestrator Report deposited as a special package type in the Context Core, plus an optional human-readable digest.

---

## 9. CLI Tool — relay-cli

### Philosophy

The CLI is the primary interface for developers and agents. It should feel like `git` — a small set of composable commands, sensible defaults, and no ceremony.

### Installation

```bash
npm install -g @relay-protocol/cli
relay init
```

### Core Commands

```bash
# Project management
relay init                          # Initialize Relay in current directory, link to Context Core
relay projects list                 # List projects you have access to
relay projects create "My Project"  # Create a new project

# Session management
relay session start                 # Start a new agent/human session, register with Context Core
relay session end                   # End session, prompt for any outstanding deposits

# Context package operations
relay pull [package_id]             # Pull a specific package or the most relevant one for current session
relay pull --next                   # Pull the next recommended work item
relay deposit                       # Package current work as a context package and upload
relay deposit --draft               # Save a draft without submitting
relay status                        # Show current package being worked, session state, pending reviews

# Graph operations
relay graph                         # Display ASCII work graph in terminal
relay graph --open                  # Open graph in browser (Relay frontend)
relay lineage [package_id]          # Show full lineage chain for a package

# Diff operations
relay diff [from_id] [to_id]        # Show context diff between two packages
relay diff --latest                 # Diff current work against last deposit

# Review operations
relay review list                   # List packages pending your review
relay review approve [package_id]   # Approve a pending review
relay review reject [package_id]    # Reject with notes
relay review comment [package_id]   # Add a comment / open question response

# Orchestrator
relay orchestrate                   # Run the Master Orchestrator against current project
relay orchestrate --digest          # Get a plain-language project status digest

# Configuration
relay config set core-url <url>     # Set Context Core endpoint
relay config set project <id>       # Set default project
relay auth login                    # Authenticate with Context Core
```

### relay deposit — Interactive Flow

When an agent (or human) runs `relay deposit`, the CLI:

1. Scans the working directory for deliverables
2. Prompts (or auto-detects) what was done, decisions made, open questions
3. Generates `manifest.json`, `CONTEXT.md`, `CLAUDE.md` from structured input
4. Computes `.cdiff` against the parent package
5. Zips everything into `context-package-{id}.relay.zip`
6. Uploads to Context Core
7. Returns a package ID and a shareable URL

For agent-driven deposits, this entire flow can be driven via the MCP tool without human prompting.

---

## 10. MCP Server Integration

### What the MCP Server Exposes

The `relay-mcp` server makes all Relay operations available as native Claude tools. This is the primary integration point for Claude instances.

```typescript
// Tools exposed by relay-mcp

relay_session_start({
  project_id: string,
  agent_description?: string
}) // → session_id, current project context summary

relay_pull_context({
  package_id?: string,   // specific package, or...
  query?: string,        // semantic search to find most relevant package
  mode: 'specific' | 'next' | 'relevant'
}) // → full context package contents (manifest + CONTEXT.md)

relay_deposit({
  title: string,
  description: string,
  decisions_made: string[],
  open_questions: string[],
  handoff_note: string,
  review_type: 'human' | 'agent' | 'none',
  deliverable_paths: string[],
  status: 'complete' | 'in_progress' | 'blocked'
}) // → package_id, cdiff summary

relay_get_project_state({
  project_id: string
}) // → high-level project summary, pending reviews, blocked items

relay_search_context({
  query: string,
  project_id?: string,
  limit?: number
}) // → array of relevant context package summaries

relay_orchestrate({
  project_id: string,
  focus?: string   // optional focus area for orchestrator
}) // → orchestrator synthesis report

relay_flag_for_review({
  package_id: string,
  review_type: 'human' | 'agent',
  note: string
}) // → confirmation

relay_get_open_questions({
  project_id: string,
  filter?: 'all' | 'unresolved' | 'mine'
}) // → list of open questions across project
```

### CLAUDE.md Auto-Configuration

Every project initialized with `relay init` gets a `CLAUDE.md` in the project root:

```markdown
# RELAY PROJECT CONTEXT

This project uses the Relay protocol for agentic coordination.

## Context Core
Endpoint: https://your-relay.vercel.app
Project ID: proj_abc

## On Session Start
1. Use the `relay_session_start` MCP tool to register this session
2. Use `relay_pull_context` with mode='relevant' to orient yourself
3. Check `relay_get_open_questions` for anything requiring your attention

## On Work Completion
Use `relay_deposit` to package your work before ending the session.
Include all decisions made, open questions discovered, and a clear handoff note.

## Key Principles
- Never assume context from memory alone — always pull from the Context Core
- Surface open questions explicitly rather than making silent assumptions  
- Every deposit should leave the next actor fully oriented

## Current Project Status
[Auto-populated by relay at session start]
```

---

## 11. InstantRecall Integration

### Background

InstantRecall is an existing personal project — a memory-as-a-service API connected to a vector database. It provides persistent memory across agent sessions via an API layer.

### Integration Strategy

**Do not replace InstantRecall. Extend it as the personal memory layer within Relay.**

InstantRecall solves the personal, cross-session memory problem. Relay solves the project-level, multi-actor context flow problem. They operate at different layers and are complementary.

Integration points:
- **Session start**: Relay `session_start` calls InstantRecall to hydrate personal/agent context (preferences, working style, past decisions relevant to this session) before pulling project context from the Context Core.
- **Session end**: Interesting session-level learnings can optionally be written back to InstantRecall (e.g., "learned that this team prefers X approach for auth decisions").
- **Orchestrator**: The Orchestrator can optionally query InstantRecall for long-term patterns across an agent's session history, supplementing the project graph.

### Rename Recommendation

Given the direction this is heading, consider renaming InstantRecall to something that fits the Relay ecosystem namespace — e.g., `relay-recall` or keeping it as a named sub-service: **Recall by Relay**.

### Priority Note for Future Agentic Work

**When starting any agentic work session referencing this project or the Relay system: call InstantRecall (Recall) FIRST to hydrate personal context, THEN connect to the Relay Context Core for project state. This two-layer orientation should be the standard session start protocol.**

---

## 12. Phase 1: Personal Multi-Instance Setup

### Goal

Get multiple Claude instances running on a single developer's machine all connected to a shared Context Core, reading and writing context packages across sessions. Validate the core loop:

**Session start → Pull context → Do work → Deposit package → Next session picks up seamlessly**

### Minimum Viable System

1. **Supabase project** with the schema defined in §16
2. **Vercel deployment** of the Relay API (minimal: deposit, pull, status endpoints)
3. **relay-cli** with: `init`, `session start`, `pull`, `deposit`, `status`
4. **relay-mcp** with: `relay_session_start`, `relay_pull_context`, `relay_deposit`
5. **CLAUDE.md** template that bootstraps each new Claude session into the system
6. **Master Orchestrator** (basic version): `relay orchestrate` produces a project digest

### Success Criteria for Phase 1

- A Claude instance can start a session, pull the most recent context package, and continue work without any human-provided orientation
- After depositing work, a fresh Claude instance on a different project opens can retrieve and meaningfully continue from that context
- The Orchestrator produces a synthesis that surfaces something non-obvious about the project state
- The developer feels the system is **reducing** cognitive overhead, not adding it

### Repo Structure

```
relay/
├── packages/
│   ├── cli/           # relay-cli (Node.js / TypeScript)
│   ├── mcp/           # relay-mcp server
│   ├── api/           # Vercel API routes
│   ├── core/          # Shared types, utils, context package builder
│   └── orchestrator/  # Master Orchestrator logic
├── supabase/
│   ├── migrations/    # All schema migrations
│   └── seed.sql       # Dev seed data
├── docs/
│   └── RELAY_SPEC.md  # This document
└── examples/
    └── personal-setup/ # Quick start for single-developer setup
```

---

## 13. Phase 2: Team Coordination Layer

### What Changes

- Multi-user authentication (Supabase Auth)
- Team and project membership management
- Human review queue (packages flagged `pending_review` surface in a review dashboard)
- Real-time status updates via Supabase subscriptions
- Agent identity management (each Claude instance gets a registered identity)
- Notification system (email / webhook for pending reviews, blocked items)

### Agent Identity

Each Claude instance that registers with Relay gets a persistent agent identity:
```json
{
  "agent_id": "agent_abc123",
  "display_name": "Claude @ MacBook-Pro / project-x",
  "registered_at": "...",
  "session_history": [...],
  "packages_deposited": 47,
  "packages_reviewed": 12
}
```

This lets the graph show not just *what* was done but *which agent instance* did it — useful for pattern analysis and for the Orchestrator.

### The Human Review Queue

A simple but critical feature: a view (CLI and eventually UI) that shows every package flagged for human review, sorted by:
- How long it's been waiting
- How many downstream packages are blocked by it
- The review_type priority set by the agent

Human runs `relay review list` and gets a prioritized queue. Reviews a package, approves or rejects with notes, which triggers the next agent to be notified.

---

## 14. Phase 3: Product / Frontend Vision

### The Relay Frontend

A Next.js application deployed on Vercel. The visual layer for the entire system.

**Core Views:**

**Graph View** — The work graph rendered as an interactive node graph. Each node is a context package, color-coded by status. Edges show dependencies and handoff directions. Click a node to open the context package detail. Filter by status, actor type, date range, tags.

**Review Queue** — The human checkpoint dashboard. All packages pending review, with the full context package inline. Approve, reject, comment without leaving the view.

**Orchestrator View** — The latest Orchestrator report, rendered as a project health dashboard. Open questions heatmap, blocked thread visualization, recommended next actions.

**Timeline View** — The project's context flow over time. See how work moved, where it accelerated, where it stalled.

**Package Detail** — Full context package viewer. CONTEXT.md rendered, manifest metadata, diff view, deliverables listed and downloadable, lineage chain visualized.

### The Enterprise Onboarding Story

This is the product insight that points toward a real business:

Large companies have a crushing onboarding problem. A new engineer joins a team and it takes weeks to become productive — not because they lack skill, but because context lives in people's heads, in old Slack threads, in undocumented decisions. The same problem now exists for AI agents being onboarded to codebases and projects.

Relay solves this structurally. If a project has been running on Relay from the start, a new participant — human or agent — can be fully oriented in minutes. The Orchestrator produces a tailored onboarding briefing from the graph. Context packages capture decisions as they happen rather than requiring archaeology afterward.

**The enterprise product motion:**
- Teams run Relay internally
- When a new engineer joins, they run `relay onboard` and get a personalized briefing
- When a new agent is spun up, it reads the CLAUDE.md and is immediately productive
- Management gets Orchestrator digests as a project health feed without requiring status meetings

This is a real problem with a real budget attached to it at companies of 500+ people.

---

## 15. Data Models

### Core Types (TypeScript)

```typescript
type PackageStatus = 
  | 'draft'
  | 'in_progress' 
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'complete'
  | 'blocked';

type ActorType = 'agent' | 'human';
type ReviewType = 'human' | 'agent' | 'none';

interface RelayManifest {
  relay_version: string;
  package_id: string;
  created_at: string;
  created_by: {
    type: ActorType;
    id: string;
    session_id: string;
  };
  title: string;
  description: string;
  status: PackageStatus;
  review_type: ReviewType;
  parent_package_id: string | null;
  child_package_ids: string[];
  dependencies: string[];
  tags: string[];
  project_id: string;
  deliverables: Deliverable[];
  open_questions: string[];
  decisions_made: string[];
  handoff_note: string;
  estimated_next_actor: ActorType;
  context_diff_ref: string;
}

interface ContextDiff {
  relay_version: string;
  diff_id: string;
  from_package: string | null;
  to_package: string;
  timestamp: string;
  actor: { type: ActorType; id: string };
  changes: {
    status?: { from: PackageStatus; to: PackageStatus };
    open_questions?: { added: string[]; resolved: string[] };
    decisions_made?: { added: string[] };
    deliverables?: { added: string[]; removed: string[]; modified: string[] };
    context_summary_delta: string;
  };
}

interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  owner_id: string;
  members: ProjectMember[];
  settings: ProjectSettings;
}

interface Session {
  id: string;
  project_id: string;
  actor: { type: ActorType; id: string };
  started_at: string;
  ended_at: string | null;
  packages_pulled: string[];
  packages_deposited: string[];
}
```

---

## 16. Supabase Schema

```sql
-- Enable pgvector
create extension if not exists vector;

-- Projects
create table projects (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  description text,
  owner_id text not null,
  settings jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Context Packages (metadata only — zip stored in Supabase Storage)
create table context_packages (
  id text primary key,
  project_id text references projects(id),
  title text not null,
  description text,
  status text not null default 'draft',
  review_type text not null default 'none',
  parent_package_id text references context_packages(id),
  created_by_type text not null,  -- 'agent' | 'human'
  created_by_id text not null,
  session_id text,
  tags text[] default '{}',
  open_questions jsonb default '[]',
  decisions_made jsonb default '[]',
  handoff_note text,
  estimated_next_actor text,
  deliverables jsonb default '[]',
  storage_path text,              -- path to .relay.zip in Supabase Storage
  manifest jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Package dependencies (many-to-many)
create table package_dependencies (
  package_id text references context_packages(id),
  depends_on_id text references context_packages(id),
  primary key (package_id, depends_on_id)
);

-- Context diffs
create table context_diffs (
  id text primary key,
  from_package_id text references context_packages(id),
  to_package_id text references context_packages(id) not null,
  actor_type text not null,
  actor_id text not null,
  changes jsonb not null,
  created_at timestamptz default now()
);

-- Embeddings for semantic search
create table package_embeddings (
  id text primary key default gen_random_uuid()::text,
  package_id text references context_packages(id),
  content_type text not null,  -- 'context_md' | 'decision' | 'question' | 'handoff'
  content text not null,
  embedding vector(1536),      -- OpenAI/Claude embedding dimension
  created_at timestamptz default now()
);

-- Semantic search function
create or replace function search_context(
  query_embedding vector(1536),
  project_filter text,
  match_count int default 10
)
returns table (
  package_id text,
  content_type text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    package_id,
    content_type,
    content,
    1 - (embedding <=> query_embedding) as similarity
  from package_embeddings pe
  join context_packages cp on cp.id = pe.package_id
  where cp.project_id = project_filter
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Sessions
create table sessions (
  id text primary key,
  project_id text references projects(id),
  actor_type text not null,
  actor_id text not null,
  packages_pulled text[] default '{}',
  packages_deposited text[] default '{}',
  started_at timestamptz default now(),
  ended_at timestamptz
);

-- Orchestrator reports
create table orchestrator_reports (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id),
  report_type text not null,  -- 'digest' | 'health' | 'onboarding' | 'anomaly'
  content text not null,
  metadata jsonb default '{}',
  triggered_by text,
  created_at timestamptz default now()
);

-- Indexes
create index on context_packages(project_id, status);
create index on context_packages(parent_package_id);
create index on package_embeddings using ivfflat (embedding vector_cosine_ops);
```

---

## 17. API Contracts

### Base URL: `https://your-relay.vercel.app/api/v1`

```
POST   /packages                     # Deposit a new context package
GET    /packages/:id                 # Get package metadata
GET    /packages/:id/download        # Download .relay.zip
GET    /packages/:id/diff            # Get .cdiff for package
PATCH  /packages/:id/status          # Update package status (review, approve, reject)

GET    /projects/:id/packages        # List packages for project
GET    /projects/:id/graph           # Get full graph (nodes + edges)
GET    /projects/:id/review-queue    # Get pending review packages
GET    /projects/:id/open-questions  # Get all unresolved questions

POST   /search                       # Semantic search across project context
POST   /sessions                     # Start a session
PATCH  /sessions/:id                 # End/update a session

POST   /orchestrate                  # Trigger orchestrator for project
GET    /orchestrate/reports/:id      # Get orchestrator report
```

---

## 18. Future-Proofing & Standards Philosophy

### Design for Openness

Relay should aspire to be an **open protocol** — not a closed product. The `.relay.zip` format and `.cdiff` spec should be documented publicly and stable. Any tool, any agent framework, any IDE should be able to read and write Relay packages.

This mirrors what git did for version control — it became infrastructure because it was simple, open, and universal. Relay's context packages should aim for the same.

### Versioning

Every manifest includes `relay_version`. Every `.cdiff` includes `relay_version`. The API returns `relay_version` in all responses. From day one, version all the things.

### Agent Framework Agnosticism

The MCP server is the Claude-native integration, but Relay should not be Claude-only. A LangChain tool, a CrewAI integration, a raw HTTP client — all should work against the same API. The protocol is the product.

### Self-Hostable

The Supabase + Vercel stack is the hosted default, but the architecture should be containerizable. A Dockerfile and `docker-compose.yml` for self-hosting should be included from Phase 1. Enterprise customers will require it.

### The Context Package as a Standard

Long term, the `.relay.zip` context package format should be proposed as a community standard for agentic handoffs — the equivalent of what `.json` did for data interchange. Simple, readable, portable.

---

## 19. Open Questions & Design Decisions Log

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Fork Git for diffs vs. custom .cdiff format? | Decided | Custom .cdiff — purpose-built for context, not code. Git would add C dependency and wrong abstraction level. |
| 2 | Vector DB: separate service vs. pgvector? | Decided | pgvector — no additional infrastructure, same Postgres, avoids sync problem. |
| 3 | Package format: zip vs. directory vs. custom? | Decided | .relay.zip — universal, self-describing, agent-friendly, lightweight. |
| 4 | InstantRecall: replace or integrate? | Decided | Integrate — Recall is personal memory layer, Relay is project context layer. Complementary. |
| 5 | Lattice: standalone vs. Relay producer? | Decided | Relay producer — Lattice deposits swarm research as bulk context packages. Relay becomes its coordination backbone. |
| 6 | AgenticDashboard/External Systems: rewrite vs. re-backend? | Decided | Re-backend — keep UI/UX and agent concepts, replace coordination layer with Relay Context Core. |
| 7 | Rules Engine: where does it live? | Decided | Context Core (server-side) — rules are project/node config, evaluated at event time by the API. Not client-side logic. |
| 8 | Embedding model: Claude vs. OpenAI? | Open | Default to OpenAI text-embedding-3-small (proven, cheap, 1536 dim). Claude embedding API as option. |
| 9 | Auth: Supabase Auth vs. custom? | Open | Default to Supabase Auth for Phase 1 simplicity. May need custom for enterprise SSO later. |
| 10 | Real-time: WebSocket vs. polling? | Open | Supabase Realtime subscriptions for Phase 1. Evaluate at scale. |
| 11 | Package size limits? | Open | TBD based on Supabase Storage pricing. Likely 50MB per package initially. |
| 12 | Orchestrator: scheduled vs. event-driven? | Open | Event-driven preferred (trigger on review queue depth, blocker duration). Scheduled as fallback. |
| 13 | CLI: interactive prompts vs. flags only? | Open | Interactive for `relay deposit` (to guide agents). Flags for all others (scriptable). |
| 14 | Rules Engine: how are voice personalities defined? | Open | Likely a JSON personality profile registered per-project. Needs schema design. |
| 15 | Lattice swarm results: one package per agent or aggregate? | Open | Leaning toward one package per agent (preserves diversity of output) + one Orchestrator synthesis package. |

---

## 20. The Lattice Integration — Swarm Research as a Relay Producer

### What The Lattice Is

The Lattice is a swarm research engine — it deploys armies of subagents with distinct personalities to research a topic from different angles, producing divergent outputs that collectively produce richer R&D results than any single agent could. It's an intentionally opinionated, multi-perspective research machine.

### The Problem It Currently Has

Without Relay, the Lattice's outputs are ephemeral — each swarm run produces results that live in that session and nowhere else. There's no persistent record of what was researched, what each agent found, how results related to each other, or how they should inform future work. The swarm fires and the context evaporates.

### The Integration Vision

The Lattice becomes a **Relay producer** — a first-class actor that deposits context packages into the Context Core. Every swarm run becomes a cluster of context packages in the project graph, semantically searchable and available to every subsequent agent session.

**Per-agent packages:** Each Lattice subagent deposits its own context package on completion — preserving the personality-driven diversity of output. A skeptic agent's package reads differently from an optimist agent's package. That difference is the value.

**Synthesis package:** After all subagents complete, the Lattice Orchestrator (or Relay's Master Orchestrator) produces a synthesis package that identifies convergence, contradiction, and the most interesting tensions across the swarm's output.

**Integration points:**

```
Lattice Swarm Run
  ├── Agent [Skeptic]     → relay deposit → pkg_skeptic_001
  ├── Agent [Optimist]    → relay deposit → pkg_optimist_001
  ├── Agent [Technical]   → relay deposit → pkg_technical_001
  ├── Agent [Market]      → relay deposit → pkg_market_001
  └── Lattice Orchestrator → relay deposit → pkg_synthesis_001
                                              (parent: all above)
```

The synthesis package becomes a rich, structured artifact that future agents can pull as a starting point for any follow-on work.

### The Rules Engine Hook

A Lattice completion can trigger a Relay rule — for example:
- When `lattice_swarm_complete` fires → trigger Orchestrator synthesis
- When synthesis package is deposited → send desktop toast + voice summary to user
- When a Lattice run surfaces a blocker → auto-flag for human review

This is the first example of Relay acting as the connective tissue between specialized tools — not replacing the Lattice, but giving it memory, lineage, and reactivity.

### Package Type Extension

The manifest schema should be extended with a `package_type` field:

```json
{
  "package_type": "lattice_agent_output",
  "lattice_metadata": {
    "run_id": "lattice_run_abc",
    "agent_personality": "skeptic",
    "topic": "AI-native project coordination market sizing",
    "swarm_size": 5,
    "agent_index": 2
  }
}
```

Standard package types:
- `standard` — default human or agent work unit
- `lattice_agent_output` — single Lattice agent result
- `lattice_synthesis` — Lattice swarm synthesis
- `orchestrator_report` — Master Orchestrator output
- `human_review` — human decision/review result
- `onboarding_briefing` — generated orientation for new participant

---

## 21. AgenticDashboard / External Systems — Existing System Unification

### What These Systems Are

**External Systems** is a modified Claude Code CLI setup with an orchestrator, a basic Kanban-style coordination layer, subagents with distinct roles, voice-to-text per agent, and basic handoffs between them. It's conceptually rich but coordination-wise held together with custom glue code.

**AgenticDashboard** is the frontend strapped into External Systems — a visual layer for monitoring agent activity, orchestrator state, and task flow. It exists but the backend it's watching is the bespoke External Systems system.

### The Problem

External Systems's coordination layer is custom and brittle. Handoffs are partially implemented. The Kanban system has the same fundamental limitations described in §2. Context evaporates between sessions. Adding new agent types or roles requires navigating a maze of custom coordination logic. The system works, but each improvement requires understanding the whole system before touching any part of it.

### The Unification Strategy

**Don't rebuild — re-backend.**

External Systems and AgenticDashboard have real value in their concepts, UI patterns, and agent role definitions. The right move is to strip out the custom coordination logic and replace it with Relay as the backend, while keeping everything else intact.

**What stays:**
- Agent role definitions and personalities
- Voice-to-text per agent
- The AgenticDashboard UI (it becomes a Relay frontend consumer)
- The orchestrator concept (it becomes a Relay Orchestrator client)

**What gets replaced:**
- Custom Kanban → Relay work graph
- Bespoke handoff logic → Relay context packages + deposit/pull protocol
- Session state management → Relay Context Core sessions
- Custom inter-agent communication → Relay rules engine + package flow

### The Agent-Agnostic Core Principle

This is the architectural insight worth enshrining: **the Context Core is the brain; the agent framework is the hands.**

External Systems agents, Claude Code CLI, future LangChain agents, future CrewAI setups — all of them should be able to connect to the same Relay Context Core and participate in the same work graph. The agent framework choice becomes an implementation detail, not a coordination constraint.

This means the Core should never have assumptions about:
- Which model is running the agent
- Which CLI or framework is wrapping it
- What interface the human is using

It should only care about: **which session is active, what context was pulled, what package was deposited, what rules apply.**

### AgenticDashboard as Relay Frontend (Near-term)

AgenticDashboard can be connected to the Relay API directly — it stops watching External Systems's internal state and starts watching the Context Core. This immediately gives it:
- A real work graph to visualize (not a Kanban board)
- Accurate session state across all agent instances
- Package lineage and diff views
- The review queue
- Orchestrator report feeds

This is actually the fastest path to a working Relay frontend — reuse what already exists rather than building the Phase 3 frontend from scratch.

---

## 22. The Relay Rules Engine — Reactive Automation Layer

### The Problem Being Solved

As agentic systems grow, the coordination instructions become a maze. "When agent A finishes, tell agent B to start, but only if the human approved, and if it was a Lattice run also do X, and send a notification if it's after hours..." This logic ends up scattered across agent prompts, custom scripts, and undocumented conventions. It's fragile and invisible.

The Rules Engine makes this logic **explicit, modular, and inspectable** — living in the Context Core as first-class configuration, not buried in agent prompts.

### Core Concept

A **Relay Rule** is a declarative automation: when a specific event occurs at a specific node or within a specific scope, execute a defined set of actions. Rules are attached to projects, specific nodes, or node types. They evaluate server-side when events fire.

Think: GitHub Actions, but for the agentic work graph.

### Event Types

```typescript
type RelayEvent =
  | 'package.deposited'          // Any package deposited
  | 'package.status_changed'     // Status transition (in_progress → pending_review, etc.)
  | 'package.review_requested'   // Review flag set
  | 'package.approved'           // Human or agent approved a review
  | 'package.rejected'           // Review rejected
  | 'package.blocked'            // Package entered blocked state
  | 'session.started'            // Agent or human session began
  | 'session.ended'              // Session concluded
  | 'question.surfaced'          // New open question added to a package
  | 'question.resolved'          // Open question marked resolved
  | 'orchestrator.report_ready'  // Orchestrator completed a run
  | 'lattice.swarm_complete'     // All Lattice agents finished a run
  | 'lattice.agent_complete'     // Single Lattice agent finished
  | 'review_queue.threshold'     // N packages in review queue
  | 'blocker.duration_exceeded'; // Blocker has been open > X hours
```

### Action Types

```typescript
type RelayAction =
  | 'voice.speak'           // Trigger voice output with message + personality
  | 'desktop.toast'         // Send desktop notification/toast to user
  | 'webhook.call'          // POST to any URL with event payload
  | 'agent.spawn'           // Spin up a new agent session with context
  | 'package.auto_approve'  // Auto-approve if actor matches trust config
  | 'orchestrator.trigger'  // Run Orchestrator against project
  | 'lattice.spawn'         // Trigger a new Lattice swarm run
  | 'relay.message'         // Send a message to a specific agent session
  | 'human.notify'          // Queue a human notification (email, SMS, etc.)
  | 'package.tag'           // Auto-apply tags to the triggering package
  | 'session.context_push'; // Push additional context into an active session
```

### Rule Schema

```json
{
  "rule_id": "rule_abc123",
  "project_id": "proj_xyz",
  "name": "Voice summary on Lattice completion",
  "description": "When a Lattice swarm finishes, speak a digest and notify desktop",
  "enabled": true,
  "scope": {
    "type": "project",        // 'project' | 'node' | 'node_type' | 'actor_type'
    "id": "proj_xyz"
  },
  "trigger": {
    "event": "lattice.swarm_complete",
    "conditions": [
      { "field": "swarm_size", "operator": "gte", "value": 3 }
    ]
  },
  "actions": [
    {
      "type": "orchestrator.trigger",
      "config": {
        "focus": "synthesize swarm outputs"
      }
    },
    {
      "type": "desktop.toast",
      "config": {
        "title": "Lattice Run Complete",
        "message": "{{swarm_size}} agents finished. Orchestrator synthesis in progress.",
        "icon": "lattice"
      }
    },
    {
      "type": "voice.speak",
      "config": {
        "personality": "concise-analyst",
        "template": "Lattice run complete. {{agent_count}} perspectives collected on {{topic}}. Synthesis is running — I'll brief you when it's ready."
      }
    }
  ],
  "created_at": "2025-04-03T12:00:00Z",
  "created_by": "user_abc"
}
```

### Voice Personality Profiles

Voice output actions reference a personality profile — a named configuration that defines tone, verbosity, and communication style. Profiles are registered per-project or globally:

```json
{
  "personality_id": "concise-analyst",
  "name": "Concise Analyst",
  "description": "Terse, factual, no filler. Leads with the point.",
  "voice_config": {
    "provider": "elevenlabs",
    "voice_id": "...",
    "speed": 1.1,
    "stability": 0.75
  },
  "message_style": {
    "max_sentences": 3,
    "tone": "neutral",
    "include_next_action": true
  }
}
```

Other example personalities: `cheerful-collaborator`, `critical-reviewer`, `executive-briefer`, `developer-standup`. These map directly to External Systems's existing agent personality concepts — so the migration is natural.

### Node-Level Rules

Rules can also attach to specific nodes in the graph — meaning specific package IDs or package types at specific positions in a workflow:

```json
{
  "scope": {
    "type": "node",
    "id": "pkg_security_review_checkpoint"
  },
  "trigger": { "event": "package.deposited" },
  "actions": [
    {
      "type": "voice.speak",
      "config": {
        "personality": "critical-reviewer",
        "template": "Security checkpoint reached. Package {{package_id}} needs human review before we proceed. Opening review queue."
      }
    },
    {
      "type": "desktop.toast",
      "config": {
        "title": "🔐 Security Review Required",
        "message": "{{package_title}} — your attention needed before agents continue.",
        "action": "open_review_queue"
      }
    }
  ]
}
```

This is the modular, non-maze version of coordination logic. Each node's behavior is self-contained and inspectable.

### Rules Engine Architecture

Rules are evaluated **server-side at event time** by the Relay API. Flow:

```
Event fires (e.g., package deposited)
  → API emits RelayEvent to Rules Engine
  → Rules Engine queries matching rules for project/node/event
  → For each matching rule, evaluate conditions
  → For each passing rule, execute actions in order
  → Actions that call external systems (voice, desktop) go via
    the relay-cli bridge running locally on the user's machine
  → Results logged to rule_executions table
```

The **relay-cli bridge** is a lightweight local process that the CLI runs in the background — it maintains a WebSocket connection to the Context Core and acts as the local executor for actions that require local access (voice output, desktop notifications, spawning new Claude sessions).

```bash
relay bridge start    # Start the local bridge process
relay bridge status   # Check bridge connection
relay bridge stop     # Stop bridge
```

This keeps sensitive local operations (voice, system notifications, spawning processes) off the server while still making them triggerable from cloud-side rules.

### Supabase Schema Additions for Rules Engine

```sql
-- Personality profiles
create table voice_personalities (
  id text primary key,
  project_id text references projects(id),
  name text not null,
  description text,
  config jsonb not null,
  is_global boolean default false,
  created_at timestamptz default now()
);

-- Rules
create table relay_rules (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id),
  name text not null,
  description text,
  enabled boolean default true,
  scope jsonb not null,         -- { type, id }
  trigger jsonb not null,       -- { event, conditions }
  actions jsonb not null,       -- array of { type, config }
  created_by text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Rule execution log
create table rule_executions (
  id text primary key default gen_random_uuid()::text,
  rule_id text references relay_rules(id),
  trigger_event text not null,
  trigger_payload jsonb,
  actions_executed jsonb,
  status text not null,         -- 'success' | 'partial' | 'failed'
  error text,
  executed_at timestamptz default now()
);

-- Indexes
create index on relay_rules(project_id, enabled);
create index on rule_executions(rule_id, executed_at desc);
```

### API Additions for Rules Engine

```
POST   /rules                    # Create a rule
GET    /rules?project_id=...     # List rules for project
PATCH  /rules/:id                # Update rule
DELETE /rules/:id                # Delete rule
GET    /rules/:id/executions     # Get execution history for a rule

POST   /personalities            # Register a voice personality
GET    /personalities?project_id=...  # List personalities

GET    /bridge/events            # WebSocket endpoint for CLI bridge
```

### Why This Matters for the Product Vision

The Rules Engine is the feature that turns Relay from a coordination protocol into a **platform**. It's the moment where:

- A developer can express "how my workflow should feel" declaratively
- Teams can encode their coordination conventions as inspectable config (not tribal knowledge)
- Enterprises can define compliance rules directly in the graph ("any package touching payments must have human review before agent handoff")
- Third-party integrations become trivial (webhook action = unlimited extensibility)

It's also the feature that makes External Systems's multi-modal, voice-driven, personality-rich agent experience portable to any Relay-connected setup — because the voice and personality logic lives in the Core, not inside External Systems's custom code.

---

---

## 23. InstantRecall Deep Analysis — Architecture, Assets & Relay Integration Map

### Background & Purpose

This section documents a comprehensive code-level analysis of the **InstantRecall.ai** codebase (`X:\DevExperiments\instantrecallai`), a production-grade memory-as-a-service SaaS platform. InstantRecall is the predecessor and proving ground for many patterns Relay will use. This analysis identifies what can be lifted directly, what needs adaptation, and what maps to Relay's Context Core concept.

### 23.1 InstantRecall Architecture Overview

**Stack:** Next.js 15.5 (App Router) + React 19 + TypeScript 5 + Supabase (Postgres) + Pinecone (vectors) + Stripe (billing)  
**Deployment:** Vercel  
**Auth:** NextAuth.js 4.24 with JWT strategy (30-day sessions)  
**Styling:** Tailwind CSS 4, custom glassmorphic design system  

```
instantrecallai/
├── app/                              # Next.js App Router
│   ├── api/                          # 10 API route groups
│   │   ├── auth/[...nextauth]/       # NextAuth handler
│   │   ├── keys/                     # API key management (CRUD)
│   │   ├── memory/query/             # Core memory broker endpoint
│   │   ├── settings/                 # User settings CRUD
│   │   ├── stripe/{checkout,portal,webhook}  # Billing
│   │   ├── subscription/            # Plan status
│   │   ├── usage/                   # Monthly metering
│   │   └── prompt-history/          # Audit trail
│   ├── dashboard/                   # Main user UI
│   ├── login/                       # Auth page
│   ├── docs/, how-it-works/         # Marketing/docs pages
│   └── layout.tsx, providers.tsx     # Root layout + SessionProvider
├── src/
│   ├── lib/                          # Business logic (10 modules)
│   │   ├── memory.ts                 # RAG orchestration (core)
│   │   ├── pinecone.ts               # Vector storage operations
│   │   ├── openai.ts                 # Embeddings + summarization
│   │   ├── claude.ts                 # Anthropic summarization
│   │   ├── grok.ts                   # xAI summarization
│   │   ├── settings.ts               # User settings helpers
│   │   ├── encryption.ts             # AES-256-GCM key encryption
│   │   ├── stripe.ts                 # Billing + usage metering
│   │   ├── auth.ts                   # NextAuth config
│   │   └── supabase.ts               # DB client initialization
│   ├── components/                   # 15+ React components
│   └── db/                           # SQL schema migrations (7 files)
└── types/                            # NextAuth type augmentation
```

### 23.2 Supabase Schema — Complete Table Inventory

#### Tables & Key Columns

| Table | Purpose | Key Columns | RLS |
|-------|---------|-------------|-----|
| `users` | User accounts | id (UUID), email (UNIQUE), name, email_verified, image | Enabled — own data only |
| `accounts` | OAuth providers (NextAuth) | user_id (FK), provider, provider_account_id, tokens | Enabled |
| `sessions` | Session tokens (NextAuth) | session_token (UNIQUE), user_id (FK), expires | Enabled |
| `verification_tokens` | Email verification | identifier, token, expires | Enabled |
| `api_keys` | Encrypted API credentials | user_id (FK), key_type, provider, encrypted_key, key_name, is_active | **Disabled** (auth in API layer) |
| `user_settings` | Memory & summarization config | user_id (FK, UNIQUE), summarization_*, temperature, max_tokens, top_k, score_threshold | Enabled |
| `prompt_history` | Audit trail for prompt changes | user_id, prompt_text, settings_snapshot (JSONB) | Enabled |
| `subscriptions` | Stripe billing | stripe_customer_id, stripe_subscription_id, plan_id, status, current_period_end | Enabled |
| `usage_metrics` | Monthly query metering | user_id, month (YYYY-MM), query_count | Enabled |

#### Key Database Functions

| Function | Type | Purpose |
|----------|------|---------|
| `get_user_settings(uuid)` | SECURITY DEFINER | Lazy-creates default settings, returns user config |
| `increment_user_usage(uuid)` | SECURITY DEFINER | UPSERT monthly query counter (concurrent-safe) |
| `get_current_usage(uuid)` | SECURITY DEFINER | Returns current month query count |
| `save_prompt_history()` | TRIGGER | Auto-snapshots settings to prompt_history on custom_prompt change |

#### Constraints & Validation (in DB)

- `api_keys`: UNIQUE(user_id, key_type, provider), CHECK provider IN ('openai','claude','grok','pinecone','anthropic'), CHECK key_type IN ('summarization','vector_storage')
- `user_settings`: CHECK constraints on temperature (0-1), max_tokens (1-500), top_k (1-20), score_threshold (0-1)
- `user_settings.summarization_model`: CHECK against enumerated list of OpenAI, Claude, and Grok models
- `usage_metrics`: UNIQUE(user_id, month)

### 23.3 RAG / Vector Implementation

#### Embedding Pipeline

- **Model:** OpenAI `text-embedding-3-small` (centralized — InstantRecall.ai's own key covers all users)
- **Dimensions:** 1536
- **Library:** `openai` v6.2.0
- **Cost:** ~$0.0001/1K tokens

#### Vector Storage

- **Provider:** Pinecone (BYO — users supply their own API key)
- **Library:** `@pinecone-database/pinecone` v6.1.2
- **Index:** `instantrecall-memories`
- **Metric:** Cosine similarity
- **Namespace isolation:** By `sessionId`

**Critical difference from Relay:** InstantRecall uses **external Pinecone** for vectors, not pgvector. Relay's spec calls for **Supabase pgvector** (in-house). This is a deliberate divergence — Relay wants vectors co-located with metadata for transactional consistency and simpler ops.

#### RAG Pipeline (`processMemoryQuery()` in `src/lib/memory.ts`)

```
1. getUserSettings(userId)           → topK, scoreThreshold, summarization config
2. generateEmbedding(message)        → 1536-dim vector via OpenAI
3. retrieveContext(embedding, topK)  → Pinecone cosine search, filtered by sessionId
4. Filter by scoreThreshold          → Drop low-relevance results
5. formatContext(memories)           → Build "Previous conversation context:" string
6. storeMemory(message, embedding)   → Upsert into Pinecone
7. Optional: summarize(context)      → LLM call via OpenAI/Claude/Grok
8. Return: { context, messageId, retrievedCount, summary }
```

#### Chunking Strategy

**None** — messages stored as atomic units. No sub-document splitting. This works for conversational memory but would not work for Relay's CONTEXT.md files which can be multi-page. **Relay needs chunking** (by section, paragraph, or sliding window).

#### Retrieval Configuration (per user)

| Setting | Default | Range | Purpose |
|---------|---------|-------|---------|
| `topK` | 5 | 1-20 | Number of similar results to retrieve |
| `scoreThreshold` | 0.0 | 0-1 | Minimum cosine similarity to include |

### 23.4 API Routes — Complete Endpoint Map

| Method | Path | Purpose | Auth | Rate Limit |
|--------|------|---------|------|------------|
| GET/POST | `/api/auth/[...nextauth]` | NextAuth session management | None (handler) | — |
| POST | `/api/keys` | Save/update encrypted API key | Session | — |
| GET | `/api/keys` | List user's keys (metadata only) | Session | — |
| DELETE | `/api/keys` | Remove API key | Session | — |
| POST | `/api/memory/query` | **Core memory broker** | Session | 100/mo free, 10K/mo pro |
| GET | `/api/settings` | Get user settings | Session | — |
| POST | `/api/settings` | Update user settings | Session | — |
| GET | `/api/prompt-history` | Fetch prompt change audit trail | Session | — |
| POST | `/api/stripe/checkout` | Create Stripe checkout session | Session | — |
| POST | `/api/stripe/portal` | Create billing portal session | Session | — |
| POST | `/api/stripe/webhook` | Handle Stripe webhook events | Signature | — |
| GET | `/api/subscription` | Get user subscription status | Session | — |
| GET | `/api/usage` | Get monthly usage stats | Session | — |

#### Auth Pattern (every protected route)

```typescript
const session = await getServerSession(authOptions);
if (!session?.user?.id) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

### 23.5 Auth & Subscription System

#### Authentication

- **Provider:** NextAuth.js with CredentialsProvider (email-only, no password in MVP)
- **Strategy:** JWT with 30-day max age
- **Auto-creation:** Users auto-created on first sign-in
- **Session access:** `getServerSession(authOptions)` server-side; `useSession()` client-side
- **Supabase role split:** `supabaseAdmin` (service_role, server-only) and `supabaseClient` (anon, client-side)

#### Stripe Billing

- **Plans:** Free (100 queries/month), Pro (10,000 queries/month)
- **Checkout:** Stripe hosted checkout with redirect back to `/dashboard`
- **Webhook events:** `customer.subscription.created/updated/deleted`, `invoice.payment_succeeded/failed`
- **Usage metering:** `increment_user_usage()` called after each successful memory query
- **Lazy Stripe client:** Created on first access, not at module load (builds succeed without STRIPE_SECRET_KEY)

### 23.6 Encryption & Security

#### API Key Encryption

- **Algorithm:** AES-256-GCM with authenticated encryption
- **IV:** 16 bytes random per encryption
- **Auth tag:** 16 bytes for GCM authentication
- **Storage format:** Base64(IV + ciphertext + authTag)
- **Key requirement:** `ENCRYPTION_KEY` env var, 32 bytes hex-encoded
- **Functions:** `encryptAPIKey(plainText)`, `decryptAPIKey(cipherText)`, `maskAPIKey(key)` (shows first 4 + last 4)

**Relay reuse:** This encryption pattern can be lifted directly for any encrypted-at-rest fields in the Context Core (e.g., API keys for embedding providers, webhook secrets).

### 23.7 Frontend & Component Library

#### Design System

- **Theme:** Dark-first glassmorphic (background #0B0B0D, glass panels with `backdrop-blur-md`)
- **Color palette:** Indigo (#8B5CF6) → Pink (#EC4899) → Cyan (#06B6D4) gradient
- **Font:** Inter (Google Fonts)

#### Reusable Components (`src/components/`)

| Component | Description | Relay Reuse Potential |
|-----------|-------------|---------------------|
| `GlassPanel` | Glassmorphic container with backdrop blur, hover glow, fade-in | Direct lift for Phase 3 frontend |
| `GradientHeading` | Rainbow gradient text, polymorphic `as` prop | Direct lift |
| `GradientBackground` | Fixed backdrop with 8 radial gradient blobs + noise texture | Direct lift |
| `Button` | Variants (primary/secondary/ghost), loading spinner, gradient | Direct lift |
| `Input` | Glass-styled, gradient border on focus, error display | Direct lift |
| `FadeInSection` | Scroll-triggered fade-in via IntersectionObserver | Direct lift |
| `SubscriptionPanel` | Plan info, usage bar, upgrade CTA | Pattern reference for Relay billing |
| `AddKeyModal` | Modal for BYO API key entry with provider selection | Pattern reference |
| `MobileMenu` | Hamburger with glass sidebar | Direct lift |
| `TestPlayground` | Interactive API testing interface | Pattern reference for Relay testing |
| `CostCalculator` | Monthly cost estimator | Adapt for Relay pricing |

### 23.8 What Maps to Relay's Context Core

| InstantRecall Concept | Relay Context Core Equivalent | Notes |
|----------------------|-------------------------------|-------|
| Memory (message + embedding) | Context Package (CONTEXT.md + embedding) | Relay packages are richer — include manifest, cdiff, deliverables |
| Session (sessionId) | Relay Session (session table) | InstantRecall sessions are implicit (just a filter key). Relay sessions are first-class with lifecycle |
| Memory retrieval (cosine search) | `search_context()` pgvector function | Same embedding model (text-embedding-3-small, 1536 dims), different storage (pgvector vs Pinecone) |
| Summarization | Orchestrator synthesis | InstantRecall summarizes individual message context. Relay synthesizes across the entire project graph |
| User settings | Project settings | Per-user in InstantRecall → per-project in Relay |
| Usage metering | Not in Phase 1 scope | But the UPSERT metering pattern is reusable |
| API key management | Relay actor credentials | Same encryption pattern applicable |

### 23.9 Directly Liftable Code

These files can be copied and adapted with minimal changes:

| File | What It Provides | Adaptation Needed |
|------|-----------------|-------------------|
| `src/lib/encryption.ts` | AES-256-GCM encrypt/decrypt | None — drop-in reusable |
| `src/lib/supabase.ts` | Dual client initialization (admin + anon) | Update env var names to `RELAY_SUPABASE_*` |
| `src/lib/openai.ts` (embedding functions) | `generateEmbedding()` with text-embedding-3-small | Wrap in `@relay/core` embedding module |
| `src/db/usage-functions.sql` | `increment_user_usage()`, `get_current_usage()` | Adapt for Relay package deposit counting |
| `src/components/GlassPanel.tsx` | Glass container component | Move to `@tensorpunk/ui` |
| `src/components/GradientHeading.tsx` | Gradient text component | Move to `@tensorpunk/ui` |
| `src/components/GradientBackground.tsx` | Backdrop component | Move to `@tensorpunk/ui` |
| `src/components/Button.tsx` | Button variants | Move to `@tensorpunk/ui` |
| `src/components/Input.tsx` | Glass input | Move to `@tensorpunk/ui` |
| `src/components/FadeInSection.tsx` | Scroll animation | Move to `@tensorpunk/ui` |
| Auth pattern (session check) | `getServerSession()` + 401 guard | Same pattern for Relay API routes (Phase 2 multi-user) |

### 23.10 Patterns Worth Adopting

1. **Multi-provider abstraction** — InstantRecall supports OpenAI, Claude, and Grok for summarization via a `summarization_provider` field that routes to the correct client. Relay's Orchestrator should adopt this pattern for flexibility in synthesis model selection.

2. **Lazy client initialization** — Stripe client created on first use, not at import. Prevents build failures when optional env vars are missing. Apply to any optional Relay service integration.

3. **UPSERT metering** — `increment_user_usage()` uses `ON CONFLICT DO UPDATE SET query_count = query_count + 1`. Concurrent-safe, no race conditions. Lift directly for Relay deposit counting.

4. **Audit trail via triggers** — `save_prompt_history()` trigger auto-captures settings snapshots to a history table when the custom_prompt field changes. Apply to Relay for package status transitions — auto-log who changed what and when.

5. **Constraint-based validation** — Business rules enforced at the DB level via CHECK constraints (not just app-level validation). Relay should do the same for package status transitions, actor types, etc.

6. **Dual Supabase client pattern** — `supabaseAdmin` (service_role, bypasses RLS) for server-side operations + `supabaseClient` (anon, respects RLS) for client-side. Relay should use the same split.

7. **Service role bypass with explicit GRANT** — When RLS policies don't work cleanly with third-party auth (NextAuth), the pattern of disabling RLS on specific tables and handling auth in the API layer is pragmatic. Document this decision explicitly when used.

### 23.11 Key Architectural Differences (InstantRecall vs Relay)

| Dimension | InstantRecall | Relay |
|-----------|--------------|-------|
| **Scope** | Personal memory for chatbots | Multi-actor project context flow |
| **Vector storage** | External Pinecone (BYO) | Supabase pgvector (co-located) |
| **Chunking** | None (atomic messages) | Required (CONTEXT.md sections, decisions, questions) |
| **Context unit** | Single message embedding | Context Package (manifest + CONTEXT.md + cdiff + deliverables) |
| **Retrieval** | Message-level cosine search | Multi-content-type search (context_md, decision, question, handoff) |
| **Auth (Phase 1)** | NextAuth + JWT | API key auth (single developer) |
| **Auth (Phase 2)** | N/A | Supabase Auth + team management |
| **Session model** | Implicit (filter key) | First-class entity with lifecycle events |
| **Summarization** | Per-message, optional | Per-project synthesis via Orchestrator |
| **Graph structure** | Flat (no hierarchy) | DAG with parent/child packages + dependencies |
| **Billing** | Stripe per-query metering | Not in Phase 1 scope |

### 23.12 Integration Recommendations

#### Phase 1: Shared Embedding Infrastructure

Both InstantRecall and Relay use `text-embedding-3-small` at 1536 dimensions. Extract the embedding generation code into a shared module that both can consume:

```typescript
// @relay/core or shared util
export async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  // OpenAI text-embedding-3-small, 1536 dims
  // Currently duplicated in InstantRecall's src/lib/openai.ts
}
```

#### Phase 2: InstantRecall as Personal Memory Layer

Per RELAY_SPEC.md §11, InstantRecall remains the **personal, cross-session memory layer**. The integration protocol:

1. **Session start:** Relay calls InstantRecall API to hydrate personal context → then pulls project context from Context Core
2. **Session end:** Session-level learnings optionally written to InstantRecall
3. **Orchestrator:** Can query InstantRecall for long-term individual patterns

#### Phase 3: Unified Frontend

The glassmorphic component library from InstantRecall should be extracted to `@tensorpunk/ui` and shared between:
- InstantRecall dashboard
- Relay frontend (graph view, review queue, orchestrator reports)
- AgentDashboard (Phase 2+ re-backend)

### 23.13 Environment Variables Required by InstantRecall

For reference when integrating:

```
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_KEY=          # SECRET
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Auth
NEXTAUTH_SECRET=               # openssl rand -base64 32
NEXTAUTH_URL=

# Encryption
ENCRYPTION_KEY=                # openssl rand -hex 32 (32 bytes)

# OpenAI (centralized embeddings)
OPENAI_API_KEY=                # InstantRecall's own key

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=
```

---

*This document is a living spec. It should be updated as design decisions are made and the system evolves. Every major architectural decision should be logged in §19.*

*Relay v0.1 — R&D Phase — April 2025 | Last updated: April 2026 (added §20–22: Lattice, External Systems unification, Rules Engine; §23: InstantRecall Deep Analysis)*
