// Unit tests for lib/supabase.js and the functions (prj01-R1 US-1). No network: fetch is faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, signIn, signUp, loadProgramme, forgetMe, SupabaseError } from '../lib/supabase.js';

const cfg = { url: 'https://abc.supabase.co', key: 'pk_test' };

function fakeFetch(routes, seen = []) {
  return async (url, init) => {
    seen.push({ url, init });
    const path = url.replace(cfg.url, '');
    const r = routes.find(([p]) => path.startsWith(p));
    if (!r) return new Response('{"message":"no route"}', { status: 404 });
    const [, status, body] = r;
    return new Response(JSON.stringify(body), { status });
  };
}

test('config refuses a missing or odd project address', () => {
  assert.throws(() => config({}), SupabaseError);
  assert.throws(() => config({ SUPABASE_URL: 'http://evil.example', SUPABASE_PUBLISHABLE_KEY: 'k' }), SupabaseError);
  assert.deepEqual(config({ SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'k' }), { url: 'https://abc.supabase.co', key: 'k' });
});

test('sign-in returns the token and sends the publishable key', async () => {
  const seen = [];
  const s = await signIn(cfg, 'a@example.test', 'password1', {
    fetchImpl: fakeFetch([['/auth/v1/token', 200, { access_token: 't1', expires_in: 3600, user: { email: 'a@example.test' } }]], seen),
  });
  assert.equal(s.token, 't1');
  assert.equal(seen[0].init.headers.apikey, 'pk_test');
  assert.equal(seen[0].init.headers.Authorization, undefined);
});

test('a sign-up waiting for e-mail confirmation has no token', async () => {
  const s = await signUp(cfg, 'a@example.test', 'password1', { fetchImpl: fakeFetch([['/auth/v1/signup', 200, { id: 'u', email: 'a@example.test' }]]) });
  assert.equal(s.token, null);
  assert.equal(s.needsConfirmation, true);
});

test('a wrong password surfaces the kind, never the password', async () => {
  await assert.rejects(
    signIn(cfg, 'a@example.test', 'secretpass', { fetchImpl: fakeFetch([['/auth/v1/token', 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }]]) }),
    (e) => e instanceof SupabaseError && e.kind === 'invalid_credentials' && !e.message.includes('secretpass'),
  );
});

test('programme: starts the sample, reads app_prj01 with the person\'s token', async () => {
  const seen = [];
  const d = await loadProgramme(cfg, 'tok', { fetchImpl: fakeFetch([
    ['/rest/v1/rpc/start_sample', 200, 'o1'],
    ['/rest/v1/orgs', 200, [{ id: 'o1', name: 'Sample programme (synthetic data)', is_sample: true }]],
    ['/rest/v1/projects', 200, [{ id: 'p1', org_id: 'o1', name: 'A', methodology: 'Agile' }, { id: 'p2', org_id: 'o1', name: 'B', methodology: 'PRINCE2' }]],
  ], seen) });
  assert.equal(d.projectCount, 2);
  assert.equal(seen.length, 3);
  for (const s of seen) {
    assert.equal(s.init.headers.Authorization, 'Bearer tok');
    assert.equal(s.init.headers['Accept-Profile'], 'app_prj01');
  }
});

test('forget me calls the database function with the person\'s token', async () => {
  const seen = [];
  const r = await forgetMe(cfg, 'tok', { fetchImpl: fakeFetch([['/rest/v1/rpc/forget_me', 200, { 'auth.users': 1 }]], seen) });
  assert.equal(r['auth.users'], 1);
  assert.equal(seen[0].init.method, 'POST');
});

test('functions refuse a call without a sign-in token', async () => {
  process.env.SUPABASE_URL = cfg.url; process.env.SUPABASE_PUBLISHABLE_KEY = cfg.key;
  const { GET } = await import('../api/programme.js');
  const r = await GET(new Request('https://x/api/programme'));
  assert.equal(r.status, 401);
  const { POST } = await import('../api/forget-me.js');
  const f = await POST(new Request('https://x/api/forget-me', { method: 'POST', headers: { authorization: 'Bearer tok' }, body: '{"confirm":"no"}' }));
  assert.equal(f.status, 400);
});
