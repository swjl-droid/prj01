// prj01-R1 US-4, review method (Hub row 305): model judges and the final score. No network: the gateway
// is faked, so these tests check the verdict checks, the repair round and the scoring rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkVerdicts, judgeMinutes, minutesForJudge, judgeTool } from '../lib/minutes/judge.js';
import { itemResult, reviewStats, loadReview, storedReview } from '../lib/minutes/review.js';
import judgeSettings from '../lib/minutes/judge.json' with { type: 'json' };

const q = (line, text) => ({ line, text, found: true });
const MINUTES = {
  meeting: { title: 'Weekly sync', attendees: ['Priya Tan', 'Marcus Lee'] },
  topics: [
    { title: 'Movers quote', summary: [{ text: 'Quote is over budget.', quotes: [q(2, 'forty two thousand')] }], actions: [{ text: 'Second quote', owner: 'Ah Hock', due: 'Friday', quotes: [q(3, 'second quote by Friday')] }] },
    { title: 'Next steps', summary: [{ text: 'Wrap up.', quotes: [q(4, 'chase it')] }], actions: [] },
  ],
  raidd: [{ type: 'issue', change: 'new', title: 'Quote over budget', topic: 1, quotes: [q(3, "That's over budget")] }],
};
const RAW = ['Priya Tan: Morning all.', 'Marcus Lee: The movers quote came in at forty two thousand.', "Priya Tan: That's over budget. Let's ask Ah Hock for a second quote by Friday.", "Marcus Lee: I'll get Ah Hock to chase it.", 'Priya Tan: Thanks all.'].join('\n');

test('the judge sees every topic and RAIDD row with an id and its quotes', () => {
  const text = minutesForJudge(MINUTES);
  assert.match(text, /^T1\. Movers quote/m);
  assert.match(text, /^T2\. Next steps/m);
  assert.match(text, /Actions: none/);
  assert.match(text, /^R1\. issue \| new \| Quote over budget \| topic 1 \[L3\]/m);
  assert.deepEqual(judgeTool().input_schema.properties.topics.items.properties.verdict.enum, ['ok', 'needs_edit']);
});

test('verdicts: one per item, unknown, duplicate and missing items are problems', () => {
  const good = checkVerdicts({ topics: [{ item: 'T1', verdict: 'ok', reason: 'fine' }, { item: 't2', verdict: 'needs_edit', reason: 'x' }], raidd: [{ item: 'R1', verdict: 'ok', reason: 'y' }], missing: [] }, MINUTES);
  assert.deepEqual(good.problems, []);
  assert.equal(good.topics.T2.verdict, 'needs_edit');
  const bad = checkVerdicts({ topics: [{ item: 'T1', verdict: 'ok' }, { item: 'T1', verdict: 'ok' }, { item: 'T9', verdict: 'ok' }], raidd: [{ item: 'R1', verdict: 'fine' }] }, MINUTES);
  assert.ok(bad.problems.includes('T1 judged twice'));
  assert.ok(bad.problems.includes('unknown item T9'));
  assert.ok(bad.problems.includes('T2 has no verdict'));
  assert.ok(bad.problems.some((p) => p.startsWith('R1: verdict')));
});

test('judge: a missing verdict gets one repair round, then the result is returned', async () => {
  const seen = [];
  const answers = [
    { topics: [{ item: 'T1', verdict: 'ok', reason: 'a' }], raidd: [{ item: 'R1', verdict: 'ok', reason: 'b' }], missing: [] },
    { topics: [{ item: 'T1', verdict: 'ok', reason: 'a' }, { item: 'T2', verdict: 'ok', reason: 'c' }], raidd: [{ item: 'R1', verdict: 'needs_edit', reason: 'wrong type' }], missing: [{ type: 'risk', title: 'Weekend move', line: 4 }] },
  ];
  const gateway = { call: async (req) => { seen.push(req); const input = answers[seen.length - 1]; return { message: { content: [{ type: 'tool_use', id: `t${seen.length}`, name: 'record_verdicts', input }] }, costUsd: 0.01 }; } };
  const r = await judgeMinutes({ gateway, raw: RAW, minutes: MINUTES, project: { name: 'Clinic' }, model: 'claude-sonnet-5-5' });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].purpose, 'minutes-judge');
  assert.equal(seen[1].purpose, 'minutes-judge-repair');
  assert.equal(seen[0].tool_choice, undefined);
  assert.match(seen[0].messages[0].content, /\[L2\] Marcus Lee: The movers quote/);
  assert.deepEqual(r.problems, []);
  assert.equal(r.raidd.R1.verdict, 'needs_edit');
  assert.equal(r.missing.length, 1);
  assert.equal(r.costUsd, 0.02);
});

