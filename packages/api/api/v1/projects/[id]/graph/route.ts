// GET /api/v1/projects/:id/graph — Get project package graph

export const config = { runtime: 'edge' };

export async function GET(request: Request): Promise<Response> {
  // TODO: Build and return package dependency graph for project
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
