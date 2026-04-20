# Contributing to Relay

Thanks for your interest in contributing. Relay is an early-stage open implementation of the Agentic Protocol, and small, well-scoped contributions are the easiest to merge.

## Before you start

If you're proposing a non-trivial change — a new storage adapter, a protocol extension, a new CLI command, a breaking schema change — **open an issue first** and describe the motivation and shape of the change. That gives maintainers a chance to flag scope or direction concerns before you write code.

Small fixes (typos, bug fixes, docs improvements, test coverage) can go straight to a PR.

## Dev Setup

### Prerequisites

- Node.js 20+
- pnpm 9+

### Install and build

```bash
git clone https://github.com/tensorpunk-labs/relay.git
cd relay
pnpm install
pnpm build
```

### Environment

```bash
cp .env.example .env
# Configure for local development — SQLite needs no credentials;
# Supabase needs SUPABASE_URL + SUPABASE_ANON_KEY.
```

### Run the CLI locally

```bash
node packages/cli/dist/index.js --help
```

Linking it as a global `relay` command is convenient but optional:

```bash
pnpm --filter @relay/cli link --global
```

## Project Layout

Relay is a pnpm monorepo:

| Package | Role |
|---------|------|
| `@relay/core` | Types, client, package builder, storage interface. Most business logic lives here. |
| `@relay/cli` | Thin commander.js wrapper over core. |
| `@relay/mcp` | MCP server exposing core operations as tools. |
| `@relay/api` | Vercel Edge Functions. Thin HTTP wrapper over core. |
| `@relay/orchestrator` | Context assembler. |
| `@relay/storage-sqlite` | SQLite storage adapter. |
| `apps/web` | Next.js dashboard. |

### Architectural rule of thumb

**Add functionality to `@relay/core` first; surface it through the wrappers.** If a feature lives in both the CLI and the MCP server, it belongs in core.

## Build Commands

```bash
pnpm build                           # Build all packages
pnpm --filter @relay/core build      # Build one package
pnpm --filter @relay/cli dev         # Watch mode for a package
pnpm lint                            # Lint all packages
pnpm test                            # Run test suites
```

Individual packages may define their own scripts; check each `package.json`.

## Testing

- Unit tests live alongside source as `*.test.ts`.
- Integration tests that touch a real backend are gated on env vars — keep them isolated from unit runs.
- Benchmarks live in `benchmarks/` and are not part of CI.

New features should include tests. Bug fixes should include a regression test that fails on `main` and passes on the fix.

## Pull Requests

### Conventions

- Target `main`.
- Keep PRs focused: one logical change per PR. Prefer stacking small PRs over one giant one.
- Write commit messages in imperative mood: `add SQLite adapter`, not `added` or `adds`.
- Reference the issue number if one exists: `fix: handle empty deposit (#42)`.

### What reviewers look for

1. **Scope.** Does the PR do what its description says, and nothing more?
2. **Tests.** Is the new behavior covered? Does the regression test actually fail without the fix?
3. **Types.** No `any` escape hatches without a comment explaining why.
4. **Protocol fidelity.** If the change touches package shape, wire format, or storage contract, does it match the spec? If the spec needs to change, is that called out?
5. **Docs.** If you add a CLI command, MCP tool, or config key, did the README or relevant doc get updated?

### Before submitting

```bash
pnpm build
pnpm lint
pnpm test
```

If any of those fail locally, CI will fail too. Fix locally first.

## Code Style

- TypeScript, strict mode.
- Prefer named exports over default exports.
- Prefer small, composable functions over classes when the state is trivial.
- No dead code. Remove, don't comment out.
- Avoid adding comments that restate what the code already says. Comment only when the reason for a choice wouldn't be obvious to a reader six months from now.

Formatting is handled by Prettier / the project's lint config. Run `pnpm lint --fix` before submitting.

## Protocol Changes

Changes to the Agentic Protocol (the wire format, interaction model, or conformance requirements) are higher-stakes than changes to the implementation. They affect any other tool that implements the protocol.

Process:

1. Open an issue describing the proposed change and the motivation.
2. If the direction is agreed, update `docs/AGENTIC_PROTOCOL.md` in the same PR as the implementation change. Both must land together.
3. Bump the protocol version if the change is not backward-compatible.

Small clarifications and non-normative edits to the spec are fine in standalone doc PRs.

## Using Relay While You Develop

If you're developing against an agent that has Relay's MCP server registered, you can use `relay deposit` during development to leave context for the next session:

```bash
relay deposit --title "WIP: new adapter interface" \
              --handoff "Next: finalize error shape, add retries, write migration test"
```

This is how we dogfood the protocol. It isn't required for contributing.

## Reporting Bugs

Open an issue with:

- Relay version (from `relay --version`) and Node.js version.
- A minimal reproduction — the smallest sequence of commands or code that reproduces the bug.
- Expected vs. actual behavior.
- Relevant logs or stack traces.

For security-sensitive reports, do not open a public issue. Contact the maintainers directly.

## Code of Conduct

Be kind, assume good faith, and focus feedback on the code, not the person. We'll add a formal code of conduct if and when the community grows to need one.

## License

By contributing, you agree that your contributions will be licensed under the [Business Source License 1.1](LICENSE), which converts to Apache License, Version 2.0 on the Change Date specified in the license.
