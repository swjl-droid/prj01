// End-to-end test of api/schedule-import.js with the database faked: what the import sends to
// import_schedule() is stored as the database would store it, read back, and must equal the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.SUPABASE_URL = 'https://abc.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'pk_test';
const PROJECT = '11111111-1111-4111-8111-111111111111';

function fakeDatabase() {
  const db = { schedules: new Map() };
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (u.pathname === '/rest/v1/rpc/import_schedule') {
      const b = JSON.parse(init.body);
      if (b.p_project !== PROJECT) return json({ code: '42501', message: 'project not found' }, 403);
      const id = `22222222-2222-4222-8222-00000000000${db.schedules.size}`;
      db.schedules.set(id, {
        meta: { id, project_id: b.p_project, method: b.p_method, source_name: b.p_source, item_count: b.p_items.length, link_count: b.p_links.length, imported_at: '2026-11-26T12:00:00Z' },
        // As Postgres returns them: dates as yyyy-mm-dd, size as numeric text, empty text as null.
        items: b.p_items.map((i) => ({ key: i.key, name: i.name, type: i.type, parent: i.parent || null, start_date: i.start, finish_date: i.finish, duration: i.duration || null, size: i.size === null ? null : String(i.size), owner: i.owner || null, status: i.status || null, notes: i.notes || null, extras: i.extras })),
        links: b.p_links.map((l) => ({ from_key: l.from, to_key: l.to, link_type: l.type || 'FS', lag_days: l.lag || 0 })),
      });
      return json(id);
    }
    const id = (u.searchParams.get('id') || u.searchParams.get('schedule_id') || '').replace(/^eq\./, '');
    const s = db.schedules.get(id);
    if (u.pathname === '/rest/v1/schedules') return json(s ? [s.meta] : []);
    if (u.pathname === '/rest/v1/schedule_items') return json(s ? s.items : []);
    if (u.pathname === '/rest/v1/schedule_links') return json(s ? s.links : []);
    return json({ message: 'no route' }, 404);
  };
  return db;
}

async function post(body) {
  const { POST } = await import('../api/schedule-import.js');
  const r = await POST(new Request('https://x/api/schedule-import', { method: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}

test('all 8 mocks import and read back with 0 differences, as a folder in one call', async () => {
  fakeDatabase();
  const manifest = JSON.parse(await readFile('samples/schedules/manifest.json', 'utf8'));
  for (const m of manifest) {
    const base64 = (await readFile(`samples/schedules/${m.file}`)).toString('base64');
    const r = await post({ projectId: PROJECT, method: m.method, files: [{ name: m.file, base64 }] });
    assert.equal(r.status, 200);
    const [res] = r.body.results;
    assert.equal(res.ok, true, `${m.file}: ${JSON.stringify(res.reasons)}`);
    assert.equal(res.items, m.items, m.file);
    assert.equal(res.links, m.links, m.file);
    assert.equal(res.differences, 0, `${m.file}: ${JSON.stringify(res.firstDifferences)}`);
  }
});

test('a folder with a good and a bad file: the good one is stored, the bad one refused with reasons', async () => {
  fakeDatabase();
  const good = (await readFile('samples/schedules/pmi-2-clinic-relocation.csv')).toString('base64');
  const bad = (await readFile('samples/schedules/bad/unknown-link.csv')).toString('base64');
  const pdf = (await readFile('samples/schedules/bad/not-a-schedule.pdf')).toString('base64');
  const r = await post({ projectId: PROJECT, method: 'PMI-PMBOK', files: [{ name: 'a.csv', base64: good }, { name: 'b.csv', base64: bad }, { name: 'c.pdf', base64: pdf }] });
  const [a, b, c] = r.body.results;
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.match(b.reasons[0], /unknown key/);
  assert.equal(c.ok, false);
  assert.match(c.reasons[0], /File type not accepted/);
});

test('a paste is imported', async () => {
  fakeDatabase();
  const paste = 'Backlog Key\tStory / Spike / Enabler\tIssue Type\tSprint Start\tSprint End\tStory Points\tBlocked By\nUS-1\tLogin\tUser Story\t2026-11-16\t2026-11-27\t5\t\nUS-2\tLogout\tUser Story\t2026-11-16\t2026-11-27\t2\tUS-1\n';
  const r = await post({ projectId: PROJECT, method: 'Agile', paste });
  assert.equal(r.body.results[0].ok, true);
  assert.equal(r.body.results[0].differences, 0);
});

test('another organisation\'s project is refused', async () => {
  fakeDatabase();
  const paste = 'WBS ID,Task / Milestone,Artifact Type,Start Date,Finish Date\nT1,Design,Task,2026-10-01,2026-10-07\n';
  const r = await post({ projectId: '33333333-3333-4333-8333-333333333333', method: 'PMI-PMBOK', paste });
  assert.equal(r.body.results[0].ok, false);
  assert.match(r.body.results[0].reasons[0], /Project not found/);
});

test('no sign-in, no method or no project is refused', async () => {
  const { POST } = await import('../api/schedule-import.js');
  assert.equal((await POST(new Request('https://x', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal((await post({ projectId: PROJECT, method: 'SAFe', paste: 'x' })).status, 400);
  assert.equal((await post({ projectId: 'nope', method: 'Agile', paste: 'x' })).status, 400);
});
