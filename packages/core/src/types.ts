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
  topic?: string;
  artifact_type?: string;
  /**
   * Optional snapshot of what files were in the depositing agent's
   * conversation context at deposit time. Paths-only (no contents).
   * Sensitive paths (.env, credentials, *.key, secrets/) are redacted
   * by `redactSensitivePaths` in core before persistence. Manual
   * deposits via the MCP tool or `relay deposit --context-snapshot
   * <file>` carry this; auto-deposits via the stop hook do not (yet
   * — see B-fork follow-up: pre-stop snapshot capture).
   */
  context_snapshot?: ContextSnapshot;
}

export interface ContextSnapshot {
  /** Coarse session shape — same numbers as the report header. */
  session_shape: {
    files: number;
    lines: number;
    dominant_categories: string[];
  };
  /** Per-file entries. Generalized (3+ siblings of same dir+ext) before storage. */
  files: ContextSnapshotFile[];
  /** Ranking helpers for fast dashboard rendering. */
  heavyweights: {
    biggest: ContextSnapshotRanked[];
    most_touched: ContextSnapshotRanked[];
    stale: ContextSnapshotRanked[];
  };
  /** Total lines per category (for the bar chart). */
  category_totals: Record<string, number>;
}

export interface ContextSnapshotFile {
  /** Absolute path. May be redacted to '[redacted]' if matched a sensitive pattern. */
  path: string;
  role: 'read' | 'edit' | 'write' | 'session-load' | 'plan' | 'reference';
  category: string;
  /** Approximate line count, or null if unknown / generalized group. */
  lines: number | null;
  /** Short phrase explaining why the file is in context. */
  why: string;
  /** True when this row represents a generalized group (e.g. "src/components/*.tsx"). */
  is_group?: boolean;
  /** When is_group, the count of files collapsed into this row. */
  group_count?: number;
}

export interface ContextSnapshotRanked {
  path: string;
  /** lines for "biggest"; touch count for "most_touched"; null for "stale". */
  metric: number | null;
  note: string;
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
  /** Docker-style adjective-noun identifier (e.g. "coral-heron") for memorability/audit. */
  callsign?: string;
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
  /**
   * Soft-archive timestamp. NULL (or undefined on older rows) = active.
   * Set to now() to archive. Cleared to restore. Never hard-deleted.
   */
  archived_at: string | null;
}

/**
 * Thrown by archiveProject/restoreProject when the target project is
 * already in the requested terminal state. CLI/MCP can catch this to
 * print a friendly "already archived/active" note instead of treating
 * it as an error.
 */
export class AlreadyInStateError extends Error {
  constructor(
    message: string,
    public readonly project: Project,
    public readonly state: 'archived' | 'active',
  ) {
    super(message);
    this.name = 'AlreadyInStateError';
  }
}

/**
 * Thrown by archiveProject when the target is a meta/protected project
 * (e.g. proj_dev_relay, or settings.meta === true) and `force` was not
 * passed. Prevents accidental archive of the Relay project itself, which
 * would break the stop hook.
 */
export class MetaProjectGuardError extends Error {
  constructor(
    message: string,
    public readonly project: Project,
  ) {
    super(message);
    this.name = 'MetaProjectGuardError';
  }
}

/**
 * Thrown by operations that require a storage capability the current
 * adapter doesn't advertise (e.g. `RelayClient.search` against a
 * backend with `hybridSearch: false && semanticSearch: false`). Per
 * AGENTIC_PROTOCOL.md §11, this is the protocol's `501 not_implemented`
 * surfaced at the library boundary.
 *
 * Catch this in CLI/MCP to print a friendly "upgrade your storage"
 * message rather than treating it as an I/O error.
 */
export class StorageCapabilityError extends Error {
  constructor(
    message: string,
    public readonly capability: 'hybridSearch' | 'semanticSearch' | 'realtime' | 'putBlob' | 'getBlob',
  ) {
    super(message);
    this.name = 'StorageCapabilityError';
  }
}

export interface DepositOptions {
  title: string;
  description: string;
  decisions: string[];
  openQuestions: string[];
  handoffNote: string;
  deliverablePaths: string[];
  status: PackageStatus;
  reviewType: ReviewType;
  parentId?: string;
  projectId?: string;
  topic?: string;
  artifactType?: string;
  /**
   * Optional snapshot of the depositing agent's conversation-context state
   * at deposit time. Redacted via redactSensitivePaths before persistence.
   * Manual deposits (CLI --context-snapshot, MCP tool) carry this; stop-
   * hook auto-deposits do not (pending fork-B pre-stop capture work).
   */
  contextSnapshot?: ContextSnapshot;
  /**
   * Opt-in (Tier 2): also capture the current Claude Code session transcript,
   * gzip + AES-256-GCM encrypt it with the local keyfile, and upload the
   * ciphertext to the private transcript bucket so the session can be resumed
   * later — on this machine or another. Off by default; transcript_opt_in.
   */
  withTranscript?: boolean;
  /**
   * Claude Code session id of the CALLING shell (pkg_7a00e2b8). Stop hooks
   * pass it from the hook stdin payload; otherwise resolved from
   * RELAY_SESSION_ID / CLAUDE_SESSION_ID env or a cwd match against the
   * per-session stamps in ~/.relay/sessions/.
   */
  sessionId?: string | null;
}

