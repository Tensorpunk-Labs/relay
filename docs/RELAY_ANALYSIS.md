# RELAY ANALYSIS — Architecture, Assets, and Phase 1 Implementation Plan

**Produced:** 2026-04-03  
**Source:** `RELAY_SPEC.md` v0.1 + full Tensorpunk monorepo audit  
**Purpose:** Actionable R&D analysis leading to Phase 1 implementation

---

## Table of Contents

1. [Architecture Assessment](#1-architecture-assessment)
2. [Existing Asset Inventory](#2-existing-asset-inventory)
3. [Implementation Plan — Phase 1](#3-implementation-plan--phase-1)
4. [Supabase Schema — Phase 1 Minimal](#4-supabase-schema--phase-1-minimal)
5. [CLI Commands — MVP](#5-cli-commands--mvp)
6. [CLAUDE.md Template — Global Auto-Bootstrap](#6-claudemd-template--global-auto-bootstrap)
7. [Decisions & Open Items](#7-decisions--open-items)

---

## 1. Architecture Assessment

### How Relay Maps to the Existing Tensorpunk Ecosystem

The Relay spec describes five primary components. Here's how each maps to what already exists and what needs to be built.

| Relay Component | Existing Asset | Reuse Strategy | New Work Required |
|----------------|---------------|----------------|-------------------|
| **Context Core (DB)** | MoonShot Supabase pattern (proven) | Same Supabase + Vercel stack | New project, new schema, new API routes |
| **relay-cli** | tp-launcher (Python/Click CLI) | Pattern reference only — relay-cli is TypeScript/Node | Full build. Different language, different scope |
| **relay-mcp** | No MCP servers exist yet | First MCP server in the monorepo | Full build. MCP SDK + TypeScript |
| **Relay Frontend** | AgentDashboard (Flask + vanilla JS) | **Re-backend AgentDashboard** to read from Context Core | Adapter layer: AgentDashboard API → Supabase. New graph view later |
| **Master Orchestrator** | External Systems/Agent orchestrator concept | Conceptual reuse only — Relay Orchestrator is Claude API-driven | Full build. Prompt engineering + RAG retrieval |
| **Rules Engine** | External Systems webhook + notify-agent.ps1 | Pattern reference — Relay rules are declarative server-side | Full build (Phase 2+) |
| **The Lattice** | `_repos/experiments/the-lattice/` | Lattice becomes a Relay producer (deposits context packages) | Integration adapter (Phase 2) |

### Where Relay Lives in the Monorepo

```
X:\Tensorpunk\_repos\
├── _core/
│   └── relay/                    # NEW — monorepo package
│       ├── packages/
│       │   ├── core/             # Shared types, context-package builder, utils
│       │   ├── cli/              # relay-cli (Node.js CLI)
│       │   ├── mcp/              # relay-mcp server
│       │   ├── api/              # Vercel API routes (Edge Functions)
│       │   └── orchestrator/     # Master Orchestrator logic
│       ├── supabase/
│       │   ├── migrations/       # SQL migrations
│       │   └── seed.sql          # Dev seed data
│       ├── apps/
│       │   └── web/              # Next.js frontend (Phase 3)
│       ├── package.json          # pnpm workspace root
│       ├── pnpm-workspace.yaml
│       ├── CLAUDE.md
│       ├── ARCHITECTURE.md
│       └── README.md
```

**Rationale:** Relay is core infrastructure (not a "project" or "experiment"), so it belongs in `_core/`. The monorepo structure uses pnpm workspaces internally, consistent with the existing `_repos/package.json` workspace pattern.

### Data Flow — Phase 1 (Single Developer, Multi-Instance)

```
┌─────────────────────────────────────────────────────────────┐
│  Developer Machine (Jordan's Windows box)                    │
│                                                              │
│  ┌──────────────────┐    ┌──────────────────┐               │
│  │ Claude Code       │    │ Claude Code       │              │
│  │ Session A         │    │ Session B         │              │
│  │ (NeuralDistortion)│    │ (LatentSampler)   │              │
│  └────────┬──────────┘    └────────┬──────────┘              │
│           │ reads CLAUDE.md         │ reads CLAUDE.md         │
│           │ (auto-bootstrap)        │ (auto-bootstrap)        │
│           ▼                         ▼                         │
│  ┌─────────────────────────────────────────────┐             │
│  │            relay-cli / relay-mcp             │             │
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

### Critical Architecture Decision: CLI-First, MCP-Second

For Phase 1, **relay-cli is the primary interface**. The MCP server wraps CLI operations. This means:
- CLI can be tested and iterated independently
- MCP server is a thin adapter over CLI functions
- Both share `@relay/core` for all business logic
- Humans can use relay-cli directly; agents use relay-mcp

---

## 2. Existing Asset Inventory

### AgentDashboard — What We Can Leverage

**Location:** `X:\Tensorpunk\_repos\projects\AgentDashboard\`  
**Stack:** Flask 2.0+ (Python) backend, vanilla JS SPA frontend, file-based state  
**Lines of Code:** ~21,600 (4,388 backend + 812 CLI bridge + 16,397 frontend)

**Directly Reusable for Relay:**

| Feature | Current State | Relay Reuse |
|---------|--------------|-------------|
| **Session monitoring** | Reads JSONL from `~/.openclaw/agents/*/sessions/` | Adapter: also write session events to Context Core |
| **Bot registry** | 9 agents defined with personalities, voices, avatars | Maps directly to Relay agent identities |
| **Kanban board** | File-based markdown items with YAML frontmatter | **Replace** with Relay context package status view |
| **Voice system** | ElevenLabs TTS with per-bot personality profiles | Maps to Relay voice personality profiles in Rules Engine |
| **CLI bridge** | Spawns `claude` CLI subprocesses, captures output | Extend to auto-run `relay deposit` on session completion |
| **Confidence workflow** | 0.0-1.0 agent self-reporting | Could map to package status progression |
| **Desktop toasts** | Windows notifications via plyer | Reusable for Relay rule actions |
| **Neural Traces** | JSONL audit log of file operations | Supplement with Relay session/package events |

**Integration Path (Phase 1):**
AgentDashboard continues running as-is. Add a new API route (`/api/relay/status`) that queries the Relay Context Core and surfaces it in the dashboard. The Kanban view gets a "Context Packages" tab that shows packages from Supabase instead of local markdown files.

**Integration Path (Phase 2+):**
AgentDashboard becomes a full Relay frontend consumer — its session view shows Relay sessions, its graph view shows the context package graph, its review queue shows pending reviews. The Flask backend becomes a thin proxy to the Relay API.

### External Systems / Agent — What We Can Leverage

**Location:** `X:\Tensorpunk\.agentic\openclaw\`  
**Stack:** External Systems gateway (pm2), Telegram bot, webhook-based coordination

| Feature | Current State | Relay Reuse |
|---------|--------------|-------------|
| **Agent orchestrator** | Main agent on Telegram, delegates to Claude Code | Becomes a Relay session participant — deposits context packages |
| **notify-agent.ps1** | Sends Claude Code completion summaries to Agent | Extend: also trigger `relay deposit` on completion |
| **Research sessions** | Twice-daily R&D logged to markdown | Each research session → `relay deposit` as `lattice_agent_output` or `standard` package |
| **Reminders system** | Markdown-based time triggers | Could be migrated to Relay rules engine (Phase 2) |
| **Agent role definitions** | 9 bots with distinct personalities | Map to Relay agent identities + voice personality profiles |
| **Webhook integration** | HTTP POST to External Systems gateway | Relay rules engine can trigger via same webhook pattern |

**Critical Integration Point:**
The `notify-agent.ps1` script is the natural hook point. Currently it:
1. Reads conversation transcript
2. Extracts last assistant message
3. Sends to Agent via `openclaw message send`

**Phase 1 extension:** After step 3, also run `relay deposit --auto` which packages the session summary as a context package and uploads to Context Core.

### The Lattice — What We Can Leverage

**Location:** `X:\Tensorpunk\_repos\experiments\the-lattice\`  
**Stack:** PowerShell orchestrator, Claude CLI agents, knowledge graph

| Feature | Current State | Relay Reuse |
|---------|--------------|-------------|
| **Multi-agent swarm** | 6 archetypes (Theorist, Hacker, Analyst, etc.) | Each agent deposits a context package post-run |
| **Knowledge graph** | `knowledge-graph.json` with lineage tracking | Migrate to Context Core graph (packages as nodes) |
| **Bead economy** | Token-based natural selection | Could map to Relay orchestrator prioritization |
| **Orchestrator** | PowerShell `lattice.ps1` | Wraps with `relay deposit` at swarm completion |

**Integration (Phase 2):** The Lattice orchestrator calls `relay deposit` for each agent output + a synthesis package. This is explicitly designed in RELAY_SPEC.md Section 20.

### Existing Infrastructure Patterns

| Pattern | Where It's Proven | How Relay Uses It |
|---------|------------------|-------------------|
| **Supabase + Vercel** | MoonShot dashboard (`qmgjvsslupkpfrnnihfz.supabase.co`) | Same stack, new project |
| **pnpm workspace** | `_repos/package.json` | Relay repo uses internal pnpm workspaces |
| **@tensorpunk/ui** | `tensorpunk-core/webui/` (React + Tailwind) | Relay frontend imports shared components |
| **Labs standards** | `tensorpunk-labs/` templates | Relay follows CLAUDE.md, ARCHITECTURE.md, README.md pattern |
| **Environment vars** | `set_tensorpunk_env.ps1` | Add `RELAY_CORE_URL`, `RELAY_PROJECT_ID` |
| **Click CLI pattern** | tp-launcher | Reference for UX — relay-cli uses similar ergonomics in Node |

---

## 3. Implementation Plan — Phase 1

### Goal
Multiple Claude Code instances on Jordan's machine sharing a persistent Context Core. The core loop works:

**Session start -> Pull context -> Do work -> Deposit package -> Next session picks up seamlessly**

### Phase 1 Scope (What's In)

- Supabase project with core schema (packages, sessions, diffs)
- Vercel API with deposit, pull, status, search endpoints
- `relay-cli` with: `init`, `session start/end`, `pull`, `deposit`, `status`, `diff`
- `relay-mcp` with: `relay_session_start`, `relay_pull_context`, `relay_deposit`, `relay_status`
- Global `CLAUDE.md` template that auto-bootstraps every Claude session
- Basic semantic search via pgvector (embed CONTEXT.md at deposit time)
- Basic orchestrator: `relay orchestrate` produces a project digest

### Phase 1 Scope (What's Out)

- Multi-user auth (single developer, API key auth)
- Rules Engine (hardcoded behaviors only)
- Lattice integration (manual deposits only)
- AgentDashboard re-backend (read-only integration at most)
- Frontend (CLI + MCP only)
- Voice integration
- Real-time subscriptions

### Step-by-Step Build Order

#### Step 1: Scaffold the Monorepo Package

```bash
mkdir -p /path/to/relay
cd /path/to/relay

# Initialize pnpm workspace
# Create packages/core, packages/cli, packages/mcp, packages/api, packages/orchestrator
# Create supabase/migrations
# Add CLAUDE.md, README.md, ARCHITECTURE.md
```

**Package structure:**
```
relay/
├── package.json              # workspace root
├── pnpm-workspace.yaml       # "packages/*"
├── tsconfig.base.json        # shared TS config
├── .env.example              # SUPABASE_URL, SUPABASE_ANON_KEY, etc.
├── CLAUDE.md
├── README.md
├── packages/
│   ├── core/                 # @relay/core
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types.ts           # All shared types (from spec §15)
│   │       ├── context-package.ts # Package builder + validator
│   │       ├── cdiff.ts           # Context diff generator
│   │       ├── manifest.ts        # Manifest builder
│   │       ├── client.ts          # Supabase/API client wrapper
│   │       └── index.ts
│   ├── cli/                  # relay-cli
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts           # CLI entry point (commander.js)
│   │       ├── commands/
│   │       │   ├── init.ts
│   │       │   ├── session.ts     # start, end
│   │       │   ├── pull.ts
│   │       │   ├── deposit.ts
│   │       │   ├── status.ts
│   │       │   ├── diff.ts
│   │       │   ├── orchestrate.ts
│   │       │   └── config.ts
│   │       └── utils/
│   │           ├── config.ts      # ~/.relay/config.json reader
│   │           └── display.ts     # Terminal output formatting
│   ├── mcp/                  # relay-mcp
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts           # MCP server entry
│   │       └── tools.ts           # Tool definitions wrapping @relay/core
│   ├── api/                  # Vercel Edge Functions
│   │   ├── package.json
│   │   ├── vercel.json
│   │   └── api/
│   │       └── v1/
│   │           ├── packages/
│   │           │   ├── route.ts        # POST (deposit), GET (list)
│   │           │   └── [id]/
│   │           │       ├── route.ts    # GET (metadata)
│   │           │       ├── download/route.ts
│   │           │       ├── diff/route.ts
│   │           │       └── status/route.ts  # PATCH
│   │           ├── sessions/
│   │           │   └── route.ts        # POST (start), PATCH (end)
│   │           ├── search/
│   │           │   └── route.ts        # POST (semantic search)
│   │           ├── projects/
│   │           │   └── [id]/
│   │           │       ├── packages/route.ts
│   │           │       ├── graph/route.ts
│   │           │       └── open-questions/route.ts
│   │           └── orchestrate/
│   │               └── route.ts        # POST (trigger)
│   └── orchestrator/
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── synthesize.ts      # Graph traversal + RAG → Claude prompt
│           └── prompts.ts         # Orchestrator system prompts
└── supabase/
    ├── migrations/
    │   └── 001_initial_schema.sql
    └── seed.sql
```

#### Step 2: Supabase Project + Schema

1. Create new Supabase project (e.g., `relay-context-core`)
2. Run migration `001_initial_schema.sql` (see Section 4 below)
3. Create Storage bucket `context-packages` for `.relay.zip` files
4. Enable pgvector extension
5. Store credentials in `.env`

#### Step 3: Build @relay/core

The shared library that both CLI and MCP depend on:
- TypeScript types from spec Section 15
- `buildContextPackage()` — assembles manifest.json + CONTEXT.md + .cdiff + deliverables into a zip
- `generateCdiff()` — computes context diff between parent and current package
- `RelayClient` class — wraps Supabase client for all CRUD operations
- `generateEmbedding()` — calls OpenAI text-embedding-3-small for semantic search

#### Step 4: Build relay-cli

Using `commander.js` for the CLI framework (closest to git UX):

```bash
npm install -g @relay/cli   # or: npx relay-cli
relay init                   # link current directory to a Relay project
relay session start          # register session with Context Core
relay pull                   # pull most relevant context package
relay deposit                # interactive: package work → upload
relay status                 # show current session + project state
relay diff --latest          # diff current work against last deposit
relay orchestrate            # trigger orchestrator digest
relay config set core-url <url>
```

#### Step 5: Build relay-mcp

MCP server exposing 4 tools for Phase 1:
- `relay_session_start` — registers session, returns project summary
- `relay_pull_context` — retrieves relevant context package(s)
- `relay_deposit` — packages and uploads work
- `relay_status` — returns current project/session state

Register in Claude Code's MCP config:
```json
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["/path/to/relay"]
    }
  }
}
```

#### Step 6: Deploy Vercel API

Minimal Edge Function routes:
- `POST /api/v1/packages` — deposit (accepts multipart: metadata + zip)
- `GET /api/v1/packages/:id` — get package metadata
- `GET /api/v1/packages/:id/download` — download .relay.zip
- `GET /api/v1/packages/:id/diff` — get .cdiff
- `PATCH /api/v1/packages/:id/status` — update status
- `POST /api/v1/sessions` — start session
- `PATCH /api/v1/sessions/:id` — end session
- `POST /api/v1/search` — semantic search
- `GET /api/v1/projects/:id/packages` — list project packages
- `POST /api/v1/orchestrate` — trigger orchestrator

#### Step 7: Global CLAUDE.md Bootstrap

Update `X:\Tensorpunk\CLAUDE.md` to include Relay instructions so every Claude Code session auto-participates. See Section 6 below.

#### Step 8: Basic Orchestrator

A single prompt that:
1. Queries all packages for a project (structured metadata via Postgres)
2. Retrieves the 10 most relevant CONTEXT.md snippets via pgvector
3. Sends to Claude Sonnet with a synthesis prompt
4. Deposits the result as an `orchestrator_report` package

#### Step 9: Validation

Run the core loop end-to-end:
1. Start Claude Code Session A in NeuralDistortion project
2. Session A does work, runs `relay deposit`
3. Start Claude Code Session B (fresh) in the same project
4. Session B runs `relay pull` — gets Session A's context
5. Session B continues the work meaningfully
6. Run `relay orchestrate` — get a project digest
7. Verify the orchestrator surfaces something non-obvious

---

## 4. Supabase Schema — Phase 1 Minimal

This is the minimal schema needed for Phase 1. It omits team management, rules engine tables, and voice personality tables (all Phase 2+).

```sql
-- ============================================================
-- RELAY CONTEXT CORE — Phase 1 Schema
-- Supabase Postgres + pgvector
-- ============================================================

-- Enable required extensions
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROJECTS
-- ============================================================
create table projects (
  id text primary key default 'proj_' || replace(gen_random_uuid()::text, '-', ''),
  name text not null,
  description text,
  owner_id text not null default 'jordan',  -- single-user Phase 1
  settings jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- CONTEXT PACKAGES (metadata — zip stored in Supabase Storage)
-- ============================================================
create table context_packages (
  id text primary key,  -- 'pkg_' prefix, generated client-side
  project_id text not null references projects(id),
  title text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'pending_review', 'approved', 'rejected', 'complete', 'blocked')),
  package_type text not null default 'standard'
    check (package_type in ('standard', 'lattice_agent_output', 'lattice_synthesis', 'orchestrator_report', 'human_review', 'onboarding_briefing')),
  review_type text not null default 'none'
    check (review_type in ('human', 'agent', 'none')),
  parent_package_id text references context_packages(id),
  created_by_type text not null
    check (created_by_type in ('agent', 'human')),
  created_by_id text not null,
  session_id text,
  tags text[] default '{}',
  open_questions jsonb default '[]',
  decisions_made jsonb default '[]',
  handoff_note text,
  estimated_next_actor text
    check (estimated_next_actor in ('agent', 'human') or estimated_next_actor is null),
  deliverables jsonb default '[]',
  storage_path text,              -- path in Supabase Storage bucket
  context_md text,                -- full CONTEXT.md text (for search + display)
  manifest jsonb not null,        -- full manifest.json
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- PACKAGE DEPENDENCIES (many-to-many)
-- ============================================================
create table package_dependencies (
  package_id text references context_packages(id) on delete cascade,
  depends_on_id text references context_packages(id) on delete cascade,
  primary key (package_id, depends_on_id)
);

-- ============================================================
-- CONTEXT DIFFS
-- ============================================================
create table context_diffs (
  id text primary key,  -- 'cdiff_' prefix
  from_package_id text references context_packages(id),
  to_package_id text not null references context_packages(id),
  actor_type text not null,
  actor_id text not null,
  changes jsonb not null,
  created_at timestamptz default now()
);

-- ============================================================
-- SESSIONS
-- ============================================================
create table sessions (
  id text primary key,  -- 'sess_' prefix
  project_id text not null references projects(id),
  actor_type text not null check (actor_type in ('agent', 'human')),
  actor_id text not null,
  agent_description text,       -- e.g. "Claude Code @ NeuralDistortion"
  packages_pulled text[] default '{}',
  packages_deposited text[] default '{}',
  started_at timestamptz default now(),
  ended_at timestamptz
);

-- ============================================================
-- EMBEDDINGS (pgvector for semantic search)
-- ============================================================
create table package_embeddings (
  id text primary key default 'emb_' || replace(gen_random_uuid()::text, '-', ''),
  package_id text not null references context_packages(id) on delete cascade,
  content_type text not null
    check (content_type in ('context_md', 'decision', 'question', 'handoff')),
  content text not null,
  embedding vector(1536),  -- OpenAI text-embedding-3-small dimension
  created_at timestamptz default now()
);

-- ============================================================
-- ORCHESTRATOR REPORTS
-- ============================================================
create table orchestrator_reports (
  id text primary key default 'orch_' || replace(gen_random_uuid()::text, '-', ''),
  project_id text not null references projects(id),
  report_type text not null
    check (report_type in ('digest', 'health', 'onboarding', 'anomaly')),
  content text not null,
  metadata jsonb default '{}',
  triggered_by text,  -- session_id or 'scheduled' or 'manual'
  created_at timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_packages_project_status on context_packages(project_id, status);
create index idx_packages_parent on context_packages(parent_package_id);
create index idx_packages_created on context_packages(project_id, created_at desc);
create index idx_sessions_project on sessions(project_id, started_at desc);
create index idx_diffs_to_package on context_diffs(to_package_id);
create index idx_embeddings_package on package_embeddings(package_id);

-- pgvector index — use ivfflat for Phase 1 (good enough, easy to set up)
-- Switch to HNSW if search quality becomes an issue at scale
create index idx_embeddings_vector on package_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============================================================
-- SEMANTIC SEARCH FUNCTION
-- ============================================================
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
    pe.package_id,
    pe.content_type,
    pe.content,
    1 - (pe.embedding <=> query_embedding) as similarity
  from package_embeddings pe
  join context_packages cp on cp.id = pe.package_id
  where cp.project_id = project_filter
  order by pe.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- HELPER: Get latest packages for a project
-- ============================================================
create or replace function get_latest_packages(
  p_project_id text,
  p_limit int default 20
)
returns setof context_packages
language sql stable
as $$
  select *
  from context_packages
  where project_id = p_project_id
  order by created_at desc
  limit p_limit;
$$;

-- ============================================================
-- HELPER: Get package lineage (walk parent chain)
-- ============================================================
create or replace function get_package_lineage(
  p_package_id text,
  p_depth int default 10
)
returns table (
  id text,
  title text,
  status text,
  parent_package_id text,
  created_by_type text,
  created_by_id text,
  created_at timestamptz,
  depth int
)
language sql stable
as $$
  with recursive lineage as (
    select cp.id, cp.title, cp.status, cp.parent_package_id,
           cp.created_by_type, cp.created_by_id, cp.created_at,
           0 as depth
    from context_packages cp
    where cp.id = p_package_id

    union all

    select cp.id, cp.title, cp.status, cp.parent_package_id,
           cp.created_by_type, cp.created_by_id, cp.created_at,
           l.depth + 1
    from context_packages cp
    join lineage l on cp.id = l.parent_package_id
    where l.depth < p_depth
  )
  select * from lineage order by depth;
$$;

-- ============================================================
-- STORAGE BUCKET (run via Supabase dashboard or API)
-- ============================================================
-- Create bucket: 'context-packages'
-- Public: false
-- File size limit: 50MB
-- Allowed MIME types: application/zip, application/octet-stream
```

### Supabase Storage Setup

```bash
# Via Supabase CLI or dashboard:
# 1. Create bucket 'context-packages' (private, 50MB limit)
# 2. Storage policy: authenticated users can read/write their own project's packages
```

---

## 5. CLI Commands — MVP

### relay-cli Phase 1 Command Reference

```
relay-cli v0.1 — Context flow for human-agent teams

USAGE
  relay <command> [options]

CONFIGURATION
  relay init                            Initialize Relay in current directory
                                        Creates .relay/config.json, links to project
  relay config set <key> <value>        Set config value
                                        Keys: core-url, project-id, api-key
  relay config get <key>                Get config value
  relay config show                     Show all config

SESSION MANAGEMENT
  relay session start [--project <id>]  Start a new session, register with Context Core
                                        Returns: session_id, project summary, pending reviews
  relay session end                     End current session
                                        Prompts for outstanding deposit if work was done
  relay session status                  Show current session info

CONTEXT PACKAGE OPERATIONS
  relay pull [package_id]               Pull a specific package
  relay pull --latest                   Pull the most recent package for current project
  relay pull --next                     Pull the next recommended work item
  relay pull --query "search terms"     Semantic search for most relevant package

  relay deposit                         Interactive: package current work and upload
    --title "..."                       Package title
    --description "..."                 Short description
    --decisions "d1" --decisions "d2"   Decisions made (repeatable)
    --questions "q1" --questions "q2"   Open questions (repeatable)
    --handoff "..."                     Handoff note for next actor
    --files path1 path2                 Deliverable files to include
    --status <status>                   Package status (default: complete)
    --review <type>                     Review type: human | agent | none
    --parent <package_id>               Parent package (auto-detected if in session)
    --auto                              Non-interactive: auto-generate from git diff + session

  relay status                          Show project status overview
                                        Current session, recent packages, pending reviews

DIFF OPERATIONS
  relay diff <from_id> <to_id>          Show context diff between two packages
  relay diff --latest                   Diff current state against last deposit

ORCHESTRATOR
  relay orchestrate [--project <id>]    Run orchestrator, produce project digest
  relay orchestrate --focus "topic"     Focus orchestrator on specific area

PROJECT MANAGEMENT
  relay projects list                   List projects you have access to
  relay projects create "name"          Create a new project
  relay projects info [id]              Show project details + stats
```

### Config File Structure

```jsonc
// ~/.relay/config.json (global)
{
  "core_url": "https://relay-context-core.vercel.app",
  "api_key": "sb_...",
  "default_project": "proj_abc123",
  "actor_id": "your-actor-id",
  "actor_type": "human",
  "embedding_provider": "openai",
  "openai_api_key": "sk-..."
}

// .relay/config.json (per-project, created by `relay init`)
{
  "project_id": "proj_abc123",
  "project_name": "NeuralDistortion"
}
```

### relay deposit --auto Flow

This is the key command for automatic context capture. When a Claude Code session ends (or a human runs it manually):

1. Read current git diff (staged + unstaged) as deliverable summary
2. Read last N messages from session transcript (if available)
3. Auto-generate title from git branch + recent commits
4. Auto-generate CONTEXT.md from session summary
5. Auto-detect parent package from current session's `packages_pulled`
6. Generate .cdiff against parent
7. Zip everything into `.relay.zip`
8. Upload to Context Core
9. Return package ID + URL

This is what makes the system **invisible to the flow** — agents don't need to manually fill out context packages.

---

## 6. CLAUDE.md Template — Global Auto-Bootstrap

This goes into the global `CLAUDE.md` at `X:\Tensorpunk\CLAUDE.md` (appended to existing content):

```markdown
## Relay Protocol — Automatic Context Participation

This workspace uses the **Relay protocol** for persistent context flow across Claude sessions.

### Context Core
- **Endpoint:** https://relay-context-core.vercel.app
- **Default Project:** Determined by `.relay/config.json` in the current working directory

### On Session Start
When you begin working in any project directory that has a `.relay/config.json`:

1. **Check for Relay config:** Look for `.relay/config.json` in the project root
2. **If found**, use the `relay_session_start` MCP tool (or run `relay session start`) to:
   - Register this session with the Context Core
   - Receive a project status summary
   - Get any pending reviews or open questions needing attention
3. **Pull relevant context:** Use `relay_pull_context` with mode='relevant' to orient yourself on what other sessions have been working on
4. **Check open questions:** Review any unresolved questions from previous sessions that may affect your work

### During Work
- Surface open questions explicitly — add them to your mental model rather than making silent assumptions
- Track decisions you make and why — these will be captured at deposit time
- If you discover a blocker, note it for the deposit

### On Work Completion
Before ending your session, deposit your work:

1. Run `relay deposit --auto` (or use the `relay_deposit` MCP tool) to package:
   - What you did (auto-generated from session activity)
   - Decisions made and their rationale
   - Open questions discovered
   - A handoff note for the next actor
2. The system will auto-generate the context package and upload it

### Key Principles
- **Never assume context from memory alone** — always pull from the Context Core when starting
- **Surface open questions explicitly** rather than making silent assumptions
- **Every deposit should leave the next actor fully oriented** — write handoff notes as if the next reader has zero context
- **Decisions need rationale** — "we chose X" is incomplete; "we chose X because Y" is a proper decision record

### If No Relay Config Exists
If the current directory doesn't have `.relay/config.json`, skip all Relay operations. The protocol is opt-in per project.
```

### MCP Server Registration

Add to `~/.claude/settings.json` (or `.claude/settings.local.json`):

```jsonc
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["/path/to/relay"],
      "env": {
        "RELAY_CORE_URL": "https://relay-context-core.vercel.app",
        "RELAY_API_KEY": "sb_..."
      }
    }
  }
}
```

### Hook Integration

Add a Claude Code hook that auto-deposits on session end:

```jsonc
// In ~/.claude/settings.json hooks section
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "powershell -Command \"if (Test-Path '.relay/config.json') { relay deposit --auto --quiet 2>$null }\"",
            "timeout": 30000
          }
        ]
      }
    ]
  }
}
```

This makes every Claude Code session automatically deposit its context when it finishes — zero friction, zero ceremony.

---

## 7. Decisions & Open Items

### Decisions Made in This Analysis

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Relay repo goes in `_repos/_core/relay/` | It's core infrastructure, not a project or experiment |
| 2 | TypeScript for all Relay packages | Matches Vercel Edge Functions, MCP SDK, and npm ecosystem. tp-launcher is Python but relay-cli has different needs |
| 3 | `commander.js` for CLI framework | Closest to git-style UX. Better than yargs for subcommands |
| 4 | CLI-first, MCP wraps CLI | Testable independently, humans and agents share same logic |
| 5 | Phase 1 uses API key auth, not Supabase Auth | Single developer, no user management needed yet |
| 6 | `relay deposit --auto` is the key UX innovation | Makes context capture invisible — the system that disappears into the flow |
| 7 | AgentDashboard gets read-only Relay integration first | Don't re-backend yet, just add a new view that reads from Context Core |
| 8 | OpenAI `text-embedding-3-small` for embeddings | Proven, cheap, 1536 dims. Can switch to Claude embeddings later |
| 9 | IVFFlat index for Phase 1, HNSW if needed later | IVFFlat is simpler to set up, good enough for <10K packages |
| 10 | Stop hook auto-deposits on session end | Zero-friction participation — the invisible principle |

### Open Items for Phase 1

| # | Question | Notes |
|---|----------|-------|
| 1 | Supabase project name and URL? | Need to create project. Suggest: `relay-context-core` |
| 2 | Vercel project deployment? | New Vercel project or subdirectory of existing? |
| 3 | How to handle large deliverables in auto-deposit? | Git diff may be huge. Need size limit + smart summarization |
| 4 | Session ID format? | Propose: `sess_` + UUID. But should it include machine/instance identifier? |
| 5 | How does `relay pull --next` determine "next"? | Needs prioritization logic: pending reviews > blocked items > most recent incomplete |
| 6 | Should the orchestrator run automatically after N deposits? | Spec says event-driven. Phase 1: manual only via `relay orchestrate` |
| 7 | OpenAI API key management? | Needed for embeddings. Store in `~/.relay/config.json` or env var |
| 8 | Package ID generation? | Client-side with `pkg_` prefix + random. Collision risk negligible at Phase 1 scale |

### Phase 2 Preview (Not In Scope But Planned)

- Multi-user auth (Supabase Auth)
- Rules Engine (declarative automation)
- AgentDashboard full re-backend
- Lattice integration (auto-deposit from swarm runs)
- Voice personality profiles
- Real-time subscriptions for status updates
- Review queue with approval workflow
- Next.js frontend with graph visualization

---

## Appendix A: relay-cli Scaffold

Quick-start for the CLI package:

```typescript
// packages/cli/src/index.ts
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { sessionCommand } from './commands/session';
import { pullCommand } from './commands/pull';
import { depositCommand } from './commands/deposit';
import { statusCommand } from './commands/status';
import { diffCommand } from './commands/diff';
import { orchestrateCommand } from './commands/orchestrate';
import { configCommand } from './commands/config';
import { projectsCommand } from './commands/projects';

const program = new Command();

program
  .name('relay')
  .description('Context flow for human-agent teams')
  .version('0.1.0');

program.addCommand(initCommand());
program.addCommand(sessionCommand());
program.addCommand(pullCommand());
program.addCommand(depositCommand());
program.addCommand(statusCommand());
program.addCommand(diffCommand());
program.addCommand(orchestrateCommand());
program.addCommand(configCommand());
program.addCommand(projectsCommand());

program.parse();
```

```typescript
// packages/cli/src/commands/deposit.ts
import { Command } from 'commander';
import { RelayClient } from '@relay/core';
import { buildContextPackage, generateCdiff } from '@relay/core';

export function depositCommand(): Command {
  const cmd = new Command('deposit')
    .description('Package current work as a context package and upload')
    .option('--title <title>', 'Package title')
    .option('--description <desc>', 'Short description')
    .option('--decisions <decisions...>', 'Decisions made')
    .option('--questions <questions...>', 'Open questions')
    .option('--handoff <note>', 'Handoff note for next actor')
    .option('--files <paths...>', 'Deliverable files to include')
    .option('--status <status>', 'Package status', 'complete')
    .option('--review <type>', 'Review type: human | agent | none', 'none')
    .option('--parent <id>', 'Parent package ID')
    .option('--auto', 'Non-interactive auto-generate from session')
    .option('--quiet', 'Suppress output (for hooks)')
    .action(async (opts) => {
      const client = await RelayClient.fromConfig();

      if (opts.auto) {
        // Auto-generate context from:
        // 1. Git diff in current directory
        // 2. Current session info from Context Core
        // 3. Any .relay/session.json local state
        const pkg = await client.autoDeposit({
          parentId: opts.parent,
          status: opts.status,
          reviewType: opts.review,
        });

        if (!opts.quiet) {
          console.log(`Deposited: ${pkg.id}`);
          console.log(`Status: ${pkg.status}`);
        }
        return;
      }

      // Interactive / flag-driven deposit
      const pkg = await client.deposit({
        title: opts.title,
        description: opts.description,
        decisions: opts.decisions || [],
        openQuestions: opts.questions || [],
        handoffNote: opts.handoff,
        deliverablePaths: opts.files || [],
        status: opts.status,
        reviewType: opts.review,
        parentId: opts.parent,
      });

      console.log(`Deposited: ${pkg.id}`);
      console.log(`URL: ${client.packageUrl(pkg.id)}`);
    });

  return cmd;
}
```

```typescript
// packages/core/src/types.ts
export type PackageStatus =
  | 'draft'
  | 'in_progress'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'complete'
  | 'blocked';

export type ActorType = 'agent' | 'human';
export type ReviewType = 'human' | 'agent' | 'none';

export type PackageType =
  | 'standard'
  | 'lattice_agent_output'
  | 'lattice_synthesis'
  | 'orchestrator_report'
  | 'human_review'
  | 'onboarding_briefing';

export interface RelayManifest {
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
  package_type: PackageType;
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
  estimated_next_actor: ActorType | null;
  context_diff_ref: string;
}

export interface Deliverable {
  path: string;
  type: string;
  language?: string;
}

export interface ContextDiff {
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

export interface Session {
  id: string;
  project_id: string;
  actor: { type: ActorType; id: string };
  agent_description?: string;
  started_at: string;
  ended_at: string | null;
  packages_pulled: string[];
  packages_deposited: string[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  owner_id: string;
  settings: Record<string, unknown>;
}
```

## Appendix B: MCP Server Scaffold

```typescript
// packages/mcp/src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RelayClient } from '@relay/core';

const server = new Server(
  { name: 'relay-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

const client = RelayClient.fromEnv();

server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'relay_session_start',
      description: 'Start a Relay session. Returns project summary and pending items.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project ID (or uses default from config)' },
          agent_description: { type: 'string', description: 'Description of this agent instance' },
        },
      },
    },
    {
      name: 'relay_pull_context',
      description: 'Pull context packages from the Context Core.',
      inputSchema: {
        type: 'object',
        properties: {
          package_id: { type: 'string', description: 'Specific package ID to pull' },
          query: { type: 'string', description: 'Semantic search query' },
          mode: {
            type: 'string',
            enum: ['specific', 'next', 'relevant', 'latest'],
            description: 'Pull mode',
          },
        },
      },
    },
    {
      name: 'relay_deposit',
      description: 'Deposit a context package with your work results.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          decisions_made: { type: 'array', items: { type: 'string' } },
          open_questions: { type: 'array', items: { type: 'string' } },
          handoff_note: { type: 'string' },
          status: { type: 'string', enum: ['complete', 'in_progress', 'blocked', 'pending_review'] },
          review_type: { type: 'string', enum: ['human', 'agent', 'none'] },
        },
        required: ['title', 'description', 'handoff_note'],
      },
    },
    {
      name: 'relay_status',
      description: 'Get current project and session status.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
        },
      },
    },
  ],
}));

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'relay_session_start': {
      const session = await client.startSession({
        projectId: args.project_id,
        agentDescription: args.agent_description,
      });
      return { content: [{ type: 'text', text: JSON.stringify(session, null, 2) }] };
    }

    case 'relay_pull_context': {
      const context = await client.pullContext({
        packageId: args.package_id,
        query: args.query,
        mode: args.mode || 'relevant',
      });
      return { content: [{ type: 'text', text: JSON.stringify(context, null, 2) }] };
    }

    case 'relay_deposit': {
      const pkg = await client.deposit({
        title: args.title,
        description: args.description,
        decisions: args.decisions_made || [],
        openQuestions: args.open_questions || [],
        handoffNote: args.handoff_note,
        status: args.status || 'complete',
        reviewType: args.review_type || 'none',
      });
      return { content: [{ type: 'text', text: JSON.stringify(pkg, null, 2) }] };
    }

    case 'relay_status': {
      const status = await client.getProjectStatus(args.project_id);
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

---

*Analysis complete. This document is the foundation for Phase 1 implementation. Each section is designed to be independently actionable — pick up any section and start building.*

*Next step: Create the Supabase project and scaffold the repo.*

---

## 8. InstantRecall Integration Notes

**Produced:** 2026-04-03  
**Source:** Deep code analysis of `X:\DevExperiments\instantrecallai`

### What InstantRecall Is

A production-grade **memory-as-a-service SaaS** built on Next.js 15 + Supabase + Pinecone + Stripe. It provides persistent conversational memory via a RAG pipeline: embed messages → store in Pinecone → retrieve similar context on next query → optionally summarize with LLM (OpenAI/Claude/Grok). Users bring their own Pinecone + LLM API keys; InstantRecall covers embedding costs centrally.

### Direct Code Lifts for Relay Phase 1

The following files from InstantRecall can be copied with minimal adaptation:

| File | What It Gives Relay | Effort |
|------|---------------------|--------|
| `src/lib/encryption.ts` | AES-256-GCM encrypt/decrypt for API keys, webhook secrets | Drop-in |
| `src/lib/supabase.ts` | Dual client pattern (admin + anon) | Rename env vars only |
| `src/lib/openai.ts` → `generateEmbedding()` | text-embedding-3-small at 1536 dims | Extract into `@relay/core` |
| `src/db/usage-functions.sql` → `increment_user_usage()` | UPSERT-based concurrent-safe metering | Adapt for deposit counting |
| Auth guard pattern | `getServerSession() → 401` in every route | Phase 2 (multi-user) |

### Shared Embedding Model Alignment

Both systems use **OpenAI text-embedding-3-small (1536 dims)**. This is critical for the Phase 2 integration where Relay can query InstantRecall's personal memory layer — embeddings are compatible and can be compared across systems.

Relay uses **pgvector** (co-located in Supabase) while InstantRecall uses **Pinecone** (external, BYO). This means:
- Relay's `package_embeddings` table with ivfflat index replaces Pinecone for project-level context
- InstantRecall keeps Pinecone for personal/conversational memory (different use case, different data)
- Cross-system queries are possible because the embedding space is identical

### Schema Comparison & Lessons

**What InstantRecall does well that Relay should replicate:**
1. **CHECK constraints for business rules** — temperature ranges, valid model names, plan types all enforced in DB, not just app code
2. **SECURITY DEFINER functions** — `get_user_settings()`, `increment_user_usage()` elevate permissions for specific operations while keeping RLS tight everywhere else
3. **Trigger-based audit trails** — `save_prompt_history()` auto-captures snapshots on field change. Relay should do this for package status transitions
4. **UPSERT for concurrent safety** — Usage metering uses `ON CONFLICT DO UPDATE` to avoid race conditions. Apply to session updates, package status changes

**What Relay does differently (by design):**
1. **Vector storage co-located** — pgvector in Supabase vs external Pinecone. Simpler ops, transactional consistency, no BYO key needed
2. **Multi-content-type embeddings** — InstantRecall embeds whole messages. Relay embeds context_md, decisions, questions, and handoff notes separately (the `content_type` column in `package_embeddings`)
3. **Graph structure** — InstantRecall is flat. Relay has `parent_package_id`, `package_dependencies`, and the `get_package_lineage()` recursive CTE
4. **Session as first-class entity** — InstantRecall sessions are just a filter string. Relay sessions have lifecycle (started_at, ended_at, packages_pulled, packages_deposited)

### Frontend Components for Phase 3

InstantRecall has a polished glassmorphic design system that should be extracted to `@tensorpunk/ui`:

**Ready to lift:**
- `GlassPanel` — reusable glass container with backdrop-blur, hover glow
- `GradientHeading` — rainbow gradient text (indigo→pink→cyan)
- `GradientBackground` — 8-blob radial gradient backdrop + noise texture
- `Button` — primary/secondary/ghost variants with loading state
- `Input` — glass-styled with gradient focus border
- `FadeInSection` — IntersectionObserver scroll animation

**Pattern reference only (adapt for Relay):**
- `SubscriptionPanel` — plan/usage display
- `TestPlayground` — interactive API testing UI
- `AddKeyModal` — BYO API key entry flow
- `CostCalculator` — usage cost estimator

### Billing Pattern Reference

InstantRecall's Stripe integration is production-complete and serves as the template for Relay Phase 2+ monetization:

- **Plan tiers:** Free (100 queries/month) → Pro (10,000 queries/month)
- **Lazy Stripe client:** Created on first access, not at import (builds succeed without keys)
- **Webhook handling:** Signature verification + customer.subscription lifecycle events
- **Usage metering:** Monthly YYYY-MM buckets with UPSERT counting
- **Billing portal:** One-click Stripe portal redirect for subscription management

### Integration Protocol (from RELAY_SPEC.md §11)

1. **Session start:** `relay session start` → call InstantRecall for personal context → call Context Core for project context
2. **During work:** Relay handles project context flow. InstantRecall not involved
3. **Session end:** `relay deposit` → optionally write session learnings to InstantRecall for cross-project personal memory
4. **Orchestrator:** Can query both Context Core (project) and InstantRecall (personal patterns)

### Key Decisions from This Analysis

| # | Decision | Rationale |
|---|----------|-----------|
| 11 | Lift `encryption.ts` directly into `@relay/core` | Proven AES-256-GCM pattern, no changes needed |
| 12 | Extract shared embedding function | Both systems use same model/dims — avoid duplication |
| 13 | Keep pgvector for Relay, don't migrate to Pinecone | Co-location benefits outweigh Pinecone's managed scale. Phase 1 is <10K vectors |
| 14 | Extract glass components to `@tensorpunk/ui` | Shared design system across InstantRecall + Relay + AgentDashboard |
| 15 | Use InstantRecall's Stripe pattern as Phase 2 billing template | Production-proven, handles edge cases (lazy init, webhook idempotency) |
| 16 | InstantRecall chunking (none) is insufficient for Relay | Relay CONTEXT.md files need section-level or paragraph-level chunking for quality retrieval |

### Open Integration Questions

| # | Question | Notes |
|---|----------|-------|
| 9 | Should InstantRecall get a Relay-compatible API endpoint? | A `/api/relay/query` that returns data in Relay context package format would simplify integration |
| 10 | When does the `@tensorpunk/ui` extraction happen? | Before Phase 3 frontend work. Could be a pre-scaffold task |
| 11 | Does the shared embedding function live in `@relay/core` or a separate `@tensorpunk/embeddings` package? | If InstantRecall also imports it, it should be independent of Relay |

---

*Updated 2026-04-03: Added Section 8 — InstantRecall integration notes from deep codebase analysis.*
