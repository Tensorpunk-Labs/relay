// TranscriptCrypto — AES-256-GCM over an auto-generated 32-byte keyfile.
// Serves: transcript_confidentiality, key_safety, resume_fidelity.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const ALGO = 'aes-256-gcm';
export const KEY_PATH = join(homedir(), '.relay', 'transcript.key');

export interface EncryptedBlob {
  iv: string;        // base64, 12-byte GCM nonce
  authTag: string;   // base64, 16-byte GCM tag (ciphertext integrity)
  ciphertext: Buffer;
  keyId: string;     // fingerprint of the key used
}

function assert32(key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error(`Relay transcript key is ${key.length} bytes, expected 32: ${KEY_PATH}`);
  }
  return key;
}

/** Load the local keyfile, generating a fresh 0600 key on first use. */
export function loadOrCreateKey(): { key: Buffer; created: boolean } {
  if (existsSync(KEY_PATH)) return { key: assert32(readFileSync(KEY_PATH)), created: false };
  const key = randomBytes(32);
  mkdirSync(dirname(KEY_PATH), { recursive: true });
  writeFileSync(KEY_PATH, key, { mode: 0o600 });
  try { chmodSync(KEY_PATH, 0o600); } catch { /* non-posix fs */ }
  return { key, created: true };
}

/** Load the local keyfile, throwing if absent (resume path must not invent a key). */
export function loadKey(): Buffer {
  if (!existsSync(KEY_PATH)) {
    throw new Error(`No transcript key at ${KEY_PATH}. Copy it from the machine that made the deposit.`);
  }
  return assert32(readFileSync(KEY_PATH));
}

export function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function encrypt(plaintext: Buffer, key: Buffer): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext,
    keyId: keyId(key),
  };
}

/** Decrypt — refuses on key mismatch (key_safety) before touching the cipher. */
export function decrypt(blob: EncryptedBlob, key: Buffer): Buffer {
  const localId = keyId(key);
  if (blob.keyId !== localId) {
    throw new Error(
      `Key mismatch: transcript encrypted with key ${blob.keyId}, local key is ${localId}. ` +
      `Copy the matching ${KEY_PATH}.`,
    );
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'));
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
}
