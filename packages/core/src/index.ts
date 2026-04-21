export * from './types.js';
// Errors re-exported explicitly so consumers have a stable named surface.
// (types.ts `export *` already covers them; the explicit list documents
// the catchable error classes.)
export { AlreadyInStateError, MetaProjectGuardError, StorageCapabilityError } from './types.js';
export { RelayClient } from './client.js';
export { formatOrientationBundle } from './format.js';
export { inferTopic, inferArtifactType } from './inference.js';
export { buildManifest, buildContextPackage } from './context-package.js';
export { generateCdiff } from './cdiff.js';
export { generatePackageId, generateSessionId, generateDiffId } from './manifest.js';
export { generateCallsign, isValidCallsign } from './callsign.js';
export { SessionManager, type SessionState } from './session-manager.js';
export { getGitInfo, getGitDiff, getGitFingerprint, type GitInfo } from './git-utils.js';
export { generateContextMd } from './context-md.js';
export { generateAndStoreEmbeddings, generateQueryEmbedding } from './embeddings.js';
export { computeSignificance } from './significance.js';
export { rerank } from './reranker.js';
export type {
  RelayStorage,
  ReadOnlyRelayStorage,
  StorageCapabilities,
  PackageRow,
  EmbeddingRow,
  PackageInsert,
  FactInsert,
  SessionInsert,
  ProjectInsert,
  ProjectUpdate,
  SearchHit,
  HybridSearchQuery,
  SemanticSearchQuery,
} from './storage/types.js';
export {
  SupabaseStorage,
  NotImplementedError,
  type SupabaseStorageOptions,
} from './storage/supabase.js';
export {
  openStorage,
  registerSqliteFactory,
  type OpenStorageDefaults,
  type SqliteFactory,
} from './storage/factory.js';
export {
  BackupService,
  BACKUP_FORMAT_VERSION,
  RELAY_PROTOCOL_VERSION,
  type BackupResult,
  type BackupManifest,
  type BlobError,
  type BackupServiceOptions,
  type BackupProgressEvent,
} from './backup.js';
export {
  RestoreService,
  type RestoreOptions,
  type RestoreResult,
  type RestoreCounts,
  type ConflictReport,
  type ConflictPolicy,
  type RestoreKind,
  type RestoreProgressEvent,
} from './restore.js';
export {
  SyncService,
  type SyncOptions,
  type SyncResult,
  type SyncProjectResult,
  type SyncCounts,
  type SyncProgressEvent,
} from './sync.js';
