// POST /api/v1/orchestrate — Trigger orchestrator to produce a project digest

export const config = { runtime: 'edge' };

export async function POST(request: Request): Promise<Response> {
  // TODO: Trigger orchestrator — gather packages, generate embedding search, call Claude
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
