/**
 * One-time backfill: infer topic and artifact_type for existing packages.
 * Safe to re-run — only updates rows where BOTH columns are null.
 *
 * Usage: npx tsx scripts/backfill-metadata.ts [--dry-run]
 */
import { createClient } from '@supabase/supabase-js';
import { inferTopic, inferArtifactType } from '../packages/core/src/inference.js';
import type { RelayManifest } from '../packages/core/src/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const dryRun = process.argv.includes('--dry-run');

// Load config
const configPath = path.join(os.homedir(), '.relay', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const supabase = createClient(config.core_url, config.api_key);

async function main() {
  console.log(`Backfill metadata${dryRun ? ' (DRY RUN)' : ''}...`);

  // Fetch all packages missing both topic AND artifact_type
  const { data, error } = await supabase
    .from('context_packages')
    .select('id, manifest, topic, artifact_type')
    .is('topic', null)
    .is('artifact_type', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }

  console.log(`Found ${data.length} packages to classify.`);

  let updated = 0;
  let skipped = 0;

  for (const row of data) {
    const manifest = row.manifest as RelayManifest;

    // Extract changed files from description (auto-deposits store them)
    let changedFiles: string[] | undefined;
    const filesMatch = manifest.description?.match(/Changed files: (.+)/);
    if (filesMatch && filesMatch[1] !== 'none') {
      changedFiles = filesMatch[1].split(', ').map((f) => f.trim());
    }

    const topic = inferTopic(manifest, changedFiles);
    const artifactType = inferArtifactType(manifest);

    if (!topic && !artifactType) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY] ${row.id}: topic=${topic}, type=${artifactType} — "${manifest.title?.slice(0, 60)}"`);
      updated++;
      continue;
    }

    const updateFields: Record<string, string | null> = {};
    if (topic) updateFields.topic = topic;
    if (artifactType) updateFields.artifact_type = artifactType;

    const { error: updateError } = await supabase
      .from('context_packages')
      .update(updateFields)
      .eq('id', row.id);

    if (updateError) {
      console.error(`  Failed ${row.id}: ${updateError.message}`);
    } else {
      console.log(`  Updated ${row.id}: topic=${topic}, type=${artifactType}`);
      updated++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped (no inference): ${skipped}, Total: ${data.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
