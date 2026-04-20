// PATCH /api/v1/packages/:id/status — Update package status

export const config = { runtime: 'edge' };

export async function PATCH(request: Request): Promise<Response> {
  // TODO: Update package status in Supabase
  void request;
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}
