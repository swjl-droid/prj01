// Evaluation endpoint for prj01-R1 US-4 (previews only; production answers 404, and previews sit behind
// Vercel Authentication). Every call goes through the gateway, so it is costed and traced.
//   ?task=dialogue&case=m01  the natural discussion of mock meeting m01 around its hand-written lines
//                            (samples/meetings/specs.json), written by the model in two halves at once
//   ?task=minutes&case=m01   minutes of mock transcript m01 (samples/meetings/), with the code checks
// Synthetic data only: nothing here reads the database or any user's data.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGateway } from '../lib/gateway/index.js';
import { draftMinutes } from '../lib/minutes/draft.js';
import settings from '../lib/minutes/settings.json' with { type: 'json' };
import spec from '../samples/meetings/specs.json' with { type: 'json' };

const DIALOGUE_MODEL = 'claude-sonnet-5-5';
const SAMPLE_PROJECTS = [
  { name: 'Clinic relocation', methodology: 'PMI-PMBOK', summary: 'Move a 40-staff outpatient clinic to a new building with no gap in appointments. Synthetic.' },
  { name: 'Regional office fit-out', methodology: 'PRINCE2', summary: 'Fit out a 2-floor regional office: design, contractor, IT and move-in stages. Synthetic.' },
  { name: 'Customer self-service portal', methodology: 'Agile', summary: 'Release a customer portal in 2-week sprints: sign-in, bills, service requests. Synthetic.' },
];

const dialogueTool = {
  name: 'record_dialogue',
  description: 'Record the meeting conversation, one entry per spoken turn.',
  input_schema: {
    type: 'object', required: ['lines'],
    properties: {
      lines: {
        type: 'array',
        items: {
          type: 'object', required: ['who', 'text'],
          properties: {
            who: { type: 'string', description: 'Speaker key from the attendee list' },
            text: { type: 'string' },
            beat: { type: 'string', description: 'The beat id, only on a line that is one of the given beats, copied word for word' },
          },
        },
      },
    },
  },
};

function dialoguePrompt(m, topics, half) {
  const people = m.attendees.map((a) => `${a.key} = ${a.name}${a.team ? ` (${a.team})` : ''}${a.dialIn ? ` (dial-in, shown as "${a.dialIn}")` : ''}`).join('; ');
  const beats = topics.map((t) => [
    `Topic "${t.title}" (opened by ${m.chair}: "${t.intro}")`,
    ...t.beats.map((b, i) => `  beat ${t.key}.${i + 1}, ${b.who}: "${b.say}"`),
  ].join('\n')).join('\n');
  return [
    `Write the ${half} of a realistic ${m.title} (${m.project}, ${m.date}), a 30-minute video meeting of a synthetic project.`,
    `Attendees (key = name): ${people}. Chair: ${m.chair}.`,
    half === 'first half' ? `Start with people joining, small sound or screen trouble and a little small talk, then the chair opens: "${m.agendaLine}".` : 'Start straight into the next topic; end with a short wrap-up and goodbyes.',
    'Cover these topics in this order. Each beat must appear exactly once, word for word, said by its speaker, with its beat id:',
    beats,
    'Around the beats, write the natural discussion of a real meeting: questions and answers, people checking figures, thinking aloud, mild disagreement, going back to an earlier point, short side remarks, people talking over each other, "mm-hm" and "right". Spoken style, not polished.',
    'Strict rule: add no new decision, action, risk, issue, assumption, dependency, date, amount or name beyond what the beats say. Discussion may question or restate the beats, but must not change them.',
    'Length: about 2,000 words for this half. Answer only by calling record_dialogue.',
  ].join('\n');
}

