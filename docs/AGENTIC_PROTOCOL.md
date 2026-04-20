# The Agentic Protocol

**Version:** 0.1 (Draft)
**Status:** Active Design — Reference Implementation Shipping
**Audience:** Agent framework authors, memory system vendors, AI platform engineers, anyone building tools that need to exchange context across sessions, tools, and vendors.

---

## Abstract

The Agentic Protocol is an open specification for how AI agents and humans exchange enriched context across sessions, tools, and vendors. It defines:

1. A **wire format** — the Context Package, an immutable, portable, signed record of work done and decisions made.
2. A **mutable state format** — the Fact, a temporally-tracked subject/predicate/value triple.
3. An **interaction model** — the operations (deposit, pull, orient, orchestrate, flag-for-review, assert-fact, invalidate-fact) that define how actors exchange context.
4. A **conformance model** — four levels of implementation completeness (L0 read-only → L3 review-aware) that let tools declare and verify compatibility.

The protocol is storage-agnostic, transport-friendly (HTTPS + JSON), and vendor-neutral. A conformant implementation can be backed by Postgres, SQLite, flat files, or any store that preserves package immutability and temporal ordering. The reference implementation is Relay.

This document specifies the protocol. It does not specify *an implementation* beyond the reference.

---

## 1. The Problem

Agents are amnesiac.

Every time a Claude Code session starts, an agent wakes up knowing nothing of what the previous session did. Every time a user switches from one AI tool to another — Claude to GPT-4 to Cursor to Windsurf — the context that accumulated in the first tool is trapped there. Every time a team runs multiple agents in parallel, each one operates in isolation, re-learning the same project over and over.

The industry's answer has been *memory*. Every major AI platform is shipping a memory system: ChatGPT memory, Claude Projects, countless startups with vector databases and RAG pipelines and agent frameworks with "long-term memory" features.

But these memory systems share three structural problems:

**They're vendor-locked.** Memory created in Claude cannot be read by GPT-4. Memory stored in LangGraph cannot be consumed by AutoGen. Memory embedded in a commercial product is lost when you leave the product. The memory is *owned by the tool*, not the user or the work.

**They're keyword-thin.** Most "memory" systems are a search-augmented chat history: a blob of text, embedded, retrieved by semantic similarity. They don't capture the *structure* of a decision — what was ruled out, what's still open, who made the call, what the handoff note should be. They're transcript lookups dressed up as cognition.

**They're individual-scoped.** Memory systems remember what *you* talked about with the agent. They don't remember what *another agent* did on the same project. They don't integrate across sessions. They don't produce a single, queryable, auditable shared record of what the collective knows.

The result: an agentic ecosystem where every tool reimplements memory, every vendor locks its customers' context inside its product, and every new session starts cold.

This is the state HTTP was in before 1991 — every system had its own way of exchanging structured information, and nothing composed. The Agentic Protocol is the attempt to define the layer below the tools.

---

## 2. The Idea

Three claims make this protocol possible.

### Claim 1: Context is the unit, not the task.

A task is an instruction ("fix the login bug"). Context is an instruction *plus* everything a downstream actor needs to execute it intelligently: what was tried, what was ruled out, what's still open, what the user actually wants beyond the literal request. A task can be a row in a ticketing system. Context needs its own data model.

The atomic unit of the Agentic Protocol is the **Context Package** — an immutable record created when an actor finishes a meaningful chunk of work. It carries a title, a description, decisions made, open questions, a handoff note, deliverables, provenance (who, when, which session, which git commit), and an optional payload. It is content-addressable (hash-identified), vendor-neutral (plain JSON), and portable (any conformant implementation can read any package).

### Claim 2: Agents are first-class actors, not helpers.

In most AI tooling, humans are the worker and agents assist. In the Agentic Protocol, actors are actors. A human deposits context. An agent deposits context. A scheduled script deposits context. The protocol doesn't care which — it cares about *what* is deposited and *how* it flows. An `actor_type` field on every package identifies the kind of actor, but the data model treats them uniformly.

This isn't ideology. It's operational. Once you build systems where agents run autonomously for hours, produce thousands of context artifacts, and hand off to each other or to humans at explicit checkpoints, you need a protocol that treats them as peers, not subordinates.

### Claim 3: The collective is the thing being engineered.

The north-star question for the protocol is: *does a team running on it produce insights, decisions, and outcomes that none of its individual members — human or agent — could have produced alone?*

Individual productivity gains are a side effect. What the protocol is actually engineering is the substrate where a group of humans and agents can function as a single, progressively smarter organism over time. Shared memory, shared state, shared reasoning trail. The protocol doesn't make any one actor faster. It makes the *whole* capable of things no single actor could do.

---

## 3. Design Principles

