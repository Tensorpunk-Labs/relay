/**
 * Local backup of all Supabase tables to JSON files.
 *
 * Usage: npx tsx scripts/backup-supabase.ts
 *
 * Output: backups/YYYY-MM-DD-HHMMSS/<table>.json for every table.
 * Pulls full row contents using the secret key from ~/.relay/config.json.
 *
 * This is a safety net before schema changes (RLS enablement, migrations).
 * Run BEFORE any risky production change.
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const configPath = path.join(os.homedir(), '.relay', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const supabase = createClient(config.core_url, config.api_key);

const TABLES = [
  'projects',
  'context_packages',
  'package_embeddings',
  'sessions',
  'relay_facts',
  'context_diffs',
];

async function backupTable(table: string, outDir: string): Promise<number> {
  let allRows: unknown[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error(`  ${table}: ERROR — ${error.message}`);
      return -1;
    }

    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  const outPath = path.join(outDir, `${table}.json`);
  fs.writeFileSync(outPath, JSON.stringify(allRows, null, 2));
  return allRows.length;
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupRoot = path.join(__dirname, '..', 'backups');
  const outDir = path.join(backupRoot, timestamp);

  if (!fs.existsSync(backupRoot)) fs.mkdirSync(backupRoot, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Supabase backup → ${outDir}`);
  console.log(`Source: ${config.core_url}`);
  console.log();

  const startTime = Date.now();
  const summary: Record<string, number> = {};

  for (const table of TABLES) {
    process.stdout.write(`  ${table.padEnd(25)}`);
    const count = await backupTable(table, outDir);
    summary[table] = count;
    console.log(count >= 0 ? `${count} rows` : 'FAILED');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalRows = Object.values(summary).filter((n) => n >= 0).reduce((a, b) => a + b, 0);

  // Write manifest
  const manifestPath = path.join(outDir, '_manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        source: config.core_url,
        tables: summary,
        total_rows: totalRows,
        elapsed_seconds: parseFloat(elapsed),
      },
      null,
      2,
    ),
  );

  console.log();
  console.log(`Done. ${totalRows} total rows backed up in ${elapsed}s.`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