test('judge: no verdicts at all is an error, not a pass', async () => {
  const gateway = { call: async () => ({ message: { content: [{ type: 'text', text: 'Looks fine' }] } }) };
  await assert.rejects(judgeMinutes({ gateway, raw: RAW, minutes: MINUTES, model: 'claude-opus-5-5' }), (e) => e.kind === 'no_verdicts');
});

test('final verdict: John first, then agreeing judges, else not OK', () => {
  const ok = { verdict: 'ok' }, ne = { verdict: 'needs_edit' };
  assert.deepEqual(itemResult([ok, ok], undefined), { aligned: true, judgesVerdict: 'ok', final: 'ok', by: 'judges' });
  assert.deepEqual(itemResult([ok, ok], 'skipped'), { aligned: true, judgesVerdict: 'ok', final: 'ok', by: 'judges' });
  assert.equal(itemResult([ok, ok], 'needs_edit').final, 'needs_edit');
  assert.equal(itemResult([ok, ne], 'skipped').final, 'needs_edit');
  assert.equal(itemResult([ok, ne], 'ok').by, 'john');
  assert.equal(itemResult([ne, ne], 'skipped').final, 'needs_edit');
  assert.equal(itemResult([ok, undefined], undefined).aligned, false);
});

test("John's worked example: 10 items, score 90 %", () => {
  // Judges agree OK on items 1-8 and disagree on 9-10; John: OK on 2, 3, 9, 10, Needs edit on 1, skips 4-8.
  const judges = { sonnet: { topics: {} }, opus: { topics: {} } };
  for (let i = 1; i <= 10; i += 1) {
    judges.sonnet.topics[`T${i}`] = { verdict: 'ok' };
    judges.opus.topics[`T${i}`] = { verdict: i <= 8 ? 'ok' : 'needs_edit' };
  }
  const john = { T1: 'needs_edit', T2: 'ok', T3: 'ok', T4: 'skipped', T5: 'skipped', T6: 'skipped', T7: 'skipped', T8: 'skipped', T9: 'ok', T10: 'ok' };
  const s = reviewStats([{ id: 'x', counts: { topics: 10, raidd: 0 }, judges, john }], { judgeIds: ['sonnet', 'opus'], bars: { topics: 0.7, raidd: 0.8 } });
  assert.equal(s.topics.finalOk, 9);
  assert.equal(s.topics.finalOkShare, 0.9);
  assert.equal(s.topics.misaligned, 2);
  assert.equal(s.topics.alignedOk, 8);
  assert.equal(s.topics.byJohn, 5);
  assert.equal(s.topics.pass, true);
  assert.equal(s.raidd.pass, false, 'no RAIDD rows means no pass');
});

test('bars come from judge.json: 70 % of topics, 80 % of RAIDD rows', () => {
  assert.deepEqual(judgeSettings.bars, { topics: 0.7, raidd: 0.8 });
  assert.deepEqual(judgeSettings.judges.map((j) => j.model), ['claude-sonnet-5-5', 'claude-opus-5-5']);
});

test('stored review: every stored judge file covers each item of its minutes', async () => {
  const cases = await loadReview();
  assert.equal(cases.length, 10);
  for (const c of cases) {
    for (const j of judgeSettings.judges) {
      for (let i = 1; i <= c.counts.topics; i += 1) assert.ok(c.judges[j.id].topics[`T${i}`], `${c.id} ${j.id} T${i}`);
      for (let i = 1; i <= c.counts.raidd; i += 1) assert.ok(c.judges[j.id].raidd[`R${i}`], `${c.id} ${j.id} R${i}`);
    }
  }
  const r = await storedReview();
  assert.equal(typeof r.topicsPass, 'boolean');
});