async function dialogue(gateway, m) {
  const mid = Math.ceil(m.topics.length / 2);
  const halves = [['first half', m.topics.slice(0, mid)], ['second half', m.topics.slice(mid)]];
  const results = await Promise.all(halves.map(([half, topics]) => gateway.call({
    purpose: 'eval-mock-dialogue', model: DIALOGUE_MODEL, max_tokens: 6000,
    messages: [{ role: 'user', content: dialoguePrompt(m, topics, half) }],
    tools: [dialogueTool],
  })));
  const lines = results.flatMap((r) => r.message.content.find((c) => c.type === 'tool_use')?.input?.lines ?? []);
  return { lines, calls: results.map((r) => ({ costUsd: r.costUsd, latencyMs: r.latencyMs, usage: r.usage, traceId: r.traceId, logged: r.logged })) };
}

async function minutes(gateway, m) {
  const raw = readFileSync(join(process.cwd(), 'samples', 'meetings', m.file), 'utf8');
  const project = SAMPLE_PROJECTS.find((p) => p.name === m.project);
  const otherProjects = SAMPLE_PROJECTS.filter((p) => p !== project);
  const r = await draftMinutes({ gateway, raw, project, otherProjects, source: m.file });
  return { minutes: r.minutes, checks: r.checks, template: r.template, model: r.model, calls: r.calls, costUsd: r.costUsd };
}

// Tiny calls that differ in one setting, to find which one the API refuses (the gateway reports the
// error type only, never the API's message).
async function probe(gateway) {
  const tiny = { name: 'say', description: 'Say a word', input_schema: { type: 'object', properties: { w: { type: 'string' } }, required: ['w'] } };
  const base = { max_tokens: 50, messages: [{ role: 'user', content: 'Say ok.' }] };
  const variants = {
    haiku_plain: { model: 'claude-haiku-5-5' },
    sonnet_plain: { model: 'claude-sonnet-5-5' },
    opus_plain: { model: 'claude-opus-5-5' },
    sonnet_tool_auto: { model: 'claude-sonnet-5-5', tools: [tiny] },
    sonnet_tool_forced: { model: 'claude-sonnet-5-5', tools: [tiny], tool_choice: { type: 'tool', name: 'say' } },
    sonnet_tool_any: { model: 'claude-sonnet-5-5', tools: [tiny], tool_choice: { type: 'any' } },
    sonnet_6000: { model: 'claude-sonnet-5-5', max_tokens: 6000 },
    opus_12000: { model: 'claude-opus-5-5', max_tokens: 12000 },
  };
  const out = {};
  for (const [k, v] of Object.entries(variants)) {
    try { const r = await gateway.call({ purpose: 'eval-probe', ...base, ...v }); out[k] = { ok: true, stop: r.message.stop_reason, costUsd: r.costUsd }; } catch (e) { out[k] = { ok: false, errorType: e.type, status: e.status ?? null }; }
  }
  return { probe: out };
}

export async function GET(request) {
  if (process.env.VERCEL_ENV !== 'preview') return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  if (url.searchParams.get('task') === 'probe') return Response.json(await probe(createGateway({ app: 'prj01' })));
  const m = spec.meetings.find((x) => x.id === url.searchParams.get('case'));
  const task = url.searchParams.get('task');
  if (!m || !['dialogue', 'minutes'].includes(task)) return Response.json({ ok: false, error: 'task=dialogue|minutes and case=m01..m10' }, { status: 400 });
  const gateway = createGateway({ app: 'prj01', timeoutMs: settings.timeoutMs });
  const started = Date.now();
  try {
    const out = task === 'dialogue' ? await dialogue(gateway, m) : await minutes(gateway, m);
    // pad: makes the answer large enough to be saved as a file on the evaluating side instead of read
    // into its context; it carries nothing.
    return Response.json({ ok: true, task, case: m.id, ms: Date.now() - started, ...out, pad: url.searchParams.has('pad') ? '.'.repeat(120000) : undefined });
  } catch (e) {
    return Response.json({ ok: false, task, case: m.id, errorType: e.type ?? e.kind ?? e.name, status: e.status ?? null, message: e.kind ? e.message : undefined }, { status: 502 });
  }
}
