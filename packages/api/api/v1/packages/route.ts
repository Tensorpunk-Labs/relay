// POST /api/v1/packages — Deposit a context package
// GET  /api/v1/packages — List packages (with filters)

export const config = { runtime: 'edge' };

export async function POST(request: Request): Promise<Response> {
  // TODO: Parse multipart (metadata + zip), store in Supabase
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}

export async function GET(request: Request): Promise<Response> {
  // TODO: List packages with project_id filter
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
