// Sign-up, sign-in and sign-out for prj01 (prj01-R1 US-1). The browser posts here; this function
// asks Supabase Auth and returns only the sign-in token (kept in the tab's memory, never stored).
import { config, signIn, signUp, signOut } from '../lib/supabase.js';
import { bearer, fail, jsonBody } from '../lib/http.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function POST(request) {
  try {
    const cfg = config();
    const { action, email, password } = await jsonBody(request);
    if (action === 'signout') {
      const token = bearer(request);
      if (token) await signOut(cfg, token);
      return Response.json({ ok: true });
    }
    if (!['signin', 'signup'].includes(action)) {
      return Response.json({ ok: false, error: 'bad_request', message: 'Unknown action' }, { status: 400 });
    }
    if (typeof email !== 'string' || !EMAIL.test(email) || typeof password !== 'string' || password.length < 8 || password.length > 72) {
      return Response.json({ ok: false, error: 'bad_request', message: 'Enter an e-mail address and a password of 8 to 72 characters' }, { status: 400 });
    }
    const s = action === 'signup' ? await signUp(cfg, email, password) : await signIn(cfg, email, password);
    return Response.json({ ok: true, ...s });
  } catch (e) {
    return fail(e);
  }
}
