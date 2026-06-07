// TranscriptStore — gzip then encrypt, push ciphertext to a private bucket; reverse on resume.
// Serves: transcript_confidentiality, transcript_opt_in. Fidelity sha is over the ORIGINAL jsonl.
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { encrypt, decrypt, sha256 } from './crypto.js';
import type { EncryptedBlob } from './crypto.js';

/** Minimal storage contract — satisfied by Supabase Storage (bucket: context_transcripts). */
export interface StoragePort {
  upload(path: string, bytes: Buffer): Promise<void>;
  download(path: string): Promise<Buffer>;
}

export interface TranscriptBlobRef {
  storagePath: string;     // e.g. transcripts/<session_id>.bin
  iv: string;
  authTag: string;
  keyId: string;
  originalSha256: string;  // sha of the raw .jsonl — proves byte-identical restore
  originalBytes: number;
  gzipBytes: number;
}

export async function packAndUpload(
  sessionId: string,
  jsonlPath: string,
  key: Buffer,
  storage: StoragePort,
): Promise<TranscriptBlobRef> {
  const original = readFileSync(jsonlPath);
  const gz = gzipSync(original);
  const blob: EncryptedBlob = encrypt(gz, key);
  const storagePath = `transcripts/${sessionId}.bin`;
  await storage.upload(storagePath, blob.ciphertext);
  return {
    storagePath,
    iv: blob.iv,
    authTag: blob.authTag,
    keyId: blob.keyId,
    originalSha256: sha256(original),
    originalBytes: original.length,
    gzipBytes: gz.length,
  };
}

/** Returns the original .jsonl bytes, verified byte-identical (resume_fidelity). */
export async function downloadAndUnpack(
  ref: TranscriptBlobRef,
  key: Buffer,
  storage: StoragePort,
): Promise<Buffer> {
  const ciphertext = await storage.download(ref.storagePath);
  const gz = decrypt({ iv: ref.iv, authTag: ref.authTag, ciphertext, keyId: ref.keyId }, key);
  const original = gunzipSync(gz);
  const got = sha256(original);
  if (got !== ref.originalSha256) {
    throw new Error(`Transcript integrity failed: sha256 ${got} != expected ${ref.originalSha256}.`);
  }
  return original;
}
