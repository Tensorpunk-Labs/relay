# Relay

> ### ⭐ #1 on LongMemEval retrieval
>
> | Metric | Score |
> |---|---|
> | **Oracle** recall@5 | **100.0%** (500/500) — highest published |
> | **S-variant** recall@5 | **97.0%** (485/500) — highest published |
> | **Oracle** end-to-end QA | **92.2%** (461/500, GPT-4o judge) |
> | **S-variant** end-to-end QA | **84.8%** (424/500, GPT-4o judge) |
>
> Full methodology, comparison table, and how to reproduce: [relaymemory.com/benchmarks](https://relaymemory.com/benchmarks) · harness in [`benchmarks/longmemeval/`](benchmarks/longmemeval/).

**Relay is the reference implementation of the [Agentic Protocol](docs/AGENTIC_PROTOCOL.md) — an open specification for how humans and AI agents exchange enriched context across sessions, tools, and vendors.**

When you finish a coding session, the context you built up — decisions made, dead-ends ruled out, the reasoning behind a choice — lives in your head and your chat log. The next session (yours or another agent's) starts cold. Relay fixes that: every session can deposit a structured context package on exit, and any future session can pull the latest state to start oriented.

## What is Relay?

Modern AI-assisted work is fragmented across sessions, tools, and agents. Each conversation is an island. Context that took hours to build gets lost the moment a session ends, or lives trapped inside one tool's memory, unreadable by another.

Relay treats context as a first-class artifact. A **context package** is a signed, structured record of what happened in a session: decisions made, open questions, files changed, a handoff note for whoever picks up next. Packages are stored in a local SQLite database you own, indexed for search, and exposed through a CLI, an MCP server, and a protocol that any agent vendor can implement.

The underlying protocol — the Agentic Protocol — is vendor-neutral. Relay is one implementation; others are welcome. The spec is in [`docs/AGENTIC_PROTOCOL.md`](docs/AGENTIC_PROTOCOL.md) and at [relaymemory.com/protocol/](https://relaymemory.com/protocol/).

## Install with Claude Code

If you have Claude Code, paste the prompt below into any session and let the agent set things up. It will clone the repo, build the CLI, link it globally, configure local SQLite storage, install the `using-relay` skill, register the MCP server, and verify it works.

```
I want to set up Relay on this machine. Its public repo is
https://github.com/tensorpunk-labs/relay.

Please:
  1. Clone it as a sibling directory of this repo.
  2. Run `pnpm install && pnpm build` inside it.
  3. Link the CLI globally: `pnpm --filter @relay/cli link --global`.
  4. Configure local SQLite storage and set my actor identity:
     `relay config set storage sqlite`
     `relay config set actor-id <me>`
     `relay config set actor-type human`
  5. Install the using-relay skill: copy `skills/using-relay/` into
     `~/.claude/skills/`.
  6. Register the MCP server in my Claude Code config so the agent
     can deposit and pull context directly. The entry point is
     `packages/mcp/dist/index.js` inside the cloned relay repo.
  7. Verify the setup with `relay projects list` and `relay --version`.

If any step fails, stop and tell me what went wrong before continuing.
```

After Claude Code finishes, restart it so the new skill and MCP server register, then ask it to deposit or pull context — the skill takes it from there.

## Manual Install

If you'd rather install by hand (or you're not using Claude Code), the steps below cover the same ground.

### Prerequisites

- Node.js 20+
- pnpm 9+

### Build

```bash
git clone https://github.com/tensorpunk-labs/relay.git
cd relay
pnpm install
pnpm build
```

### Configure

```bash
node packages/cli/dist/index.js config set storage sqlite
node packages/cli/dist/index.js config set actor-id "your-actor-id"
node packages/cli/dist/index.js config set actor-type human
```

Linking the CLI globally is optional but convenient:

```bash
pnpm --filter @relay/cli link --global
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

### Register the MCP server

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
├── docs/                # Protocol spec, architecture
├── skills/              # Optional Claude Code skills (opt-in install)
└── benchmarks/
    └── longmemeval/     # Retrieval quality benchmarks
```

### Claude Code skill (optional)

There's an opt-in skill in [`skills/using-relay/`](skills/using-relay/) that teaches the agent how to use the CLI + MCP tools — deposit proactively, pull context at session start, orient against prior sessions. Install it by copying the skill folder into `~/.claude/skills/` (see [`skills/README.md`](skills/README.md) for details). It's not required — the MCP server alone already gives agents full access.

Prefer always-on guidance over on-demand? Paste the [CLAUDE.md snippet](docs/CLAUDE_MD_SNIPPET.md) into your own global or project `CLAUDE.md` and every Claude Code session will boot oriented through Relay.

### Dashboard

`apps/web` is a Next.js dashboard for browsing context packages, project health, and session timelines. Run it locally with `pnpm --filter @relay/web dev`. It reads from the same storage backend your CLI and MCP server use.

### Storage

Relay ships with a SQLite adapter — local, zero-setup, per-install DB file. The adapter interface is in `packages/core/src/storage/`. Additional adapters (Postgres, in-memory for tests, managed hosted) are possible without changing the protocol; reach out if you need one.

## Read the Protocol Spec

The Agentic Protocol is the ground truth. Read it before proposing protocol changes:

- Full spec: [`docs/AGENTIC_PROTOCOL.md`](docs/AGENTIC_PROTOCOL.md)
- Rendered: [relaymemory.com/protocol/](https://relaymemory.com/protocol/)

Topics covered: wire format, interaction model, transport, storage independence, conformance, extensions, comparison to related work.

## Benchmarks

Relay leads retrieval on **LongMemEval**, the broadest public benchmark for long-context conversational memory. Numbers at the top of this README; full methodology, comparison table (vs MemPalace, AgentMemory, OMEGA), and reproduction steps at [relaymemory.com/benchmarks](https://relaymemory.com/benchmarks).

The harness lives in [`benchmarks/longmemeval/`](benchmarks/longmemeval/). Retrieval uses hybrid BM25 + semantic embeddings (local MiniLM-L6, zero API cost) with a cross-encoder reranker and gradient time-windowing. QA generation is Claude Opus 4.6; QA accuracy is graded by an independent GPT-4o judge — no self-grading. Raw result files from our runs are checked in under `benchmarks/longmemeval/`.

```bash
cd benchmarks/longmemeval
pnpm install
pnpm run fetch:data                              # download the public corpus
pnpm run bench -- --dataset oracle --topK 5     # retrieval
pnpm run qa    -- --dataset oracle              # end-to-end QA (needs OPENAI_API_KEY for the judge)
```

If you re-run and get different numbers, open an issue.

## Contributing

Contributions welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, project layout, build commands, PR conventions, and code style.

The repo is a pnpm monorepo. Business logic lives in `@relay/core`; CLI, MCP, and API packages are thin wrappers. When adding a feature, start in `@relay/core` and surface it through the appropriate wrapper.

## License

Relay is licensed under the [Business Source License 1.1](LICENSE). The Change Date is **2030-04-18**, on which the license automatically converts to **Apache License, Version 2.0**. Until then, production use is permitted for any purpose except offering a hosted or managed service based substantially on Relay that competes commercially with a hosted Relay service.

For alternative licensing arrangements or custom integrations, contact Tensorpunk Labs at `contact@tensorpunk.com`.

## Learn More

- Website: [relaymemory.com](https://relaymemory.com)
- Protocol: [relaymemory.com/protocol/](https://relaymemory.com/protocol/)
- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

Relay is built by [Tensorpunk Labs](https://tensorpunk.com).
