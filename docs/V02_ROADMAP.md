# Relay v0.2 Roadmap

**Status:** ✅ **Shipped** (2026-04-18 → 2026-04-19). All three sessions merged to `main`.

| Session | Scope | Merge commit |
|---|---|---|
| A | `RelayStorage` widened + `SupabaseStorage` extracted | `83b57bf` |
| B | `RestoreService` + `relay restore` | `327dfe5` |
| C | `SqliteStorage` + `relay sync` | `3b24174` |

Full portability proof: Supabase `relay backup` → `relay restore --to sqlite:///…` → `relay backup` from SQLite → NDJSON counts match. Two independently-implemented adapters round-trip the portable backup format.

**Context:** Originally items deferred from the v0.1 protocol launch. Captured so nothing is lost when today's shipping pace accelerates.

---

## Storage Layer — Full Adapter Refactor (Option A)

v0.1 ships the `RelayStorage` interface as the type contract the protocol references, with `BackupService` as the first concrete consumer. **`RelayClient` keeps its current internals — Supabase calls are not yet routed through the adapter.**

**v0.2 completes the refactor:**
- Create `packages/core/src/storage/supabase.ts` exporting `class SupabaseStorage implements RelayStorage`
- Move all 22 `this.supabase.{from,rpc,storage}` call sites from `client.ts` onto `SupabaseStorage`
- Port `embeddings.ts` to accept `storage: RelayStorage` instead of raw `SupabaseClient`
- Swap `RelayClient` constructor to accept either a `RelayStorage` instance or build one from config (backward-compat)
- Rename `RelayConfig.core_url`/`api_key` to accept `storage_url`/`storage_key` (old names still work)

**Acceptance:** `grep -r "@supabase/supabase-js" packages/core/src/` returns only `packages/core/src/storage/supabase.ts`. Every other file in `core/` is storage-agnostic.

**Risk window:** This refactor is invasive. Do it on a branch, test against a live DB as a read-only dry-run first, then ship.

---

## `relay restore` Command

Deferred because shipping a broken restore damages the portability claim worse than not shipping one.

**Design decisions needed before implementation:**
- **ID collision policy:** on `package_id` conflict, skip / overwrite / rename with suffix? Propose: skip-by-default, `--overwrite` flag.
- **FK ordering:** projects → packages → facts → embeddings → sessions. Strict ordering; fail-fast on missing parent.
- **Fact replay semantics:** re-assert current facts or replay the full supersession chain? Propose: replay full chain to preserve temporal history.
- **Partial restore:** allow `--only-packages` / `--since <iso>` / `--project <id>`? Propose: yes, for incremental sync use cases.
- **Dry-run flag:** ship `relay restore --dry-run --from <path>` as a validation utility in v0.1.1 before the full command lands in v0.2.

**Signature (target):**
```
relay restore --from <path> [--project <id>] [--overwrite] [--dry-run] [--since <iso>]
```

---

## SQLite Storage Adapter

Second reference implementation. Proves the adapter interface is real, not aspirational.

- New package `packages/storage-sqlite/` implementing `RelayStorage` against `better-sqlite3`
- Schema migration from the existing `supabase/migrations/*.sql` adapted to SQLite syntax
- Capability descriptor: `{ hybridSearch: false, semanticSearch: false, realtime: false }` — FTS5 can come later
- Usage: `relay config set storage sqlite:///absolute/path/to/relay.db`

**Target users:** self-hosters, air-gapped environments, "try Relay without signing up for Supabase."

---

## `relay sync` Command

Pull/push context packages between two conformant implementations.

**Use cases:**
- Backup-restore between Supabase and local SQLite
- Multi-device dev (laptop ↔ desktop for the same operator)
- Team mirror (public read-only replica synced from private authoritative store)

**Signature (target):**
```
relay sync --from <source> --to <target> [--project <id>] [--since <iso>] [--watch]
```

Depends on restore landing first.

---

## Resolved Open Questions (to close before v0.2 ships)

From the v0.1 backup-planning investigation, five design questions remain open. Each needs a decision before the corresponding v0.2 feature ships.

1. **Blob storage shape in the adapter.** Opaque key-value (`putBlob(key, body)`) or structured path (`putBlob(projectId, packageId, body)`)? Current v0.1 code passes a pre-built path string. Propose: opaque k-v, adapter owns the bucket/folder layout internally.

2. **Search fallback behavior when capability is missing.** A SQLite adapter without FTS/vector support encounters `relay pull --mode relevant`. Hard error (`StorageCapabilityError`) or soft fallback to latest-by-title-substring? Propose: hard error with a helpful message pointing to `--mode latest`.

3. **Embedding format in backup.** Backup writes raw vectors (binds consumer to same embedding model) or source text only (consumer re-embeds)? Propose: source text by default, `--include-vectors` opt-in for lossless archival.

4. **All-projects backup from an unmapped CWD.** `relay backup --all-projects` from `~` — back up everything the actor has access to, or refuse? Propose: refuse by default, require `--confirm-all` to protect against accidents. Multi-tenant Relay Core (post-Phase-1) will change this answer when access scoping exists.

5. **Version fields in `manifest.json`.** Protocol version (inherited from each package's `relay_version: "0.1"`) and backup-format version can drift independently. Propose: emit both as separate top-level fields (`protocol_version`, `backup_format_version`).

---

## Tracking

When a v0.2 item lands, move the section to a closed-items appendix and reference the PR/commit that closed it.