The protocol is governed by six principles. When a design decision conflicts, the principle listed higher wins.

### P1. Vendor-neutral by construction

No part of the wire format, interaction model, or conformance spec references a specific database, LLM, framework, or vendor. An implementation backed by Postgres with pgvector is valid. An implementation backed by SQLite with plain-text search is valid. An implementation that writes NDJSON files to a folder and greps them is valid. The protocol is the invariant; storage, search, and compute are implementation details.

### P2. Immutability of packages, mutability of facts

Context Packages are immutable once committed. They record what happened. Changing history is forbidden; corrections are made by depositing a new package that references the old one. This guarantees a straight-line audit trail — useful for both agent self-correction and human trust.

Facts — typed subject/predicate/value triples that represent the *current* state of things — are mutable. A fact has a `valid_from` timestamp; when it becomes stale, it gets an explicit `valid_to` and a new fact supersedes it. The history is retained; the "current" state is computable.

The invariant is: **packages record events, facts record state.** Never conflate them.

### P3. Pull-based and async by default

The protocol does not require synchronous coordination. An actor deposits context when work is ready to hand off; a downstream actor pulls context when it's ready to begin. There is no sprint, no standup, no forced cadence. Urgency is surfaced through explicit signals (open questions, review flags, handoff notes), not through calendar pressure.

### P4. Transparent reasoning

Every package carries natural-language reasoning: why a decision was made, what was ruled out, what's still uncertain. This is not a nice-to-have — it's load-bearing for three things:
- Downstream actors (human or agent) making informed follow-ons.
- Audit trails that humans can read without an intermediary translator.
- Reasoning-based security: the same capability that lets an AI attacker find vulnerabilities lets the defender reason about whether context has been manipulated. (See the Antibody immune-system concept for more.)

### P5. Human checkpoints are explicit

Humans are not the default actor with agents as helpers. Humans are *decision gates*, declared in advance, placed at specific nodes in the work graph. When human judgment is needed, the protocol marks that explicitly — via `review_type` on a package, or a `flag-for-review` operation — so agents know not to proceed and humans know their attention is actually required.

### P6. The protocol is invisible in the happy path

The best infrastructure disappears. A developer using a conformant tool should rarely need to think about the protocol. They deposit when they finish something meaningful, they pull when they start something new, and the rest (embeddings, search, synthesis, provenance) happens below their awareness. The protocol earns its keep only when it's not in the way.

---

## 4. Terminology

The following terms have specific meanings throughout this document:

- **Actor** — any entity that can deposit or pull context. Has an `actor_id` and `actor_type` (`human`, `agent`, `script`). Actors are identified but not authenticated by the protocol itself; authentication is a transport concern.
- **Project** — a bounded context scope. All packages and facts belong to exactly one project. Projects are the unit of access control, archival, and backup.
- **Context Package** — the atomic unit of deposited context. Immutable once committed. See §6.
- **Fact** — a mutable typed triple representing current state. See §7.
- **Deposit** — the operation of writing a new Context Package. See §8.1.
- **Pull** — the operation of reading one or more Context Packages. See §8.2.
- **Handoff** — the implicit or explicit signal that one actor is passing work to the next. Carried in the `handoff_note` field of a package or by a dedicated `handoff` package type.
- **Conformant Implementation** — a system that satisfies the MUST requirements of at least Conformance Level L0 (§11).

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used with their RFC 2119 meanings.

---

## 5. Core Concepts

The protocol defines four data types (Project, Context Package, Fact, Session) and a small set of operations over them. This section describes how they compose. Exact wire schemas are in §6–§7; operation semantics are in §8.

### 5.1 Packages are events; facts are state

The central design choice of the protocol is the split between **events** (packages) and **state** (facts).

- A **Context Package** records that *something happened*. "I decided X." "I finished Y." "I have a question about Z." Packages are immutable. The log of packages in a project is a straight-line append-only record of what the collective has done.
- A **Fact** records that *something is currently true*. "The current retrieval score is 97%." "The landing page is live at relaymemory.com." Facts are mutable — more precisely, they are *superseded* over time. To change a fact, the current one is marked ended and a new one is inserted. The history is retained.

This split resolves a problem that transcript-based memory systems cannot: how to distinguish "what we know now" from "what we thought we knew six deposits ago." The former is a fact query; the latter is a package log query. A transcript collapses both into one stream and forces downstream consumers to re-derive state on every read.

### 5.2 Projects bound scope

Every package and every fact belongs to exactly one project. A project is:

- The unit of **archival** (`archived_at` timestamp; reversible soft delete).
- The unit of **backup/export** — implementations MUST be able to serialize an entire project to and from the wire format.
- The unit of **access control** when the transport supports it.
- A **namespace** — two projects MAY independently use the same fact `subject` without collision.

