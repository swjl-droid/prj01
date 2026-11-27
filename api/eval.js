// Evaluation endpoint for prj01-R1 US-4 (previews only; production answers 404, and previews sit behind
// Vercel Authentication). Every call goes through the gateway, so it is costed and traced.
//   ?task=minutes&case=m01   minutes of mock transcript m01 (samples/meetings/), drafted by the app's own
//                            code, with the code checks: this is what the evaluation proves
//   ?task=probe              tiny calls that find which request setting the API refuses
// Builder-only model work (judges, mock dialogue) runs in a Claude session on John's plan, not here
// (decision 27/11/2026, Hub row 311): see scripts/judge-session.mjs.
// Synthetic data only: nothing here reads the database or any user's data.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGateway } from '../lib/gateway/index.js';
import { draftMinutes } from '../lib/minutes/draft.js';
import settings from '../lib/minutes/settings.json' with { type: 'json' };
import spec from '../samples/meetings/specs.json' with { type: 'json' };

const SAMPLE_PROJECTS = [
  { name: 'Clinic relocation', methodology: 'PMI-PMBOK', summary: 'Move a 40-staff outpatient clinic to a new building with no gap in appointments. Synthetic.' },
  { name: 'Regional office fit-out', methodology: 'PRINCE2', summary: 'Fit out a 2-floor regional office: design, contractor, IT and move-in stages. Synthetic.' },
  { name: 'Customer self-service portal', methodology: 'Agile', summary: 'Release a customer portal in 2-week sprints: sign-in, bills, service requests. Synthetic.' },
];

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
  if (!m || task !== 'minutes') return Response.json({ ok: false, error: 'task=minutes and case=m01..m10 (or task=probe)' }, { status: 400 });
  const gateway = createGateway({ app: 'prj01', timeoutMs: settings.timeoutMs });
  const started = Date.now();
  try {
    const out = await minutes(gateway, m);
    // pad: makes the answer large enough to be saved as a file on the evaluating side instead of read
    // into its context; it carries nothing.
    return Response.json({ ok: true, task, case: m.id, ms: Date.now() - started, ...out, pad: url.searchParams.has('pad') ? '.'.repeat(120000) : undefined });
  } catch (e) {
    return Response.json({ ok: false, task, case: m.id, errorType: e.type ?? e.kind ?? e.name, status: e.status ?? null, message: e.kind ? e.message : undefined }, { status: 502 });
  }
}
