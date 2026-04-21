# Relay

**Relay is the reference implementation of the [Agentic Protocol](docs/AGENTIC_PROTOCOL.md) — an open specification for how humans and AI agents exchange enriched context across sessions, tools, and vendors.**

When you finish a coding session, the context you built up — decisions made, dead-ends ruled out, the reasoning behind a choice — lives in your head and your chat log. The next session (yours or another agent's) starts cold. Relay fixes that: every session can deposit a structured context package on exit, and any future session can pull the latest state to start oriented.

## What is Relay?

Modern AI-assisted work is fragmented across sessions, tools, and agents. Each conversation is an island. Context that took hours to build gets lost the moment a session ends, or lives trapped inside one tool's memory, unreadable by another.

Relay treats context as a first-class artifact. A **context package** is a signed, structured record of what happened in a session: decisions made, open questions, files changed, a handoff note for whoever picks up next. Packages are stored in a backend you control (local SQLite or Supabase), indexed for search, and exposed through a CLI, an MCP server, and a protocol that any agent vendor can implement.

The underlying protocol — the Agentic Protocol — is vendor-neutral. Relay is one implementation; others are welcome. The spec is in [`docs/AGENTIC_PROTOCOL.md`](docs/AGENTIC_PROTOCOL.md) and at [relaymemory.com/protocol/](https://relaymemory.com/protocol/).

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Either SQLite (built-in, zero-setup) or a Supabase project

### Install

```bash
git clone https://github.com/tensorpunk-labs/relay.git
cd relay
pnpm install
pnpm build
```

### Configure

```bash
cp .env.example .env
# Edit .env with your backend credentials:
# - For SQLite: no credentials needed
# - For Supabase: SUPABASE_URL, SUPABASE_ANON_KEY
```

Initialize your local config:

```bash
node packages/cli/dist/index.js config set actor-id "your-actor-id"
node packages/cli/dist/index.js config set actor-type human
node packages/cli/dist/index.js config set storage sqlite   # or supabase
```

### Try the core loop

```bash
# Start a tracked session on a project
relay session start --project proj_example

# Deposit context at any point
relay deposit --title "Initial exploration" \
              --handoff "Read the README, next step is to wire up MCP"

# Check project status
relay status

# Pull the latest context into a fresh session
relay pull --latest
```

### Register the MCP server (optional)

If you use an MCP-capable agent (Claude Code, etc.), register the Relay MCP server so the agent can deposit and pull context directly:

```json
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["/path/to/relay/packages/mcp/dist/index.js"]
    }
  }
}
```

The MCP server exposes `relay_session_start`, `relay_pull_context`, `relay_deposit`, `relay_status`, and `relay_orchestrate` as tools.

## Project Structure

```
relay/
├── packages/
│   ├── core/            # Shared types, client, package builder
│   ├── cli/             # `relay` CLI (commander.js)
│   ├── mcp/             # MCP server for agents
│   ├── api/             # Vercel Edge Functions
│   ├── orchestrator/    # Context assembler (RAG-capable)
│   └── storage-sqlite/  # SQLite storage adapter
├── apps/
│   └── web/             # Next.js dashboard
├── supabase/
│   └── migrations/      # Postgres + pgvector schema
├── docs/                # Protocol spec, architecture, roadmap
├── skills/              # Optional Claude Code skills (opt-in install)
├── benchmarks/
│   └── longmemeval/     # Retrieval quality benchmarks
└── scripts/             # Tooling (export, backup, backfill)
```

### Claude Code skill (optional)

If you use Claude Code, there's an opt-in skill in [`skills/using-relay/`](skills/using-relay/) that teaches the agent how to use the CLI + MCP tools — deposit proactively, pull context at session start, orient against prior sessions. Install it by copying the skill folder into `~/.claude/skills/` (see [`skills/README.md`](skills/README.md) for details). It's not required — the MCP server alone already gives agents full access.

### Storage adapters

Relay separates the protocol from the backend. Two adapters ship today:

- **SQLite** — local, zero-setup, per-project DB file. Good for solo use.
- **Supabase** — Postgres + pgvector + storage. Good for multi-actor teams and large deposit volumes.

The adapter interface is in `packages/core/src/storage/`. New adapters (remote Postgres, object storage, in-memory for tests) can be added without changing the protocol.

## Read the Protocol Spec

The Agentic Protocol is the ground truth. Read it before proposing protocol changes:

- Full spec: [`docs/AGENTIC_PROTOCOL.md`](docs/AGENTIC_PROTOCOL.md)
- Rendered: [relaymemory.com/protocol/](https://relaymemory.com/protocol/)

Topics covered: wire format, interaction model, transport, storage independence, conformance, extensions, comparison to related work.

## Benchmarks

Retrieval quality is tracked in [`benchmarks/longmemeval/`](benchmarks/longmemeval/). The harness runs LongMemEval-style prompts against a seeded Relay instance and reports Recall@k. Current targets and methodology are documented in the benchmark README.

## Contributing

Contributions welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, project layout, build commands, PR conventions, and code style.

The repo is a pnpm monorepo. Business logic lives in `@relay/core`; CLI, MCP, and API packages are thin wrappers. When adding a feature, start in `@relay/core` and surface it through the appropriate wrapper.

## License

Relay is licensed under the [Business Source License 1.1](LICENSE). The Change Date is **2030-04-18**, on which the license automatically converts to **Apache License, Version 2.0**. Until then, production use is permitted for any purpose except offering a hosted or managed service based substantially on Relay that competes commercially with a hosted Relay service.

For alternative licensing arrangements, contact Tensorpunk Labs.

## Learn More

- Website: [relaymemory.com](https://relaymemory.com)
- Protocol: [relaymemory.com/protocol/](https://relaymemory.com/protocol/)
- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Roadmap: [`docs/V02_ROADMAP.md`](docs/V02_ROADMAP.md)

---

Relay is built by [Tensorpunk Labs](https://tensorpunk.com).
