// prj01-R1 US-4: minutes engine. No network: the gateway is faked, so these tests check the transcript
// parsing, the quote checks, the repair round and the rendering, not the model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechLines, numbered } from '../lib/minutes/transcript.js';
import { verifyMinutes } from '../lib/minutes/verify.js';
import { draftMinutes } from '../lib/minutes/draft.js';
import { minutesMarkdown } from '../lib/minutes/render.js';
import template from '../lib/minutes/template.json' with { type: 'json' };

const VTT = `WEBVTT

NOTE synthetic

1
00:00:05.000 --> 00:00:09.000
<v Priya Tan>Morning all, um, can everyone hear me?

2
00:00:10.000 --> 00:00:20.000
<v Marcus Lee>Yes. So the movers quote came in at, uh, forty two thousand.

3
00:00:21.000 --> 00:00:30.000
<v Priya Tan>That's over budget. Let's ask Ah Hock for a second quote by Friday.

4
00:00:31.000 --> 00:00:40.000
<v Marcus Lee>Okay, I'll, I'll get Ah Hock to chase it.

5
00:00:41.000 --> 00:00:50.000
<v Priya Tan>Next item, the IT cutover weekend is still the 14th of February.
`;

const project = { name: 'Clinic relocation', methodology: 'PMI-PMBOK', summary: 'Synthetic.' };

test('speech lines from a Teams/Zoom .vtt keep speaker and time, drop cue numbers and headers', () => {
  const lines = speechLines(VTT);
  assert.equal(lines.length, 5);
  assert.deepEqual(lines[1], { n: 2, speaker: 'Marcus Lee', time: '00:00:10.000', text: 'Yes. So the movers quote came in at, uh, forty two thousand.' });
  assert.match(numbered(lines), /^\[L1\] \(00:00:05\.000\) Priya Tan: Morning all/);
});

test('speech lines from "Name: text" and .srt formats', () => {
  const plain = speechLines('Priya: we start\nMarcus Lee (Facilities): the lift is booked\n\nsome untagged line');
  assert.deepEqual(plain.map((l) => l.speaker), ['Priya', 'Marcus Lee (Facilities)', null]);
  const srt = speechLines('1\n00:00:01,000 --> 00:00:03,000\nPriya: hello there\n\n2\n00:00:04,000 --> 00:00:06,000\nMarcus: hi');
  assert.deepEqual(srt.map((l) => [l.time, l.speaker, l.text]), [['00:00:01.000', 'Priya', 'hello there'], ['00:00:04.000', 'Marcus', 'hi']]);
});

function good() {
  return {
    meeting: { title: 'Clinic weekly sync', date: '', attendees: ['Priya Tan', 'Marcus Lee'] },
    topics: [{
      title: 'Movers quote',
      summary: [{ text: 'The movers quote is 42,000 and over budget.', quotes: [{ line: 2, text: 'the movers quote came in at, uh, forty two thousand' }, { line: 3, text: "That’s over budget." }] }],
      actions: [{ text: 'Get a second quote', owner: 'Ah Hock', due: 'Friday', quotes: [{ line: 3, text: 'ask Ah Hock for a second quote by Friday' }] }],
    }],
    raidd: [{ type: 'issue', change: 'new', title: 'Movers quote over budget', topic: 1, quotes: [{ line: 3, text: "That's over budget." }] }],
  };
}

test('exact quotes pass, with case, spacing and curly quotes ignored', () => {
  const { checks } = verifyMinutes(good(), speechLines(VTT), template);
  assert.equal(checks.ok, true, JSON.stringify(checks.problems));
  assert.equal(checks.stats.exact, 4);
  assert.equal(checks.stats.raidd, 1);
});

test('a topic title loses the number the model put in front of it', () => {
  const m = good();
  m.topics[0].title = '1. Movers quote';
  assert.equal(verifyMinutes(m, speechLines(VTT), template).minutes.topics[0].title, 'Movers quote');
});

test('a quote cited on the wrong line is moved to the line that has it', () => {
  const m = good();
  m.topics[0].summary[0].quotes[0].line = 5;
  const { minutes, checks } = verifyMinutes(m, speechLines(VTT), template);
  assert.equal(checks.ok, true);
  assert.equal(checks.stats.relocated, 1);
  assert.equal(minutes.topics[0].summary[0].quotes[0].line, 2);
});

