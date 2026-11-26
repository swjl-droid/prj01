// Tests for the transcript drop point (prj01-R1 US-3). No network, no database, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readTranscript, IntakeError } from '../lib/intake/intake.js';
import { matchTranscript } from '../lib/intake/match.js';
import { sampleProjects } from '../lib/intake/check.js';

const long = (s) => `${s} `.repeat(Math.ceil(220 / (s.length + 1)));

test('intake refuses a wrong type, unreadable bytes and a text too short', () => {
  assert.throws(() => readTranscript({ name: 'minutes.docx', bytes: Buffer.from('x') }), /File type not accepted/);
  assert.throws(() => readTranscript({ name: 'a.txt', bytes: Buffer.from([0xff, 0xfe, 0x00, 0xd8]) }), /not readable text/);
  assert.throws(() => readTranscript({ name: 'a.txt', bytes: Buffer.from('Hello team.') }), IntakeError);
});

test('the duplicate fingerprint ignores spacing and case', () => {
  const a = readTranscript({ name: 'a.txt', text: 'Clinic relocation weekly sync. '.repeat(10) });
  const b = readTranscript({ name: 'b.txt', text: 'CLINIC  relocation\r\nweekly   sync. '.repeat(10) });
  assert.equal(a.sha256, b.sha256);
});

test('with no schedules imported yet, the project name alone can match', () => {
  const projects = [
    { id: 'a', name: 'Clinic relocation', summary: 'Move a clinic', items: [] },
    { id: 'b', name: 'Customer self-service portal', summary: 'Portal', items: [] },
  ];
  const m = matchTranscript(long('Update on the clinic relocation: the floor plan is signed off.'), projects);
  assert.equal(m.decision, 'matched');
  assert.equal(m.projectId, 'a');
});

test('two projects named equally: it asks and offers both', () => {
  const projects = [
    { id: 'a', name: 'Clinic relocation', summary: '', items: [] },
    { id: 'b', name: 'Regional office fit-out', summary: '', items: [] },
  ];
  const m = matchTranscript(long('We discussed the clinic relocation and the regional office fit-out.'), projects);
  assert.equal(m.decision, 'ask');
  assert.deepEqual(m.candidates.map((c) => c.projectId).sort(), ['a', 'b']);
});

test('a change of weights in settings changes the result, with no code change', async () => {
  const projects = await sampleProjects();
  const text = (await readFile('samples/transcripts/04-portal-sprint-review.txt', 'utf8'));
  assert.equal(matchTranscript(text, projects).decision, 'matched');
  assert.equal(matchTranscript(text, projects, { threshold: 0.9 }).decision, 'ask');
});

test('every match says why', async () => {
  const projects = await sampleProjects();
  const m = matchTranscript(await readFile('samples/transcripts/05-fit-out-site-walk.srt', 'utf8'), projects);
  assert.match(m.reason, /WP-31/);
});

// ---------- api/transcript.js with the database faked ----------
process.env.SUPABASE_URL = 'https://abc.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'pk_test';
const ORG = '11111111-1111-4111-8111-111111111111';

async function fakeDb() {
  const projects = (await sampleProjects()).map((p, i) => ({ ...p, id: `22222222-2222-4222-8222-00000000000${i}`, org_id: ORG }));
  const db = { transcripts: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    const q = (k) => (u.searchParams.get(k) || '').replace(/^eq\./, '');
    switch (u.pathname) {
      case '/rest/v1/orgs': return json([{ id: ORG, name: 'Sample programme (synthetic data)' }]);
      case '/rest/v1/projects': return json(projects.map(({ items: _i, ...p }) => p));
      case '/rest/v1/schedules': return json(projects.map((p) => ({ id: `s-${p.id}`, project_id: p.id })));
      case '/rest/v1/schedule_items': return json(projects.flatMap((p) => p.items.map((i) => ({ schedule_id: `s-${p.id}`, ...i }))));
      case '/rest/v1/transcripts': {
        if (init.method === 'POST') {
          const row = { id: `33333333-3333-4333-8333-00000000000${db.transcripts.length}`, created_at: '2026-11-26T13:00:00Z', ...JSON.parse(init.body) };
          if (db.transcripts.some((t) => t.org_id === row.org_id && t.content_sha256 === row.content_sha256)) return json({ code: '23505', message: 'duplicate' }, 409);
          db.transcripts.push(row);
          return json([row], 201);
        }
        if (init.method === 'PATCH') {
          const t = db.transcripts.find((x) => x.id === q('id'));
          if (!t) return json([]);
          Object.assign(t, JSON.parse(init.body));
          return json([t]);
        }
        if (q('content_sha256')) return json(db.transcripts.filter((t) => t.content_sha256 === q('content_sha256')));
        if (q('status')) return json(db.transcripts.filter((t) => t.status === q('status')));
        return json(db.transcripts.filter((t) => t.project_id === q('project_id')));
      }
      default: return json({ message: 'no route' }, 404);
    }
  };
  return { db, projects };
}

async function post(body) {
  const { POST } = await import('../api/transcript.js');
  const r = await POST(new Request('https://x/api/transcript', { method: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
const file = async (f) => ({ name: f, base64: (await readFile(`samples/transcripts/${f}`)).toString('base64') });

test('a clear transcript is stored as matched, with its project', async () => {
  const { db, projects } = await fakeDb();
  const r = await post(await file('01-clinic-weekly-sync.txt'));
  assert.equal(r.body.decision, 'matched');
  assert.equal(r.body.project.name, 'Clinic relocation');
  assert.equal(db.transcripts[0].status, 'matched');
  assert.equal(db.transcripts[0].project_id, projects[0].id);
});

test('an ambiguous transcript is stored waiting for the PM, who then picks the project', async () => {
  const { db, projects } = await fakeDb();
  const r = await post(await file('02-joint-steering-review.vtt'));
  assert.equal(r.body.decision, 'ask');
  assert.match(r.body.reason, /more than one project/);
  assert.equal(db.transcripts[0].status, 'needs_choice');
  assert.equal(db.transcripts[0].project_id, null);
  const c = await post({ action: 'confirm', id: r.body.id, projectId: projects[1].id });
  assert.equal(c.body.transcript.status, 'confirmed');
  assert.equal(db.transcripts[0].project_id, projects[1].id);
});

test('the same transcript dropped again is refused, with the date it came first', async () => {
  await fakeDb();
  await post(await file('04-portal-sprint-review.txt'));
  const again = await post({ paste: await readFile('samples/transcripts/04-portal-sprint-review.txt', 'utf8') });
  assert.equal(again.body.refused, true);
  assert.match(again.body.reasons[0], /Already dropped on 2026-11-26/);
});

test('a wrong file type is refused with its reason, nothing stored', async () => {
  const { db } = await fakeDb();
  const r = await post({ name: 'notes.pdf', base64: Buffer.from('%PDF-1.4').toString('base64') });
  assert.equal(r.body.refused, true);
  assert.match(r.body.reasons[0], /File type not accepted/);
  assert.equal(db.transcripts.length, 0);
});
