import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RelayClient, SessionManager, formatOrientationBundle } from '@relay/core';
import type { PackageStatus, ReviewType } from '@relay/core';
import { assembleProjectDigest, assembleGlobalDigest } from '@relay/orchestrator';

export async function registerTools(server: Server) {
  // Prefer ~/.relay/config.json (same source the CLI uses — typically holds
  // the service_role key needed to bypass RLS on writes). Fall back to env
  // vars for self-hosters / containerized runs.
  let client: RelayClient;
  try {
    client = await RelayClient.fromConfig();
    if (!client['config']?.api_key) throw new Error('config missing api_key');
  } catch {
    client = RelayClient.fromEnv();
  }
  const sm = new SessionManager();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'relay_session_start',
        description: 'Start a Relay session. Returns session info and recent project context.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            project_id: { type: 'string', description: 'Project ID (or uses default from env)' },
            agent_description: { type: 'string', description: 'Description of this agent instance' },
          },
        },
      },
      {
        name: 'relay_pull_context',
        description: 'Pull context packages from the Context Core. Tracks what was pulled in the session.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            package_id: { type: 'string', description: 'Specific package ID to pull' },
            mode: {
              type: 'string',
              enum: ['latest', 'next', 'relevant', 'specific'],
              description: 'Pull mode: latest (default), next recommended, relevant to query, or specific ID',
            },
            query: { type: 'string', description: 'Search query (for mode=relevant)' },
          },
        },
      },
      {
        name: 'relay_deposit',
        description: 'Deposit a context package. Use for strategic moments: decisions made, milestones shipped, direction changes, critical questions surfaced. Self-assess significance — deposit proactively when it would score >= 7 (has decisions, handoff note, or open questions). Use auto=true only for git-based stop-hook packaging.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            title: { type: 'string', description: 'Package title' },
            description: { type: 'string', description: 'Short description' },
            project_id: { type: 'string', description: 'Target project ID (overrides CWD detection)' },
            decisions: { type: 'array', items: { type: 'string' }, description: 'Decisions made' },
            open_questions: { type: 'array', items: { type: 'string' }, description: 'Open questions' },
            handoff_note: { type: 'string', description: 'Handoff note for next actor' },
            status: { type: 'string', description: 'Package status', default: 'complete' },
            review_type: { type: 'string', enum: ['human', 'agent', 'none'], default: 'none' },
            auto: { type: 'boolean', description: 'Auto-generate from git state + session info' },
            topic: { type: 'string', description: 'Topic/subject area (e.g., cli, orchestrator, dashboard). Auto-inferred if omitted.' },
            artifact_type: { type: 'string', description: 'Artifact type (decision, analysis, handoff, question, milestone, auto-deposit). Auto-inferred if omitted.' },
          },
          required: ['title'],
        },
      },
      {
        name: 'relay_status',
        description: 'Get current project status, recent packages, and session info.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            project_id: { type: 'string', description: 'Project ID' },
          },
        },
      },
      {
        name: 'relay_assert_fact',
        description:
          'Assert a (subject, relation, object) fact about a project on the mutable facts whiteboard. If a fact with the same (subject, relation) but different object is already active, it is auto-superseded (ended_at set to now). Asserting an identical triple is a no-op. Use this for current-truth statements like "session_start_hook installed=true" or "relay-dashboard font=jetbrains-mono". Packages are still the immutable history; facts are the supersedable current truth.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            subject: { type: 'string', description: 'Free-form. e.g. "session_start_hook", "kai", "relay-dashboard"' },
            relation: { type: 'string', description: 'Free-form. e.g. "installed", "works_on", "font"' },
            object: { type: 'string', description: 'Free-form. e.g. "true", "orion", "JetBrains Mono"' },
            source_package_id: { type: 'string', description: 'Optional package ID this fact was derived from' },
            project_id: { type: 'string', description: 'Project ID (omit to use default)' },
          },
          required: ['subject', 'relation', 'object'],
        },
      },
      {
        name: 'relay_invalidate_fact',
        description:
          'Mark active facts as ended (sets ended_at = now). If `object` is provided, only that exact triple is invalidated; otherwise all active facts matching (subject, relation) are ended. Returns the count of rows ended. Use when a fact stops being true and you want it gone from the orient bundle without asserting a replacement.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            subject: { type: 'string' },
            relation: { type: 'string' },
            object: { type: 'string', description: 'Optional. Omit to invalidate all active (subject, relation) facts.' },
            project_id: { type: 'string' },
          },
          required: ['subject', 'relation'],
        },
      },
      {
        name: 'relay_query_facts',
        description:
          'Query facts on the mutable whiteboard. Default returns currently-active facts only. Pass `as_of` to time-travel and see what was true at a past timestamp. Pass `include_ended=true` to get the full history regardless. Filters are optional and combinable.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            subject: { type: 'string' },
            relation: { type: 'string' },
            object: { type: 'string' },
            as_of: { type: 'string', description: 'ISO timestamp. Default: now (active only).' },
            include_ended: { type: 'boolean', description: 'If true, returns ended facts too. Default false.' },
            limit: { type: 'number' },
            project_id: { type: 'string' },
          },
        },
      },
      {
        name: 'relay_session_orient',
        description:
          'Wake-up bundle for the current project. Returns a compact (~250 token) markdown snapshot: top KEY/SIG packages, latest meaningful handoff, top open questions. Designed to be auto-injected by a SessionStart hook so every session begins oriented without explicit pull. Implements the "every session starts oriented" half of Relay\'s mission.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            project_id: { type: 'string', description: 'Project ID (omit to use CWD-resolved or default)' },
            format: {
              type: 'string',
              enum: ['markdown', 'json'],
              description: 'Output format. Default markdown for direct hook injection; json for programmatic use.',
              default: 'markdown',
            },
            key_packages: { type: 'number', description: 'How many top-significance packages to include (default 3)', default: 3 },
            open_questions: { type: 'number', description: 'How many open questions to include (default 5)', default: 5 },
            window_days: { type: 'number', description: 'Override time window in days (default: meta control or 14)', default: 14 },
          },
        },
      },
      {
        name: 'relay_orchestrate',
        description: 'Assemble project context for synthesis. Returns structured data from all recent packages, decisions, open questions, and handoff notes. Use this to get the "big picture" of a project or all projects. YOU are the synthesizer — read the output and produce insights.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            project_id: { type: 'string', description: 'Project ID (omit for global digest across all projects)' },
            focus: { type: 'string', description: 'Focus area for the digest' },
            snippets: { type: 'number', description: 'Number of semantic search snippets (default 25, increase for deeper context)', default: 25 },
            include_archived: {
              type: 'boolean',
              description:
                'For the global digest (no project_id): include archived projects. Default false. Single-project digests always work regardless of archive state.',
              default: false,
            },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args || {}) as Record<string, unknown>;

    try {
      switch (name) {
        case 'relay_session_start': {
          const session = await client.startSession(
            a.project_id as string | undefined,
            a.agent_description as string | undefined,
          );

          sm.startSession({
            session_id: session.id,
            project_id: session.project_id,
            actor_id: 'agent',
            actor_type: 'agent',
            callsign: session.callsign,
            started_at: session.started_at,
            packages_pulled: [],
            packages_deposited: [],
            parent_package_id: null,
          });

          // Pull recent context to orient the agent
          const recentPackages = await client.getLatestPackages(session.project_id, 5);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                session,
                recent_packages: recentPackages.map((p) => ({
                  id: p.package_id,
                  title: p.title,
                  status: p.status,
                  handoff_note: p.handoff_note,
                  created_at: p.created_at,
                })),
              }, null, 2),
            }],
          };
        }

        case 'relay_pull_context': {
          const mode = (a.mode as string) || 'latest';
          if (mode === 'specific' && a.package_id) {
            const pkg = await client.pullPackage(a.package_id as string);
            if (pkg) sm.trackPulled(pkg.package_id);
            return { content: [{ type: 'text' as const, text: JSON.stringify(pkg, null, 2) }] };
          }
          if (mode === 'relevant' && a.query) {
            const results = await client.search(
              a.query as string,
              a.project_id as string | undefined,
            );
            return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
          }
          const packages = await client.getLatestPackages(
            a.project_id as string | undefined,
            mode === 'latest' ? 5 : 20,
          );
          if (packages.length > 0) {
            sm.trackPulled(packages[0].package_id);
            sm.setParentPackage(packages[0].package_id);
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(packages, null, 2) }] };
        }

        case 'relay_deposit': {
          // Archive guard: skip deposits to archived projects. Return a
          // structured { skipped: true, reason, project_id } response so
          // agents can notice and the calling flow doesn't think a real
          // package was created.
          const targetProject = client.resolveDepositTargetProject(
            (a.project_id as string) || undefined,
          );
          if (targetProject) {
            try {
              const archived = await client.isProjectArchived(targetProject);
              if (archived) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: JSON.stringify(
                        {
                          skipped: true,
                          reason: 'project_archived',
                          project_id: targetProject,
                        },
                        null,
                        2,
                      ),
                    },
                  ],
                };
              }
            } catch {
              // Don't block the deposit on a guard read error.
            }
          }

          if (a.auto) {
            const pkg = await client.autoDeposit({
              status: (a.status as PackageStatus) || undefined,
              reviewType: (a.review_type as ReviewType) || undefined,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(pkg, null, 2) }] };
          }

          const pkg = await client.deposit({
            title: (a.title as string) || 'Untitled',
            description: (a.description as string) || '',
            decisions: (a.decisions as string[]) || [],
            openQuestions: (a.open_questions as string[]) || [],
            handoffNote: (a.handoff_note as string) || '',
            deliverablePaths: [],
            status: (a.status as PackageStatus) || 'complete',
            reviewType: (a.review_type as ReviewType) || 'none',
            projectId: (a.project_id as string) || undefined,
            topic: (a.topic as string) || undefined,
            artifactType: (a.artifact_type as string) || undefined,
          });
          return { content: [{ type: 'text' as const, text: JSON.stringify(pkg, null, 2) }] };
        }

        case 'relay_status': {
          const sessionState = sm.getSession();
          const packages = await client.getLatestPackages(
            a.project_id as string | undefined,
            10,
          );
          const pendingReview = packages.filter((p) => p.status === 'pending_review');
          const openQuestions = packages.flatMap((p) => p.open_questions);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                session: sessionState,
                total_recent_packages: packages.length,
                pending_review: pendingReview.length,
                open_questions: openQuestions.length,
                packages: packages.map((p) => ({
                  id: p.package_id,
                  title: p.title,
                  status: p.status,
                  handoff_note: p.handoff_note,
                })),
              }, null, 2),
            }],
          };
        }

        case 'relay_assert_fact': {
          const fact = await client.assertFact({
            subject: a.subject as string,
            relation: a.relation as string,
            object: a.object as string,
            sourcePackageId: a.source_package_id as string | undefined,
            projectId: a.project_id as string | undefined,
          });
          return { content: [{ type: 'text' as const, text: JSON.stringify(fact, null, 2) }] };
        }

        case 'relay_invalidate_fact': {
          const count = await client.invalidateFact({
            subject: a.subject as string,
            relation: a.relation as string,
            object: a.object as string | undefined,
            projectId: a.project_id as string | undefined,
          });
          return { content: [{ type: 'text' as const, text: JSON.stringify({ invalidated: count }, null, 2) }] };
        }

        case 'relay_query_facts': {
          const facts = await client.queryFacts({
            subject: a.subject as string | undefined,
            relation: a.relation as string | undefined,
            object: a.object as string | undefined,
            asOf: a.as_of as string | undefined,
            includeEnded: a.include_ended as boolean | undefined,
            limit: a.limit as number | undefined,
            projectId: a.project_id as string | undefined,
          });
          return { content: [{ type: 'text' as const, text: JSON.stringify(facts, null, 2) }] };
        }

        case 'relay_session_orient': {
          // Auto-track a session if the agent hasn't called session_start.
          // This guarantees every orient produces a callsign the agent can
          // announce to the user — even for short-run deposit-only flows.
          let existing = sm.getSession();
          let autoStarted: { id: string; callsign?: string } | null = null;
          if (!existing) {
            try {
              const fresh = await client.startSession(
                a.project_id as string | undefined,
              );
              sm.startSession({
                session_id: fresh.id,
                project_id: fresh.project_id,
                actor_id: 'agent',
                actor_type: 'agent',
                callsign: fresh.callsign,
                started_at: fresh.started_at,
                packages_pulled: [],
                packages_deposited: [],
                parent_package_id: null,
              });
              autoStarted = { id: fresh.id, callsign: fresh.callsign };
              existing = sm.getSession();
            } catch {
              // Non-fatal: orient still works without an active session; the
              // callsign line simply won't be shown in the bundle.
            }
          }

          const bundle = await client.getOrientation(
            a.project_id as string | undefined,
            {
              windowDays: typeof a.window_days === 'number' ? a.window_days : undefined,
              openQuestionCount: typeof a.open_questions === 'number' ? a.open_questions : undefined,
            },
          );
          const format = (a.format as string) || 'markdown';
          if (format === 'json') {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  ...bundle,
                  session: existing ? {
                    id: existing.session_id,
                    callsign: existing.callsign,
                    auto_started: !!autoStarted,
                  } : undefined,
                }, null, 2),
              }],
            };
          }
          // Markdown: prepend a one-line callsign header so the agent sees
          // its identity immediately and can greet the operator with it.
          let text = formatOrientationBundle(bundle);
          if (existing?.callsign) {
            const verb = autoStarted ? 'this run is' : 'active run';
            text = `**${verb} \`${existing.callsign}\`** _(announce to the operator before your first reply)_\n\n` + text;
          }
          return { content: [{ type: 'text' as const, text }] };
        }

        case 'relay_orchestrate': {
          const snippetCount = (a.snippets as number) || 25;
          if (a.project_id) {
            const digest = await assembleProjectDigest(client, a.project_id as string, a.focus as string | undefined, snippetCount);
            return { content: [{ type: 'text' as const, text: digest.assembledContext }] };
          }
          const includeArchived = Boolean(a.include_archived);
          const results = await assembleGlobalDigest(
            client,
            a.focus as string | undefined,
            snippetCount,
            { includeArchived },
          );
          const text = results.map(({ projectId, digest }) =>
            `=== ${projectId} (${digest.packagesAnalyzed} packages) ===\n\n${digest.assembledContext}`
          ).join('\n\n');
          return { content: [{ type: 'text' as const, text: text || 'No packages found.' }] };
        }

        default:
          return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });
}
