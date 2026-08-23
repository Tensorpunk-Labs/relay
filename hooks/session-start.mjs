// SessionStamp — wired to Claude Code's SessionStart hook. Reads the JSON payload on stdin
// (session_id, transcript_path, cwd) and stamps ~/.relay/current-session.json so the running
// shell — and the next deposit — knows its own resume id. Serves: capture_overhead.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, dirname } from 'node:path';

function encodeProjectPath(cwd) {
  // Match Claude Code: every non-[A-Za-z0-9-] char -> '-', no collapsing.
  return String(cwd || '').replace(/[^A-Za-z0-9-]/g, '-');
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let p = {};
  try { p = JSON.parse(raw || '{}'); } catch { /* tolerate empty */ }
  const cwd = p.cwd || process.cwd();
  const encoded = encodeProjectPath(cwd);
  // SessionStart may omit transcript_path; it's deterministic, so derive it.
  let transcriptPath = p.transcript_path || null;
  if (!transcriptPath && p.session_id) {
    transcriptPath = join(homedir(), '.claude', 'projects', encoded, p.session_id + '.jsonl');
  }
  const ref = {
    session_id: p.session_id || null,
    transcript_path: transcriptPath,
    cwd,
    project_path_encoded: encoded,
    host: hostname(),
  };
  // pkg_7a00e2b8: per-session stamp so concurrent shells never clobber each other.
  // The legacy singleton is still written for older readers.
  const json = JSON.stringify(ref, null, 2);
  try {
    if (ref.session_id) {
      const per = join(homedir(), '.relay', 'sessions', ref.session_id + '.json');
      mkdirSync(dirname(per), { recursive: true });
      writeFileSync(per, json);
    }
    const out = join(homedir(), '.relay', 'current-session.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, json);
  } catch { /* never block session start */ }
  process.exit(0);
});
