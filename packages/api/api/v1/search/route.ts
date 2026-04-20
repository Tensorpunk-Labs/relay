// POST /api/v1/search — Semantic search across context packages

export const config = { runtime: 'edge' };

export async function POST(request: Request): Promise<Response> {
  // TODO: Generate embedding from query, call search_context RPC
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
