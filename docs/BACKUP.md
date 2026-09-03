# Backup & Restore

`relay backup` writes a portable, read-only snapshot of a project (or every
project) to a local directory. `relay restore` replays that directory into any
configured storage adapter. Together they are the portability and
disaster-recovery path for a Relay instance.

Every call in the backup path is a `SELECT` or a blob download — the command
makes zero writes against the source.

---

## Usage

```bash
relay backup --project <id> --out ./backup-dir     # one project
relay backup --all-projects --out ./backup-dir     # every non-archived project

relay restore --from ./backup-dir                             # into configured storage
relay restore --from ./backup-dir --to sqlite:///./mirror.db   # into a local SQLite file
```

If `--out` is omitted the directory defaults to `./relay-backup-<iso>/`.

## Layout

Single project:

```
<outDir>/
  manifest.json          backup metadata + counts
  projects.ndjson        one Project per line
  packages.ndjson        one PackageRow per line (storage_path rewritten to a relative path)
  facts.ndjson           full fact history, including ended facts
  sessions.ndjson        one Session per line
  blobs/<project_id>/<package_id>.relay.zip
```

`--all-projects` nests one such directory per project under `<outDir>/<project_id>/`
and writes an aggregate `manifest.json` at the root.

---

## Reliability semantics

These three properties are what make the command safe to run unattended.

### 1. Reads are paginated

Packages stream in `LIMIT`/`OFFSET` pages — 200 rows by default — ordered by
`(created_at DESC, id DESC)`. The `id` tie-break makes the sort total; ordering
on `created_at` alone is not unique, and an unstable order across pages can
duplicate or skip rows mid-export.

This matters because `listPackages` selects whole rows, and `context_md` /
`context_snapshot` can each be hundreds of kilobytes. A single unpaginated read
of a large project exceeds the Postgres statement timeout and fails with:

```
canceling statement due to statement timeout
```

Pagination keeps each statement small regardless of how large the corpus grows.

Two safety properties guard the cursor:

- Package ids are deduplicated across pages, so a row shifting between pages
  because of a concurrent insert can never be written twice.
- If a page returns no previously-unseen ids the cursor is not advancing — which
  is what a storage adapter that ignores `offset` would do — and the loop stops
  rather than spinning forever.

### 2. Transient failures retry

A multi-minute export will eventually straddle a backend hiccup. These retry up
to **4 attempts with exponential backoff** (500 ms, 1 s, 2 s):

- Postgres statement timeouts (`canceling statement ...`)
- Upstream 5xx, including Cloudflare 520-527 when the database is briefly
  unreachable
- Socket-level failures: `ECONNRESET`, `ETIMEDOUT`, `socket hang up`, `fetch failed`

Everything else — invalid credentials, a project that does not exist, a
malformed query — is treated as fatal and surfaces immediately rather than
burning three pointless attempts.

Blob downloads retry on the same policy. A blob that is still missing after
retries is recorded in `blob_errors` and does not fail the run, since a missing
bundle is a data condition rather than an export fault.

### 3. Failures are isolated and declared

In `--all-projects`, a single failing project no longer aborts every project
after it. The run continues and the manifest states exactly what happened:

```jsonc
{
  "partial": true,                      // at least one project failed
  "project_ids": ["proj_a", "proj_b"],  // ONLY projects actually written
  "failed_projects": [
    {
      "projectId": "proj_c",
      "projectName": "Big Project",
      "reason": "Failed to list packages for proj_c at offset 400: ..."
    }
  ]
}
```

`project_ids` and `counts.projects` reflect what was written, never what was
attempted, so a partial snapshot cannot claim coverage it does not have.

A partial run prints each failure and **exits non-zero**. Re-running retries the
failed projects; successful ones are simply rewritten.

### Exit codes

| Code | Meaning |
|------|---------|
| `0`  | Every requested project exported successfully. |
| `1`  | The export failed, or completed partially with at least one failed project. |

> **Scripting note:** a shell pipeline reports the exit status of its *last*
> command. `relay backup ... | tee log` yields `tee`'s status, not the backup's.
> Use `set -o pipefail`, check `${PIPESTATUS[0]}`, or do not pipe when the exit
> code matters.

### The manifest is the completion contract

`manifest.json` is written **last**, after all rows and blobs have landed. Its
presence is the signal that a backup finished; `relay restore` refuses any
directory without one. A run killed partway through leaves no manifest and can
never be mistaken for a usable snapshot.

When scripting your own checks, test for `manifest.json` and then for
`partial !== true` — directory size and file counts are not reliable indicators.

---

## Verifying a backup

```bash
# Did it finish, and is it complete?
test -f backup-dir/manifest.json && echo "finished" || echo "INCOMPLETE"
node -e "const m=require('./backup-dir/manifest.json');
  console.log('partial:', !!m.partial, '| projects:', m.counts.projects,
              '| packages:', m.counts.packages,
              '| blobs:', m.counts.blobs_stored + '/' + m.counts.blobs_attempted);
  if (m.failed_projects?.length) console.log('FAILED:', m.failed_projects.map(f=>f.projectId).join(', '));"

# Row counts should match the manifest
wc -l backup-dir/packages.ndjson
```

## Scheduled backups

Run on a schedule and let the exit code drive alerting:

```bash
#!/usr/bin/env bash
set -euo pipefail
OUT="/backups/relay/relay-backup-$(date +%Y%m%d)"
relay backup --all-projects --out "$OUT"   # non-zero on partial or failure
```

Because `set -e` is in play and the command is not piped, a partial backup stops
the script and surfaces the failure instead of leaving a silent gap in the
backup history.

## Restore

```bash
relay restore --from ./backup-dir                            # into configured storage
relay restore --from ./backup-dir --to sqlite:///./mirror.db # into a local SQLite file
```

Restore validates `backup_format_version` and `protocol_version` before writing
anything, and upserts by primary key so replaying a backup over an existing
instance is idempotent.
