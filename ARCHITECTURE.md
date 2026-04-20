# Relay Architecture

## System Overview

Relay is a **context flow protocol** — infrastructure for persistent, shared context across human-agent work sessions. It replaces tribal knowledge and synchronous handoffs with structured context packages.

## Data Flow (Phase 1)

```
┌─────────────────────────────────────────────────────────────┐
│  Developer Machine                                           │
│                                                              │
│  ┌──────────────────┐    ┌──────────────────┐               │
│  │ Claude Code       │    │ Claude Code       │              │
│  │ Session A         │    │ Session B         │              │
│  │ (NeuralDistortion)│    │ (LatentSampler)   │              │
│  └────────┬──────────┘    └────────┬──────────┘              │
│           │                        │                          │
│           ▼                        ▼                          │
│  ┌─────────────────────────────────────────────┐             │
│  │          relay-cli / relay-mcp               │             │
│  │  session start → pull → work → deposit       │             │
│  └─────────────────────┬───────────────────────┘             │
│                        │ HTTPS                                │
└────────────────────────┼────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Vercel Edge Functions (Relay API)                           │
│  POST /packages, GET /packages/:id, POST /sessions, etc.    │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼──────────────┐
        │             │              │
        ▼             ▼              ▼
┌────────────┐ ┌───────────┐ ┌────────────┐
│  Supabase  │ │ Supabase  │ │  Supabase  │
│  Postgres  │ │ Storage   │ │  pgvector  │
│  (graph +  │ │ (.relay   │ │  (semantic │
│   metadata)│ │  .zip)    │ │   search)  │
└────────────┘ └───────────┘ └────────────┘
```

## Package Architecture

### @relay/core
Shared foundation. Contains all types (from spec Section 15), the context package builder, cdiff generator, manifest utilities, and the Supabase client wrapper (`RelayClient`). Both CLI and MCP depend on this — business logic lives here, not in the interfaces.

### @relay/cli
Human-facing interface using `commander.js`. Git-style subcommands: `relay init`, `relay session start`, `relay pull`, `relay deposit`, `relay status`, `relay diff`, `relay orchestrate`. The `--auto` flag on deposit is the key UX innovation — zero-friction context capture from git diff + session info.

### @relay/mcp
Agent-facing interface. Thin MCP server wrapping `@relay/core` operations. Four Phase 1 tools: `relay_session_start`, `relay_pull_context`, `relay_deposit`, `relay_status`. Runs on stdio, registered in Claude Code's MCP config.

### @relay/api
Vercel Edge Functions providing the HTTP API layer. Routes map to core operations: deposit, pull, search, session management, orchestrator trigger.

### @relay/orchestrator
The Master Orchestrator. Takes all packages for a project + relevant CONTEXT.md snippets via pgvector, sends to Claude Sonnet with a synthesis prompt, produces an `orchestrator_report` package. Surfaces cross-session patterns and non-obvious connections.

## Core Primitive: Context Package

```
context-package-{id}.relay.zip
├── manifest.json          # Machine-readable metadata
├── CONTEXT.md             # Human + agent readable briefing
├── CLAUDE.md              # Claude-specific entry point
├── .cdiff                 # Context diff from parent
├── deliverables/          # Code, docs, assets produced
└── resources/             # Reference materials consumed
```

## Key Design Decisions

1. **CLI-first, MCP wraps CLI** — Testable independently, humans and agents share same logic
2. **pnpm workspaces** — Internal monorepo structure, consistent with Tensorpunk patterns
3. **Supabase + Vercel** — Proven stack from MoonShot, same operational model
4. **API key auth for Phase 1** — Single developer, no user management complexity
5. **IVFFlat for pgvector** — Simple, good enough for <10K packages. HNSW if needed later
6. **OpenAI text-embedding-3-small** — Proven, cheap, 1536 dims for semantic search
7. **Context diff (.cdiff)** — Structured delta between packages, not just git diff

## Database Schema

See `supabase/migrations/001_initial_schema.sql` for the full Phase 1 schema.

Key tables:
- `projects` — Top-level project containers
- `context_packages` — Package metadata (zip in Supabase Storage)
- `sessions` — Work session tracking
- `context_diffs` — Structured diffs between packages
- `package_embeddings` — pgvector embeddings for semantic search
- `orchestrator_reports` — Orchestrator digest outputs

## Integration Points

- **Global CLAUDE.md**: Auto-bootstraps every Claude Code session into the Relay protocol
- **Stop hook**: Auto-deposits context on session end (`relay deposit --auto`)
- **relay-mcp**: Registered as MCP server so agents use Relay natively
- **AgentDashboard**: Phase 1 read-only integration via `/api/relay/status`
- **External Systems/Agent**: `notify-agent.ps1` extended to also trigger `relay deposit`
