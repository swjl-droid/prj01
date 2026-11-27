// End-to-end test of api/minutes.js with the database and the model API faked: a transcript is drafted
// through the gateway, stored as a draft with the next version, read back and approved (prj01-R1 US-4).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://abc.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'pk_test';
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
process.env.TRACE_CONTENT = 'none';
const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const TR = '33333333-3333-4333-8333-333333333333';
const ME = '44444444-4444-4444-8444-444444444444';
const TEXT = ['Priya Raman: Morning all, can everyone hear me?', 'Marcus Lee: The movers quote came in at forty two thousand.',
  'Priya Raman: That is over budget. Marcus, get a second quote by Friday.', 'Marcus Lee: Okay, I will get it by Friday.',
  'Priya Raman: Next, the cutover weekend stays the 13th of February.', 'Marcus Lee: Agreed.'].join('\n');

const minutesInput = {
  meeting: { title: 'Weekly sync', attendees: ['Priya Raman', 'Marcus Lee'] },
  topics: [{
    title: 'Movers quote',
    summary: [{ text: 'The quote is 42,000, over budget.', quotes: [{ line: 2, text: 'The movers quote came in at forty two thousand.' }, { line: 3, text: 'That is over budget.' }] }],
    actions: [{ text: 'Second quote', owner: 'Marcus', due: 'Friday', quotes: [{ line: 3, text: 'Marcus, get a second quote by Friday.' }] }],
  }],
};

function fakes() {
  const seen = { model: [], inserts: [], patches: [] };
  const rows = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.hostname === 'api.anthropic.com') {
      seen.model.push(JSON.parse(init.body));
      return json({ type: 'message', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: 'tool_use', id: 'tu1', name: 'record_minutes', input: minutesInput }] });
    }
    if (u.hostname !== 'abc.supabase.co') return json({}, 202); // Langfuse and the like
    if (u.pathname === '/auth/v1/user') return json({ id: ME });
    if (u.pathname === '/rest/v1/transcripts') return json([{ id: TR, org_id: ORG, project_id: PROJECT, source_name: 'sync.txt', content: TEXT, status: 'matched' }]);
    if (u.pathname === '/rest/v1/projects') return json([{ id: PROJECT, name: 'Clinic relocation', methodology: 'PMI-PMBOK', summary: '' }, { id: 'x', name: 'Other', methodology: 'Agile', summary: '' }]);
    if (u.pathname === '/rest/v1/minutes' && (init.method ?? 'GET') === 'GET') return json(rows.slice(-1));
    if (u.pathname === '/rest/v1/minutes' && init.method === 'POST') {
      const b = JSON.parse(init.body); seen.inserts.push(b);
      const row = { id: '55555555-5555-4555-8555-55555555555' + rows.length, status: 'draft', ...b }; rows.push(row); return json([row], 201);
    }
    if (u.pathname === '/rest/v1/minutes' && init.method === 'PATCH') {
      const b = JSON.parse(init.body); seen.patches.push(b);
      const r = rows.at(-1); Object.assign(r, b); return json([r]);
    }
    return json({ message: 'no route' }, 404);
  };
  return seen;
}

const call = async (method, body, query = '') => {
  const mod = await import('../api/minutes.js');
  const req = new Request(`https://x/api/minutes${query}`, { method, headers: { authorization: 'Bearer tok' }, body: body ? JSON.stringify(body) : undefined });
  const r = await mod[method](req);
  return { status: r.status, body: await r.json() };
};

test('draft, store as the next version, read back and approve as oneself', async () => {
  const seen = fakes();
  const d = await call('POST', { transcriptId: TR });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(seen.model[0].model, 'claude-opus-5-5');
  assert.match(seen.model[0].messages[0].content, /Project: Clinic relocation[\s\S]*Other projects in the same organisation: Other\./);
  assert.equal(seen.inserts[0].version, 1);
  assert.equal(seen.inserts[0].org_id, ORG);
  assert.equal(seen.inserts[0].template, 'default v2');
  assert.equal(seen.inserts[0].checks.ok, true);
  assert.equal(d.body.minutes.content.topics[0].summary[0].quotes[0].line, 2);

  const again = await call('POST', { transcriptId: TR });
  assert.equal(seen.inserts[1].version, 2);

  const g = await call('GET', null, `?transcriptId=${TR}`);
  assert.equal(g.body.minutes.version, 2);
  assert.equal(g.body.lines.length, 6);

  const a = await call('POST', { action: 'approve', id: again.body.minutes.id });
  assert.equal(a.status, 200);
  assert.equal(seen.patches[0].status, 'approved');
  assert.equal(seen.patches[0].approved_by, ME);
});

test('no token, a bad id, or a transcript without a project is refused before any model call', async () => {
  const seen = fakes();
  const { POST } = await import('../api/minutes.js');
  assert.equal((await POST(new Request('https://x/api/minutes', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal((await call('POST', { transcriptId: 'nope' })).status, 400);
  globalThis.fetch = (orig => async (url, init) => (new URL(url).pathname === '/rest/v1/transcripts'
    ? new Response(JSON.stringify([{ id: TR, org_id: ORG, project_id: null, content: TEXT }]), { status: 200 }) : orig(url, init)))(globalThis.fetch);
  const r = await call('POST', { transcriptId: TR });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /project/);
  assert.equal(seen.model.length, 0);
});
