import type { RelayManifest, Deliverable } from './types.js';
import { generateContextMd } from './context-md.js';
import { generateCdiff } from './cdiff.js';
import archiver from 'archiver';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Build a context package manifest from the provided inputs.
 */
export function buildManifest(opts: {
  packageId: string;
  projectId: string;
  title: string;
  description: string;
  createdBy: { type: 'agent' | 'human'; id: string; session_id: string };
  status?: string;
  packageType?: string;
  reviewType?: string;
  parentPackageId?: string | null;
  tags?: string[];
  deliverables?: Deliverable[];
  openQuestions?: string[];
  decisionsMade?: string[];
  handoffNote?: string;
  estimatedNextActor?: 'agent' | 'human' | null;
}): RelayManifest {
  return {
    relay_version: '0.1',
    package_id: opts.packageId,
    created_at: new Date().toISOString(),
    created_by: opts.createdBy,
    title: opts.title,
    description: opts.description,
    status: (opts.status as RelayManifest['status']) ?? 'complete',
    package_type: (opts.packageType as RelayManifest['package_type']) ?? 'standard',
    review_type: (opts.reviewType as RelayManifest['review_type']) ?? 'none',
    parent_package_id: opts.parentPackageId ?? null,
    child_package_ids: [],
    dependencies: [],
    tags: opts.tags ?? [],
    project_id: opts.projectId,
    deliverables: opts.deliverables ?? [],
    open_questions: opts.openQuestions ?? [],
    decisions_made: opts.decisionsMade ?? [],
    handoff_note: opts.handoffNote ?? '',
    estimated_next_actor: opts.estimatedNextActor ?? null,
    context_diff_ref: '.cdiff',
  };
}

/**
 * Build a context package zip buffer.
 *
 * Contents:
 *   manifest.json   - Machine-readable metadata
 *   CONTEXT.md      - Human+agent readable briefing
 *   .cdiff          - Context diff from parent (if parent provided)
 *   deliverables/*  - Any files specified in deliverablePaths
 */
export async function buildContextPackage(
  manifest: RelayManifest,
  deliverablePaths: string[],
  gitDiff?: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // Collect deliverables from actual files
    const deliverables: Deliverable[] = [...manifest.deliverables];
    for (const filePath of deliverablePaths) {
      if (fs.existsSync(filePath)) {
        const fileName = path.basename(filePath);
        const ext = path.extname(filePath).slice(1);
        archive.file(filePath, { name: `deliverables/${fileName}` });
        deliverables.push({ path: `deliverables/${fileName}`, type: ext || 'file' });
      }
    }
    manifest.deliverables = deliverables;

    // manifest.json
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    // CONTEXT.md
    const contextMd = generateContextMd(manifest, gitDiff);
    archive.append(contextMd, { name: 'CONTEXT.md' });

    // .cdiff
    const cdiff = generateCdiff({
      fromPackageId: manifest.parent_package_id,
      toPackageId: manifest.package_id,
      actor: { type: manifest.created_by.type, id: manifest.created_by.id },
      contextSummaryDelta: manifest.description,
    });
    archive.append(JSON.stringify(cdiff, null, 2), { name: '.cdiff' });

    archive.finalize();
  });
}
