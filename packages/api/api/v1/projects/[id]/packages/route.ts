// GET /api/v1/projects/:id/packages — List packages for a project

export const config = { runtime: 'edge' };

export async function GET(request: Request): Promise<Response> {
  // TODO: List packages filtered by project_id
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
