// Guarantee tests (node:test, no deps). Run: node --test after building @relay/core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  encrypt, decrypt, keyId, packAndUpload, downloadAndUnpack, encodeProjectPath,
} from '../dist/continuity/index.js';
import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';

// resume_fidelity: ciphertext decrypts back to identical bytes.
test('encrypt/decrypt round-trips to identical bytes', () => {
  const key = randomBytes(32);
  const pt = Buffer.from('the quick brown fox jumps \u{1F98A}'.repeat(200));
  assert.deepEqual(decrypt(encrypt(pt, key), key), pt);
});

// transcript_confidentiality: the stored ciphertext must not contain the plaintext.
test('ciphertext does not leak plaintext', () => {
  const key = randomBytes(32);
  const pt = Buffer.from('SENTINEL_SECRET_VALUE_42');
  const blob = encrypt(pt, key);
  assert.equal(blob.ciphertext.includes(pt), false);
});

test('keyId is stable and key-specific', () => {
  const k = randomBytes(32);
  assert.equal(keyId(k), keyId(Buffer.from(k)));
  assert.notEqual(keyId(k), keyId(randomBytes(32)));
});

// key_safety: wrong key is refused before any cipher work.
test('decrypt refuses on key mismatch', () => {
  const blob = encrypt(Buffer.from('secret'), randomBytes(32));
  assert.throws(() => decrypt(blob, randomBytes(32)), /Key mismatch/);
});

// GCM integrity: a flipped ciphertext byte fails the auth tag.
test('decrypt fails on tampered ciphertext', () => {
  const key = randomBytes(32);
  const blob = encrypt(Buffer.from('secret payload here'), key);
  blob.ciphertext[0] ^= 0xff;
  assert.throws(() => decrypt(blob, key));
});

// resume_fidelity end-to-end: gzip + encrypt + store + retrieve == original jsonl.
test('packAndUpload/downloadAndUnpack is byte-identical', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-tx-'));
  const jsonl = join(dir, 's.jsonl');
  const original = Buffer.from(
    Array.from({ length: 500 }, (_, i) => JSON.stringify({ i, t: 'message ' + i })).join('\n'),
  );
  writeFileSync(jsonl, original);
  const mem = new Map();
  const storage = {
    upload: async (p, b) => { mem.set(p, Buffer.from(b)); },
    download: async (p) => mem.get(p),
  };
  const key = randomBytes(32);
  const ref = await packAndUpload('sess-123', jsonl, key, storage);
  assert.equal(ref.originalBytes, original.length);
  assert.ok(ref.gzipBytes > 0);
  assert.deepEqual(await downloadAndUnpack(ref, key, storage), original);
});

// Encoding matches Claude Code's scheme exactly (verified vs ~/.claude/projects):
// every non-[A-Za-z0-9-] char -> '-', existing dashes kept, runs NOT collapsed.
test('encodeProjectPath matches Claude scheme (no dash-collapse)', () => {
  assert.equal(encodeProjectPath('C:\\code'), 'C--code');
  assert.equal(
    encodeProjectPath('C:\\code\\_src\\app'),
    'C--code--src-app',
  );
  assert.equal(
    encodeProjectPath('C:\\code\\my-cool-app'),
    'C--code-my-cool-app',
  );
});

// Full resume write-path: unpack -> write to <projects>/<encoded>/<sessionId>.jsonl,
// byte-identical, at the path the encoding dictates.
test('resume write-path lands byte-identical at the encoded dir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-resume-'));
  const srcJsonl = join(dir, 'src.jsonl');
  const original = Buffer.from('{"role":"user"}\n{"role":"assistant"}\n'.repeat(50));
  writeFileSync(srcJsonl, original);
  const mem = new Map();
  const storage = {
    upload: async (p, b) => { mem.set(p, Buffer.from(b)); },
    download: async (p) => mem.get(p),
  };
  const key = randomBytes(32);
  const sessionId = 'f0e1d2c3-aaaa-bbbb-cccc-001122334455';
  const ref = await packAndUpload(sessionId, srcJsonl, key, storage);

  // Simulate resume materialization exactly as client.resume does.
  const projectsRoot = join(dir, 'projects');
  const encoded = encodeProjectPath('C:\\code\\_src\\app');
  const projectDir = join(projectsRoot, encoded);
  mkdirSync(projectDir, { recursive: true });
  const jsonlPath = join(projectDir, sessionId + '.jsonl');
  writeFileSync(jsonlPath, await downloadAndUnpack(ref, key, storage));

  assert.equal(encoded, 'C--code--src-app');
  assert.deepEqual(readFileSync(jsonlPath), original);
});

// Integrity guard: corrupted sha in the ref is caught on unpack.
test('downloadAndUnpack rejects sha mismatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-tx-'));
  const jsonl = join(dir, 's.jsonl');
  writeFileSync(jsonl, Buffer.from('{"a":1}\n{"b":2}\n'));
  const mem = new Map();
  const storage = {
    upload: async (p, b) => { mem.set(p, Buffer.from(b)); },
    download: async (p) => mem.get(p),
  };
  const key = randomBytes(32);
  const ref = await packAndUpload('s', jsonl, key, storage);
  await assert.rejects(
    downloadAndUnpack({ ...ref, originalSha256: 'deadbeef' }, key, storage),
    /integrity/,
  );
});
