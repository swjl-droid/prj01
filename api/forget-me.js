// Forget me (CLAUDE.md "Forget me"): deletes the signed-in person's account and data, keeps cost and
// audit rows without the link, and logs the request with counts only (app_prj01.forget_me()).
import { config, forgetMe } from '../lib/supabase.js';
import { bearer, fail, jsonBody } from '../lib/http.js';

export async function POST(request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ ok: false, error: 'not_signed_in', message: 'Please sign in' }, { status: 401 });
    const { confirm } = await jsonBody(request);
    if (confirm !== 'FORGET ME') {
      return Response.json({ ok: false, error: 'bad_request', message: 'Type FORGET ME to confirm' }, { status: 400 });
    }
    return Response.json({ ok: true, removed: await forgetMe(config(), token) });
  } catch (e) {
    return fail(e);
  }
}
