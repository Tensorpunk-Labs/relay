// GET /api/v1/packages/:id/download — Download .relay.zip

export const config = { runtime: 'edge' };

export async function GET(request: Request): Promise<Response> {
  // TODO: Stream .relay.zip from Supabase Storage
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