Cross-project references are **out of scope for v0.1**. A package SHOULD NOT reference packages in other projects by ID. Implementations MAY support cross-project linking but the protocol does not yet define the semantics; v0.2 or later will address this.

### 5.3 Package lifecycle

A package exists in one of four states:

| Status | Meaning | Allowed next states |
|--------|---------|---------------------|
| `draft` | Work in progress. Visible to the creating actor but SHOULD be excluded from orchestrator digests. | `complete`, `awaiting_review` |
| `awaiting_review` | Blocked on a reviewer (human or agent) per `review_type`. | `complete`, `revision_requested` |
| `revision_requested` | Reviewer returned changes required. | `awaiting_review`, `complete` |
| `complete` | Finalized. Terminal state. | (none) |

A conformant implementation MUST reject any state transition from `complete`. Corrections to a completed package are made by depositing a **new** package that references the old via `parent_package_id`.

Most packages skip `draft` and `awaiting_review` entirely and are created with `status: complete`. Draft and review states are for teams that want an explicit checkpoint model; single-user or autonomous-agent flows typically don't need them.

### 5.4 Actor identity

An actor is identified by the tuple `(actor_id, actor_type)`. The protocol does not authenticate actors — that is a transport-layer concern (§9). No uniqueness constraints across actor_id are enforced; a project MAY have multiple humans with the same first name and distinguish them however the implementation chooses.

Every package's `created_by` field records `{id, type, session_id?}` and this attribution is part of the content hash — altering attribution invalidates the hash.

### 5.5 Sessions (optional)

A **Session** groups packages produced by a single actor in a single continuous work period. Sessions are OPTIONAL. An implementation MAY omit sessions entirely if its actor model is stateless.

When present, a Session carries:

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | Implementation-generated. |
| `project_id` | string | The scope of the session. |
| `actor_id` | string | The producing actor. |
| `actor_type` | enum | Actor kind. |
| `started_at` | string (RFC 3339) | UTC start. |
| `ended_at` | string (RFC 3339) \| null | UTC end; null while active. |
| `packages_deposited` | string[] | Package IDs produced in this session. |

Sessions enable provenance queries ("what did this agent do during this session?") and are useful for replay and audit. They are not required for basic conformance.

### 5.6 Handoff semantics

A handoff is an explicit signal that one actor is passing work to another. It is represented in one of two ways:

1. **As a field** on any package: `handoff_note` (string) carries the guidance for the next actor. This is the common case.
2. **As a package type** `handoff`: the package's primary purpose *is* the transfer. Use when the handoff itself is the significant artifact.

Handoffs MAY specify `estimated_next_actor: "human" | "agent"` to hint who should pick up. This is advisory — the protocol does not assign work; it publishes availability.

---

## 6. Wire Format — Context Package

A Context Package is a JSON object. Every conformant implementation MUST serialize and deserialize packages per this schema exactly. Unknown fields MUST be preserved on read and round-tripped on write (enables forward compatibility — see §12).

### 6.1 Required fields

| Field | Type | Constraint |
|-------|------|------------|
| `package_id` | string | Globally unique. Format `pkg_<32-char-hex>` is RECOMMENDED; any string unique within the project MUST be accepted. |
| `project_id` | string | The owning project's ID. |
| `relay_version` | string | Protocol version. MUST be `"0.1"` for this document. |
| `title` | string | 1–200 characters. Human-readable summary. |
| `status` | enum | One of `draft`, `complete`, `awaiting_review`, `revision_requested`. |
| `package_type` | enum | See 6.3. |
| `review_type` | enum | One of `none`, `human`, `agent`. |
| `created_at` | string | RFC 3339 UTC timestamp. |
| `created_by` | object | See 6.2. |

### 6.2 The `created_by` object

