// GET /api/v1/projects/:id/open-questions — Get all open questions for a project

export const config = { runtime: 'edge' };

export async function GET(request: Request): Promise<Response> {
  // TODO: Aggregate open_questions from all packages in project
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
