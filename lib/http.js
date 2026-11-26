// Small helpers shared by the prj01 functions.
import { SupabaseError } from './supabase.js';

export function bearer(request) {
  const h = request.headers.get('authorization') ?? '';
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(h);
  return m ? m[1] : null;
}

export function fail(e) {
  if (e instanceof SupabaseError) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 502;
    return Response.json({ ok: false, error: e.kind, message: e.message }, { status });
  }
  // Unknown error: its kind goes to the function log, nothing else.
  console.error('prj01 error', e?.name ?? 'Error');
  return Response.json({ ok: false, error: 'server_error', message: 'Something went wrong' }, { status: 500 });
}

export async function jsonBody(request) {
  try { return await request.json(); } catch { return {}; }
}
