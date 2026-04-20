// GET /api/v1/packages/:id — Get package metadata

export const config = { runtime: 'edge' };

export async function GET(request: Request): Promise<Response> {
  // TODO: Retrieve package metadata by ID from Supabase
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