export interface AutoDepositOptions {
  parentId?: string;
  status?: PackageStatus;
  reviewType?: ReviewType;
  /**
   * Claude Code session id of the CALLING shell (pkg_7a00e2b8). Stop hooks
   * pass it from the hook stdin payload; otherwise resolved from
   * RELAY_SESSION_ID / CLAUDE_SESSION_ID env or a cwd match against the
   * per-session stamps in ~/.relay/sessions/.
   */
  sessionId?: string | null;
}

export interface SearchResult {
  package_id: string;
  content_type: string;
  content: string;
  similarity: number;
}

export interface SearchOptions {
  topic?: string;
  artifactType?: string;
}

export interface ResumeOptions {
  /**
   * Inline mode: return the decrypted transcript text instead of writing a
   * .jsonl to the Claude projects dir. The caller (agent) folds it into the
   * current context rather than launching a fresh `claude --resume`.
   */
  inline?: boolean;
  /**
   * Override where the materialized .jsonl is written. Defaults to the
   * ORIGIN machine's `~/.claude/projects/<project_path_encoded>/` so resume
   * is faithful on the same machine. Cross-machine callers may pass the
   * current cwd's encoded dir so `claude --resume` discovers it locally.
   */
  targetProjectDir?: string;
}

export interface ResumeResult {
  mode: 'materialized' | 'inline';
  sessionId: string;
  packageId: string;
  projectPathEncoded: string | null;
  originHost: string | null;
  /** True when the deposit came from a different machine than this one. */
  crossMachine: boolean;
  /** materialized mode */
  jsonlPath?: string;
  projectDir?: string;
  resumeCommand?: string;
  bytes?: number;
  /** inline mode */
  transcript?: string;
}

export interface ResumableSession {
  sessionId: string;
  packageId: string;
  title: string;
  projectId: string;
  originHost: string | null;
  hasTranscript: boolean;
  createdAt: string;
  /** Present when produced by a semantic search. */
  similarity?: number;
  /** Ready-to-run restoration command. */
  restoreCommand: string;
}

/**
 * Gradient orient bundle returned by RelayClient.getOrientation().
 *
 * Uses time-based windowing with density-adaptive compression:
 * packages are grouped by day, each day preserves its catalyst
 * (highest significance) and bookends (first + last if tied),
 * and rendering detail fades with age (full -> medium -> light -> minimal).
 */
export interface OrientationBundle {
  project_id: string;
  project_name: string;
  generated_at: string;

  /** Time window scanned, in days. */
  window_days: number;

  /** Day groups with preserved packages and compression summaries. */
  days: GradientDay[];

  /** Most recent package that has a non-empty handoff_note. */
  latest_handoff: {
    package_id: string;
    title: string;
    handoff_note: string;
    created_at: string;
  } | null;

  /** Deduplicated open questions across the window, capped. */
  open_questions: string[];

  /** Currently-active facts, ordered by recency. */
  active_facts: RelayFact[];

  /** Diagnostic counters. */
  recent_package_count: number;
  total_open_questions: number;
  total_active_facts: number;
}

export interface OrientationOptions {
  /** Time window in days. Default 14. Overrides meta:orient/window_days fact. */
  windowDays?: number;
  /** Max open questions to include. Default 5. */
  openQuestionCount?: number;
  /** Max active facts to include. Default 8. */
  activeFactCount?: number;
  /** Min significance to promote one render tier. Default 9. */
  significancePromotionThreshold?: number;
}

/** Gradient rendering tiers — determines how much detail a package gets in the orient bundle. */
export type RenderTier = 'full' | 'medium' | 'light' | 'minimal';

/** A single calendar day in the gradient orient view. */
export interface GradientDay {
  /** YYYY-MM-DD */
  date: string;
  /** 0 = today, 1 = yesterday, etc. */
  age_days: number;
  /** Base render tier for this day (before significance promotion). */
  base_tier: RenderTier;
  /** Packages preserved through compression (catalyst, bookends, promoted). */
  preserved: OrientPackage[];
  /** How many packages were compressed away. */
  compressed_count: number;
  /** Artifact type breakdown of compressed packages. */
  compressed_types: Record<string, number>;
}

/** A package preserved through the per-day compression phase. */
export interface OrientPackage {
  id: string;
  title: string;
  handoff_note: string;
  significance: number;
  created_at: string;
  topic: string | null;
  artifact_type: string | null;
  /** True if significance >= promotion threshold bumped this up one tier. */
  promoted: boolean;
}

/**
 * Mutable facts triples — Relay's "whiteboard" alongside the immutable
 * context_packages "journal." See migration 004_facts.sql and pkg_f7b1a8d6.
 *
 * Subject/relation/object are FREE-FORM strings — no controlled vocabulary,
 * no URI scheme. Agents pick whatever phrasing works.
 */
export interface RelayFact {
  id: string;
  project_id: string;
  subject: string;
  relation: string;
  object: string;
  source_package_id: string | null;
  asserted_by_type: ActorType;
  asserted_by_id: string;
  valid_from: string;
  ended_at: string | null;
  created_at: string;
}

export interface FactQuery {
  subject?: string;
  relation?: string;
  object?: string;
  /** ISO timestamp. Defaults to "now" — only active facts at that moment. */
  asOf?: string;
  /** If true, returns ended facts as well as active. Default false. */
  includeEnded?: boolean;
  /** Optional cap on result count. */
  limit?: number;
}

export interface AssertFactOptions {
  subject: string;
  relation: string;
  object: string;
  sourcePackageId?: string;
  projectId?: string;
}

export interface InvalidateFactOptions {
  subject: string;
  relation: string;
  /** If provided, only invalidates facts with this exact object. Otherwise invalidates ALL active (subject, relation) facts. */
  object?: string;
  projectId?: string;
}
