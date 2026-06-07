// Public surface for the continuity feature (re-exported from @relay/core root).
export {
  KEY_PATH,
  loadOrCreateKey,
  loadKey,
  keyId,
  sha256,
  encrypt,
  decrypt,
} from './crypto.js';
export type { EncryptedBlob } from './crypto.js';
export {
  packAndUpload,
  downloadAndUnpack,
} from './transcript-store.js';
export type { StoragePort, TranscriptBlobRef } from './transcript-store.js';
export {
  CURRENT_SESSION_PATH,
  encodeProjectPath,
  claudeProjectsDir,
  readCurrentSession,
  thisHost,
} from './session-ref.js';
export type { SessionRef } from './session-ref.js';