```json
{
  "id": "jordan",
  "type": "human",
  "session_id": "sess_abc123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | MUST | Actor identifier. |
| `type` | enum | MUST | One of `human`, `agent`, `script`. |
| `session_id` | string \| null | MAY | Non-null if the actor was operating within a session. |

### 6.3 The `package_type` enum

| Value | Semantics |
|-------|-----------|
| `standard` | Default. Generic context package. |
| `milestone` | Significant completion or event. |
| `decision` | Captures a specific decision with rationale. |
| `handoff` | Explicit transfer of work from one actor to another. |
| `auto_deposit` | Automatic deposit from a tool (e.g. git stop hook). Lower signal. |
| `analysis` | Analytical output, typically from a research or analysis agent. |
| `question` | Surfaces a question that must be answered before work proceeds. |
| `orchestrator_report` | Output of an orchestration pass across many packages. |

Implementations MAY define additional types in the `x-*` namespace (see §12). They MUST NOT define new values outside that namespace.

### 6.4 Optional core fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | string | `""` | Longer prose description. |
| `tags` | string[] | `[]` | Free-form labels. Implementations MAY index these. |
| `decisions_made` | string[] | `[]` | Structured list of decisions captured by this package. |
| `open_questions` | string[] | `[]` | Structured list of questions surfaced. |
| `handoff_note` | string | `""` | Guidance for the next actor. |
| `estimated_next_actor` | enum \| null | `null` | One of `human`, `agent`, `null`. Advisory. |
| `deliverables` | object[] | `[]` | See 6.5. |
| `parent_package_id` | string \| null | `null` | If this package supersedes or extends another, reference here. |
| `significance` | integer | `5` | 1–10. Implementations use this to filter digests. |
| `content_md` | string | `""` | Optional Markdown body. For packages whose "body" is prose. |
| `topic` | string \| null | `null` | Subject area tag (e.g. `"retrieval"`, `"dashboard"`). |
| `artifact_type` | string \| null | `null` | Narrower type hint beyond `package_type`. |
| `storage_path` | string \| null | `null` | Implementation-defined blob reference if deliverables are uploaded separately. |

### 6.5 The `deliverables` array

A deliverable is a reference to a concrete artifact the package produced or incorporates.

```json
{
  "path": "docs/AGENTIC_PROTOCOL.md",
  "type": "md",
  "hash": "sha256:abc123...",
  "size_bytes": 18432
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | MUST | Relative path within the project, or a URL. |
| `type` | string | MUST | File/content type hint (`md`, `json`, `ts`, `sql`, etc.). |
| `hash` | string | MAY | Content hash of the deliverable. Format: `<algo>:<hex>`. |
| `size_bytes` | integer | MAY | Size hint. |

### 6.6 Content addressing and immutability

A conformant implementation MUST compute a **content hash** over every package on commit:

- **Algorithm:** SHA-256 over a canonical JSON serialization of the package (keys sorted lexicographically, no whitespace, `null` fields omitted).
- **Storage:** the hash is stored alongside the package but is NOT part of the package JSON itself (to avoid self-reference).
- **Verification:** on read, an implementation MAY verify the stored hash against a freshly-computed one. Mismatches MUST be reported and SHOULD be quarantined.

Once committed, a package's fields MUST NOT change. Corrections are made by depositing a new package with `parent_package_id` pointing at the old one.

### 6.7 Example (minimal)

```json
{
  "package_id": "pkg_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
  "project_id": "proj_dev_relay",
  "relay_version": "0.1",
  "title": "Shipped archive/de-archive",
  "status": "complete",
  "package_type": "milestone",
  "review_type": "none",
  "created_at": "2026-04-18T20:00:00Z",
  "created_by": { "id": "jordan", "type": "human", "session_id": null },
  "tags": ["archive", "cli"],
  "decisions_made": ["Soft archive via archived_at timestamp"],
  "open_questions": [],
  "handoff_note": "Migration 009 applied, dashboard filter works."
}
```

---

## 7. Wire Format — Fact

A **Fact** is a typed triple representing a currently-true claim about a project. Facts are the mutable-state half of the protocol.

### 7.1 Required fields

| Field | Type | Constraint |
|-------|------|------------|
| `fact_id` | string | Globally unique. Format `fact_<32-char-hex>` is RECOMMENDED. |
| `project_id` | string | The owning project. |
| `subject` | string | The entity the fact is about. Free-form but SHOULD be stable (`"longmemeval_s"`, `"dashboard"`). |
| `predicate` | string | The property name (`"status"`, `"recall_any_at_5"`, `"deployed_at"`). |
| `value` | string | The value as a string. Numeric values MUST be serialized as strings to avoid type ambiguity across transports. |
| `valid_from` | string | RFC 3339 UTC. When this fact became true. |
| `created_at` | string | RFC 3339 UTC. When this fact was recorded. |

### 7.2 Optional fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `valid_to` | string \| null | `null` | RFC 3339 UTC. Non-null means this fact has been superseded. |
| `source_package_id` | string \| null | `null` | If this fact was asserted via a package, reference it here. |
| `confidence` | number | `1.0` | 0.0–1.0. Implementations MAY filter by confidence. |
| `asserted_by` | object | (copy of source package's `created_by`) | Actor attribution for the assertion. |
| `tags` | string[] | `[]` | Free-form labels. |

### 7.3 Supersession semantics

A fact is **current** iff `valid_to IS NULL`. To update a fact:

1. The previous current fact (matching `project_id + subject + predicate`) gets its `valid_to` set to the new fact's `valid_from`.
2. A new fact row is inserted with `valid_to: null`.

This is atomic from the caller's perspective — the supersession and the insert MUST either both succeed or both fail. A conformant implementation that lacks transactional atomicity MUST reject fact updates.

At query time, asking "what is the current value of (subject, predicate)?" returns the fact where `valid_to IS NULL`. Asking "what was the value on 2026-04-10?" returns the fact where `valid_from ≤ 2026-04-10 < valid_to` (treating null as +∞).

### 7.4 Invalidation

A fact can be **invalidated** without a replacement: set `valid_to` to now without inserting a new fact. This means "this fact used to be true; now no fact of this (subject, predicate) is asserted." Querying current value returns no row.

### 7.5 Example

```json
{
  "fact_id": "fact_ab12cd34ef56ab78cd90ef12ab34cd56",
  "project_id": "proj_dev_relay",
  "subject": "longmemeval_s",
  "predicate": "recall_any_at_5",
  "value": "97.0",
  "valid_from": "2026-04-10T12:00:00Z",
  "valid_to": null,
  "source_package_id": "pkg_7593a5b03fcc4706b181ea855e958e06",
  "confidence": 1.0,
  "asserted_by": { "id": "jordan", "type": "human", "session_id": null },
  "created_at": "2026-04-10T12:00:00Z",
  "tags": ["benchmark", "retrieval"]
}
```

---

## 8. Interaction Model

The protocol defines seven operations. Each operation has a name, required inputs, permitted outputs, and error conditions. Operations are transport-agnostic — §9 describes how they map to HTTP, but they MAY be offered over any transport that can convey JSON.

### 8.1 `deposit` — write a new package

**Inputs:**
- `package` (object) — a Context Package per §6. Required fields MUST be present; optional fields MAY be omitted.
- `auth_context` — transport-specified.

**Behavior:**
1. The implementation validates the package against §6.
2. It computes a content hash (§6.6).
3. It persists the package atomically.
4. It returns the stored package, with its `package_id` and content hash set.

**Errors:**
- `400 invalid_schema` — required field missing or invalid.
- `409 duplicate_package_id` — a package with this `package_id` already exists.
- `403 project_archived` — the target project is archived (implementations MAY allow writes to archived projects; if they refuse, this is the error).
- `403 unauthorized` — transport auth rejected the actor.

### 8.2 `pull` — read one or more packages

**Inputs (any one):**
- `mode: "latest"` + `project_id` + optional `limit` (default 5)
- `mode: "specific"` + `package_id`
- `mode: "relevant"` + `project_id` + `query` (string) + optional `limit`

**Behavior:**
- `latest`: return the N most recent packages in the project, ordered by `created_at` descending.
- `specific`: return the single package matching `package_id`, or null.
- `relevant`: return packages semantically related to `query`, ranked by the implementation's search capability (see §11).

**Errors:**
- `404 package_not_found` — for `specific` mode when the package does not exist.
- `501 search_not_supported` — for `relevant` mode when the implementation's storage does not support search (see §11).

### 8.3 `orient` — bootstrap context for a new session

**Inputs:**
- `project_id`
- Optional `window_days` (default 14)

**Behavior:** returns a structured **OrientationBundle** summarizing recent activity, active facts, and open questions. The bundle is the atomic unit fed into a new agent's system prompt or a new human session's briefing. Exact structure:

```json
{
  "project": { /* Project object */ },
  "recent_packages": [ /* up to N recent packages */ ],
  "active_facts": [ /* facts where valid_to IS NULL */ ],
  "open_questions": [ /* aggregated from recent packages */ ],
  "window_days": 14,
  "generated_at": "2026-04-18T20:00:00Z"
}
```

### 8.4 `orchestrate` — assemble a cross-package digest

**Inputs:**
- Optional `project_id` (if omitted, global digest across all accessible projects)
- Optional `focus` (string) — narrows the digest to a topic
- Optional `snippets` (integer, default 25) — controls depth of semantic pulls

**Behavior:** returns a **DigestBundle** containing:
- A time-windowed summary of recent activity
- Active facts
- Open questions
- Semantic snippets pulled by similarity to `focus` if provided
- Cross-project counts if global mode

Unlike `orient` (which fetches raw recent state), `orchestrate` MAY include implementation-specific synthesis. The protocol does not mandate the synthesis method — only the output shape.

### 8.5 `flag_for_review` — request human or agent review

**Inputs:**
- `package_id`
- `review_type`: one of `human`, `agent`
- Optional `note` — prose explaining what to review

**Behavior:** updates the target package's `status` to `awaiting_review` and `review_type` to the specified value. Returns the updated package.

**Errors:**
- `400 invalid_transition` — if the package is already `complete`.
- `404 package_not_found`.

### 8.6 `assert_fact` — update mutable state

**Inputs:**
- `project_id`
- `subject`, `predicate`, `value`
- Optional `source_package_id`, `confidence`, `asserted_by`, `tags`, `valid_from`

**Behavior:** supersedes the current fact for `(project_id, subject, predicate)` per §7.3 and inserts the new fact. MUST be atomic.

### 8.7 `invalidate_fact` — retract mutable state

**Inputs:**
- `project_id`
- `subject`, `predicate`
- Optional `object` — if supplied, only invalidate facts matching this value (useful when multiple facts with the same subject/predicate are allowed, not in v0.1 but reserved).

**Behavior:** sets `valid_to = now()` on matching current facts, inserts no replacement. Returns the count of facts invalidated.

---

## 9. Transport & Identity

The protocol is transport-agnostic, but implementations SHOULD conform to this section where possible for interoperability.

### 9.1 HTTP mapping (recommended)

| Operation | Method | Path |
|-----------|--------|------|
| `deposit` | `POST` | `/v1/projects/{project_id}/packages` |
| `pull` (latest) | `GET` | `/v1/projects/{project_id}/packages?mode=latest&limit=5` |
| `pull` (specific) | `GET` | `/v1/packages/{package_id}` |
| `pull` (relevant) | `GET` | `/v1/projects/{project_id}/packages?mode=relevant&query=...` |
| `orient` | `GET` | `/v1/projects/{project_id}/orient?window_days=14` |
| `orchestrate` | `GET` | `/v1/orchestrate?project={project_id}&focus=...` |
| `flag_for_review` | `POST` | `/v1/packages/{package_id}/flag` |
| `assert_fact` | `POST` | `/v1/projects/{project_id}/facts` |
| `invalidate_fact` | `DELETE` | `/v1/projects/{project_id}/facts?subject=...&predicate=...` |

All request and response bodies use `Content-Type: application/json`. All timestamps use RFC 3339 UTC.

### 9.2 Identity

The protocol does not mandate an auth mechanism. Implementations SHOULD support at least one of:

- **API keys** in `Authorization: Bearer <key>` header. Keys MAY be scoped per-project.
- **OAuth 2.0** (recommended for multi-user deployments).
- **MTLS** (recommended for service-to-service calls within a trusted network).

The actor identity (`actor_id`, `actor_type`) is conveyed separately from the auth token. In an API-key deployment, the key maps to one actor. In an OAuth deployment, the token's subject maps to one actor. The protocol does not define the mapping; it is implementation policy.

### 9.3 Transport-level integrity

Implementations SHOULD ensure transport integrity via TLS. Content-level integrity is provided by package content hashing (§6.6), which is independent of transport and survives backup/restore cycles.

---

## 10. Storage Independence

The protocol mandates **no specific storage technology**. A conformant implementation MAY be backed by:

- Postgres (the reference implementation uses Postgres + pgvector + Supabase)
- SQLite (for single-user or embedded deployments)
- Flat NDJSON files (for static archives and offline use)
- Object storage (S3, GCS) for blobs with a metadata index elsewhere
- Any combination or novel backend

### 10.1 Required invariants

Regardless of storage choice, a conformant implementation MUST:

1. **Preserve immutability of packages.** Once a package reaches `status: complete` and has been read by any second actor, its fields MUST NOT change.
2. **Preserve temporal ordering of facts.** Fact supersession MUST be atomic and the `valid_from` / `valid_to` invariants MUST hold.
3. **Support export to wire format.** The implementation MUST be able to serialize every package and every fact to the JSON wire formats defined in §6–§7, such that another conformant implementation could import the output.
4. **Preserve package content hashes** on round-trip through export and import.

### 10.2 Optional capabilities

An implementation SHOULD expose a `capabilities` descriptor in its metadata declaring:

- `hybrid_search: boolean` — whether `pull` with `mode=relevant` is supported via hybrid (semantic + keyword) search.
- `semantic_search: boolean` — whether `mode=relevant` is supported via semantic search only.
- `realtime: boolean` — whether the implementation supports subscribing to changes.
- `blob_storage: boolean` — whether package deliverables can be stored as blobs separate from the package metadata.

Operations that depend on missing capabilities MUST return the HTTP 501 `not_implemented` response with a body identifying the missing capability.

### 10.3 Backup and sync

Backup = export all packages + facts + sessions for a project (or all projects) to the wire format, usually as NDJSON. Sync = stream packages between two conformant implementations over the wire format.

Neither is a protocol operation. Both are patterns any implementation MAY provide; because both use the wire formats defined in §6–§7, backups from one implementation MUST be restorable into any other conformant implementation.

---

## 11. Conformance Levels

An implementation declares its conformance level. Higher levels include all requirements of lower levels.

### 11.1 L0 — Read-only

The minimum useful implementation. Can read packages and facts that others wrote.

**Required:**
- `pull` (all modes the implementation's storage supports)
- `orient` with raw recent packages + active facts
- Wire format serialization (§6, §7)

**Not required:**
- Writes of any kind.
- `orchestrate` (MAY be implemented; not required).

**Use cases:** static dashboards, read-only mirrors, archival viewers.

### 11.2 L1 — Deposit-capable

L0 + the ability to deposit new packages.

**Additional required:**
- `deposit`
- Package content hashing (§6.6)
- Idempotent deposit: if the same `package_id` is deposited twice with identical content, the second attempt returns the existing package without error. If the content differs, the second attempt MUST return `409 duplicate_package_id`.

**Use cases:** basic agent clients, CLIs, CI/CD reporters.

### 11.3 L2 — Fact-aware

L1 + mutable state operations.

**Additional required:**
- `assert_fact`
- `invalidate_fact`
- Atomic supersession (§7.3)
- Temporal fact queries (current, point-in-time)

**Use cases:** full-featured clients that track project state.

### 11.4 L3 — Review-aware

L2 + human checkpoint operations.

**Additional required:**
- `flag_for_review`
- State transitions `awaiting_review → complete` and `awaiting_review → revision_requested`
- A mechanism to enumerate packages in `awaiting_review` state per project

**Use cases:** team-coordination deployments, multi-actor workflows with human gates.

### 11.5 Declaring conformance

A conformant implementation SHOULD publish a machine-readable conformance descriptor at `/v1/conformance`:

```json
{
  "protocol_version": "0.1",
  "conformance_level": "L2",
  "capabilities": {
    "hybrid_search": true,
    "semantic_search": true,
    "realtime": false,
    "blob_storage": true
  },
  "implementation": { "name": "Relay", "version": "0.1.0" }
}
```

---

## 12. Extension Points

The protocol reserves extension mechanisms so implementations can add features without forking the spec.

### 12.1 The `x-*` namespace

Any field name beginning with `x-` is reserved for implementation-specific extensions. Unknown `x-*` fields MUST be preserved on read and round-tripped on write by all conformant implementations.

Example: an implementation that wants to record a trust score per package MAY add `x-trust-score` without breaking interoperability.

### 12.2 Custom package types

Beyond the enumerated `package_type` values in §6.3, implementations MAY define types in the `x-*` namespace (e.g. `x-review-response`, `x-model-eval`). Other implementations MUST accept these on read and treat them as `standard` for semantic purposes unless they have specific handling.

### 12.3 Custom fact predicates

Fact `subject` and `predicate` are free-form strings. No extension mechanism is needed; implementations are free to use any convention.

### 12.4 Protocol-level extensions

Future versions of this spec (v0.2, v1.0) MAY introduce new operations, fields, or states. Implementations SHOULD expose their supported `protocol_version` in the conformance descriptor (§11.5).

---

## 13. Comparison to Adjacent Technology

| System | What it is | Overlap with Agentic Protocol |
|--------|-----------|------------------------------|
| **MCP (Model Context Protocol)** | A protocol for agents to invoke tools and read resources from servers. | Orthogonal. MCP is about *tool access*. Agentic Protocol is about *context persistence*. They compose — an MCP tool can be a Relay client, and Relay-compatible services can expose themselves as MCP tools. |
| **LangGraph / AutoGen memory** | Framework-specific agent memory layers. | LangGraph memory lives inside a LangGraph application. Agentic Protocol lives between agents and across frameworks. A LangGraph agent MAY use Agentic Protocol as its durable memory store. |
| **Vector databases (Pinecone, Weaviate, Qdrant)** | Stores for embeddings. | Not a protocol — a storage substrate. An Agentic Protocol implementation MAY use a vector DB internally. The protocol does not prescribe it. |
| **OpenAI / Claude Memory** | Vendor-specific chat memory. | Closed, per-user, single-vendor. No interop, no shared state, no multi-actor model. Agentic Protocol is the open alternative. |
| **Project management tools (Jira, Linear)** | Task-tracking systems. | Tasks are a different unit from context. Relay deposits can include task references, but the protocol is not a task system — it carries enriched context that makes tasks executable without further explanation. |
| **Git / version control** | History of *code* state. | Analogous in spirit (immutable log, content hashing) but for code artifacts, not context artifacts. Agentic Protocol packages can reference git commits via `created_by.git_commit`. |
| **CRDTs / Yjs / Automerge** | Conflict-free replicated data types for collaborative editing. | Different model — CRDTs solve concurrent *edits* of the same document. Agentic Protocol uses immutable append + supersession; concurrent writes produce two immutable packages, not a merged one. CRDTs could back a protocol implementation but are not required. |

**The key differentiator:** the Agentic Protocol is designed around *enriched context* as the atomic unit and *agents as first-class actors*. No adjacent system combines both.

---

## 14. Reference Implementation

The reference implementation is **Relay** (`https://relaymemory.com`), an open-source monorepo containing:

- `@relay/core` — TypeScript client library implementing the wire format, content hashing, and operation semantics
- `@relay/cli` — command-line client
- `@relay/mcp` — MCP server bridging Agentic Protocol operations to MCP tools
- `@relay/api` — reference HTTP API (Vercel Edge Functions)
- `@relay/orchestrator` — synthesis layer for `orchestrate`

**Conformance level:** L2 (+ partial L3 in development).

**Storage backend:** Supabase (Postgres + pgvector + object storage). The storage layer is being refactored behind a `RelayStorage` adapter interface in v0.2; other backends (SQLite, flat file) will follow.

Additional reference implementations are welcome. To have an implementation listed here, open a PR against this document with a link, the conformance level declared, and the test results per the conformance test suite (TBD, v0.2).

---

## 15. Versioning & Changelog

### 15.1 Versioning policy

The protocol follows **semantic versioning** at the operation and wire-format level:

- **PATCH** (`0.1.x`) — editorial clarifications, non-normative additions. Existing conformant implementations remain conformant.
- **MINOR** (`0.x.0`) — new optional fields, new optional operations, new conformance levels. Additive only. Existing conformant implementations remain conformant at their declared level.
- **MAJOR** (`x.0.0`) — breaking changes. Wire format changes that existing implementations cannot consume.

Implementations MUST declare the version they target via the `relay_version` field on every package and the `protocol_version` field on the conformance descriptor.

### 15.2 Changelog

**v0.1 (this document)** — initial public draft.

---

## 16. Open Questions

These are tracked in the reference implementation's `docs/V02_ROADMAP.md` and will be resolved in future spec versions.

1. **Cross-project references.** Should a package be able to cite a package in another project? If so, how are the transitive access-control implications handled? Target: v0.2.

2. **Embedding portability in backups.** Should exported NDJSON include raw embedding vectors (binds consumers to the same model) or source text only (re-embed on import)? Current reference impl defaults to source text. Target: v0.2.

3. **Formal conformance test suite.** L0–L3 are defined here prose-only. A test suite that implementations can run against their endpoints is needed to make the levels auditable. Target: v0.2.

4. **Multi-actor atomic writes.** When two actors deposit overlapping packages simultaneously (both reference the same `parent_package_id`), is that a conflict, a branch, or two parallel histories? v0.1 treats both as valid immutable siblings. v0.2 MAY introduce explicit branch semantics.

5. **Schema evolution for `created_by`.** Future authentication models may want richer actor attribution (public key fingerprint, signed attestation). The `x-*` namespace is the current extension path; a formal sub-schema may be warranted in v1.0.

6. **Real-time subscription semantics.** The `realtime` capability is declared but not specified. What wire format conveys subscription events? Likely Server-Sent Events or WebSockets, but the details are unspecified. Target: v0.2.

7. **Conformance level upgrades.** If an implementation at L1 wants to opportunistically use L2 features where supported by peers, is there a negotiation mechanism? Current answer: no — match the lowest common level. v1.0 may introduce capability negotiation.

---

## Appendix A — Canonical JSON Serialization

For content hashing (§6.6), a canonical JSON serialization is required.

- Keys sorted lexicographically (byte-wise).
- No whitespace between tokens.
- `null` fields omitted entirely.
- Arrays preserve insertion order.
- Numbers serialized per RFC 8785 (JSON Canonicalization Scheme) — integers as base-10, no leading zeros; floats in shortest round-trippable form.
- Strings in minimal escape form — only `\"`, `\\`, and control chars `<0x20` escaped.

A reference implementation of canonical serialization is available in `@relay/core` at `packages/core/src/canonical.ts`.

---

## Appendix B — Terminology Index

| Term | Definition | Section |
|------|------------|---------|
| Actor | Entity that deposits or pulls context. | §4, §5.4 |
| Conformant Implementation | System meeting at least L0 requirements. | §11 |
| Context Package | Atomic unit of deposited context. Immutable. | §5.1, §6 |
| Deposit | Operation writing a new package. | §8.1 |
| Fact | Mutable typed triple representing state. | §5.1, §7 |
| Handoff | Transfer of work from one actor to another. | §5.6 |
| Orient | Operation returning bootstrap context. | §8.3 |
| Orchestrate | Operation returning a cross-package digest. | §8.4 |
| Project | Bounded context scope. Unit of archival and backup. | §5.2 |
| Pull | Operation reading one or more packages. | §8.2 |
| Session | Optional grouping of packages by a single actor in a work period. | §5.5 |

---

*End of Agentic Protocol v0.1 draft.*
