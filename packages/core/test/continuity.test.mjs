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

// ---------------------------------------------------------------------------
// pkg_7a00e2b8: continuity broken for concurrent sessions.
// ---------------------------------------------------------------------------
import { resolveSessionRef, stampSession } from '../dist/continuity/index.js';
import { utimesSync } from 'node:fs';

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'relay-home-'));
  const projects = join(home, '.claude', 'projects');
  mkdirSync(projects, { recursive: true });
  return { home, projects };
}
function stamp(home, projects, id, cwd, mtimeSec) {
  const enc = encodeProjectPath(cwd);
  mkdirSync(join(projects, enc), { recursive: true });
  const tp = join(projects, enc, id + '.jsonl');
  writeFileSync(tp, '{"x":1}\n');
  utimesSync(tp, mtimeSec, mtimeSec);
  return stampSession({ session_id: id, transcript_path: tp, cwd, project_path_encoded: enc, host: 'h' }, { home });
}

// BUG 1: N concurrent shells -> every deposit must find ITS OWN stamp.
test('resolveSessionRef: explicit session id wins over every other stamp', () => {
  const { home, projects } = fakeHome();
  stamp(home, projects, 'sess-A', 'C:\a', 1000);
  stamp(home, projects, 'sess-B', 'C:\b', 2000);
  assert.equal(resolveSessionRef({ sessionId: 'sess-A', home, cwd: 'C:\b' })?.session_id, 'sess-A');
});

test('resolveSessionRef: without an id, matches the calling cwd, not the last-stamped shell', () => {
  const { home, projects } = fakeHome();
  stamp(home, projects, 'sess-A', 'C:\a', 1000);
  stamp(home, projects, 'sess-B', 'C:\b', 2000); // stamped last
  assert.equal(resolveSessionRef({ home, cwd: 'C:\a' })?.session_id, 'sess-A');
});

test('resolveSessionRef: two shells in the same cwd -> the most recently active transcript', () => {
  const { home, projects } = fakeHome();
  stamp(home, projects, 'sess-old', 'C:\same', 1000);
  stamp(home, projects, 'sess-new', 'C:\same', 5000);
  assert.equal(resolveSessionRef({ home, cwd: 'C:\same' })?.session_id, 'sess-new');
  utimesSync(join(projects, encodeProjectPath('C:\same'), 'sess-old.jsonl'), 9000, 9000);
  assert.equal(resolveSessionRef({ home, cwd: 'C:\same' })?.session_id, 'sess-old');
});

test('resolveSessionRef: falls back to legacy current-session.json when nothing else matches', () => {
  const { home } = fakeHome();
  mkdirSync(join(home, '.relay'), { recursive: true });
  writeFileSync(join(home, '.relay', 'current-session.json'), JSON.stringify({ session_id: 'legacy', cwd: 'C:\z' }));
  assert.equal(resolveSessionRef({ home, cwd: 'C:\nomatch' })?.session_id, 'legacy');
});

// BUG 2: blob key must be immutable per package so earlier refs never dangle.
test('packAndUpload keys the blob per package; two captures of one session coexist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-tx2-'));
  const jsonl = join(dir, 's.jsonl');
  const key = randomBytes(32);
  const mem = new Map();
  const storage = { upload: async (p, b) => { mem.set(p, Buffer.from(b)); }, download: async (p) => mem.get(p) };
  writeFileSync(jsonl, 'first\n');
  const r1 = await packAndUpload('sess-1', jsonl, key, storage, 'pkg_one');
  writeFileSync(jsonl, 'first\nsecond\n');
  const r2 = await packAndUpload('sess-1', jsonl, key, storage, 'pkg_two');
  assert.notEqual(r1.storagePath, r2.storagePath);
  assert.match(r1.storagePath, /^transcripts\/sess-1\/pkg_one\.bin$/);
  assert.equal((await downloadAndUnpack(r1, key, storage)).toString(), 'first\n');
  assert.equal((await downloadAndUnpack(r2, key, storage)).toString(), 'first\nsecond\n');
});
