// POST  /api/v1/sessions — Start a session
// PATCH /api/v1/sessions — End a session (with session ID in body)

export const config = { runtime: 'edge' };

export async function POST(request: Request): Promise<Response> {
  // TODO: Create session in Supabase
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}

export async function PATCH(request: Request): Promise<Response> {
  // TODO: End session (set ended_at)
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
