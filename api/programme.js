// The signed-in person's programme (prj01-R1 US-1): their organisations and projects, as RLS
// allows. The first call creates their own synthetic sample programme.
import { config, loadProgramme } from '../lib/supabase.js';
import { bearer, fail } from '../lib/http.js';

export async function GET(request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ ok: false, error: 'not_signed_in', message: 'Please sign in' }, { status: 401 });
    return Response.json({ ok: true, ...(await loadProgramme(config(), token)) });
  } catch (e) {
    return fail(e);
  }
}