test('an invented or reworded quote, a point with no quote, an unknown owner and a long quote all fail', () => {
  const m = good();
  m.topics[0].summary[0].quotes[1].text = 'That is over the budget';                  // reworded
  m.topics[0].summary.push({ text: 'Everyone agreed to delay the move.', quotes: [] }); // no quote
  m.topics[0].actions[0].owner = 'Daniel';                                            // not in the meeting
  m.topics[0].actions[0].quotes.push({ line: 2, text: 'Yes. So the movers quote came in at, uh, forty two thousand. '.repeat(5) });
  const kinds = verifyMinutes(m, speechLines(VTT), template).checks.problems.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['long_quote', 'no_quote', 'owner_not_in_transcript', 'quote_not_found', 'quote_not_found']);
});

test('RAIDD table (template v3): a bad type, change or topic, a missing quote, a duplicate item and a missing table fail', () => {
  const lines = speechLines(VTT);
  const m = good();
  m.raidd.push({ type: 'action', change: 'maybe', title: 'Second quote', topic: 7, quotes: [{ line: 3, text: 'second quote by Friday' }] });
  m.raidd.push({ type: 'decision', change: 'new', title: 'Cutover date', topic: 1, quotes: [] });
  const kinds = verifyMinutes(m, lines, template).checks.problems.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['bad_change', 'bad_topic', 'bad_type', 'duplicate_raidd', 'no_quote']);
  const none = good(); delete none.raidd;
  assert.deepEqual(verifyMinutes(none, lines, template).checks.problems.map((p) => p.kind), ['no_raidd']);
  const empty = good(); empty.raidd = [];
  assert.equal(verifyMinutes(empty, lines, template).checks.ok, true);
});

test('the prompt carries the shared RAIDD rules and the tool asks for the table', async () => {
  const { minutesTool, systemPrompt } = await import('../lib/minutes/prompt.js');
  const tool = minutesTool(template);
  assert.deepEqual(tool.input_schema.required, ['meeting', 'topics', 'raidd']);
  assert.deepEqual(tool.input_schema.properties.raidd.items.properties.type.enum, ['risk', 'assumption', 'issue', 'dependency', 'decision']);
  const sys = systemPrompt(template);
  assert.match(sys, /An action \(who does what, by when\) is not a RAIDD entry/);
  assert.match(sys, /An assumption that turns out false becomes an issue/);
});

function fakeGateway(answers) {
  const seen = [];
  return {
    seen,
    async call(req) {
      seen.push(req);
      const input = answers[seen.length - 1];
      return { message: { content: [{ type: 'tool_use', id: `tu${seen.length}`, name: 'record_minutes', input }] }, costUsd: 0.05, latencyMs: 10, usage: {}, traceId: 't', logged: {} };
    },
  };
}

test('draft: tool call with the template; a failed check gets one repair round', async () => {
  const bad = good();
  bad.topics[0].summary[0].quotes[0].text = 'the quote was forty-two thousand dollars';
  const gw = fakeGateway([bad, good()]);
  const r = await draftMinutes({ gateway: gw, raw: VTT, project, source: 'sync.vtt' });
  assert.equal(gw.seen.length, 2);
  assert.equal(gw.seen[0].model, 'claude-opus-5-5');
  assert.equal(gw.seen[0].tools[0].name, 'record_minutes');
  assert.equal(gw.seen[0].tool_choice, undefined); // the API refuses a forced tool on these models
  assert.match(gw.seen[0].system, /Write only what was said in the meeting/);
  assert.equal(gw.seen[1].purpose, 'minutes-repair');
  assert.match(gw.seen[1].messages.at(-1).content[0].content, /is not in line 2 nor anywhere/);
  assert.equal(r.checks.ok, true);
  assert.equal(r.calls.length, 2);
  assert.ok(Math.abs(r.costUsd - 0.10) < 1e-9);
});

test('draft: no more than one repair round; the failure stays visible', async () => {
  const bad = good();
  bad.topics[0].summary[0].quotes[0].text = 'invented words';
  const gw = fakeGateway([bad, bad, bad]);
  const r = await draftMinutes({ gateway: gw, raw: VTT, project });
  assert.equal(gw.seen.length, 2);
  assert.equal(r.checks.ok, false);
  assert.equal(r.checks.stats.missing, 1);
});

test('markdown: numbered topics, discussion and actions, each point followed by its quotes', () => {
  const lines = speechLines(VTT);
  const { minutes } = verifyMinutes(good(), lines, template);
  const md = minutesMarkdown({ minutes, project, lines });
  assert.match(md, /^# Clinic weekly sync/);
  assert.match(md, /## 1\. Movers quote\n\n\*\*Discussion\*\*/);
  assert.match(md, /> L3 \(00:00:21\.000\): "ask Ah Hock for a second quote by Friday"/);
  assert.match(md, /owner: Ah Hock, due: Friday/);
  assert.match(md, /## RAIDD\n\n\| # \| Type \| New or update \| Item \| Topic \|/);
  assert.match(md, /\| 1 \| issue \| new \| Movers quote over budget \| 1 \|/);
});
