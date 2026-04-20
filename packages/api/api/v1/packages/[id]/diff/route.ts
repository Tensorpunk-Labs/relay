// GET /api/v1/packages/:id/diff — Get .cdiff for a package

export const config = { runtime: 'edge' };

export async function GET(request: Request): Promise<Response> {
  // TODO: Retrieve context diff for package
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
