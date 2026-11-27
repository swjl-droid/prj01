// Model judge for drafted minutes (prj01-R1 US-4, review method decided by John 27/11/2026, Hub row 305).
// Plain English: a second pair of eyes. The judge reads the transcript and the minutes and says, for each
// topic and each RAIDD row, "OK" (a project manager would keep it as it is) or "Needs edit", with a reason.
// Several judges (judge.json) each give their own verdicts; review.js combines them with John's.
// Nothing is stored here; the caller keeps the result.
import template from './template.json' with { type: 'json' };
import judgeSettings from './judge.json' with { type: 'json' };
import raiddRules from '../raidd/rules.json' with { type: 'json' };
import { speechLines, numbered } from './transcript.js';
import { raiddGuide } from './prompt.js';

export class JudgeError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

export const VERDICTS = ['ok', 'needs_edit'];

const verdictItem = (prefix) => ({
  type: 'object', required: ['item', 'verdict', 'reason'],
  properties: {
    item: { type: 'string', description: `The item id as shown, e.g. ${prefix}1` },
    verdict: { type: 'string', enum: VERDICTS },
    reason: { type: 'string', description: 'One or two short sentences; for needs_edit, say what is wrong and what the fix is' },
  },
});

export function judgeTool() {
  return {
    name: 'record_verdicts',
    description: 'Record one verdict per topic and per RAIDD row of the minutes.',
    input_schema: {
      type: 'object', required: ['topics', 'raidd', 'missing'],
      properties: {
        topics: { type: 'array', items: verdictItem('T') },
        raidd: { type: 'array', items: verdictItem('R') },
        missing: {
          type: 'array', description: 'Risks, assumptions, issues, dependencies or decisions discussed in the meeting but absent from the RAIDD table (information only); empty when none',
          items: { type: 'object', required: ['type', 'title', 'line'], properties: { type: { type: 'string', enum: raiddRules.types.map((t) => t.id) }, title: { type: 'string' }, line: { type: 'integer' } } },
        },
      },
    },
  };
}

const q = (quotes) => quotes.map((x) => `[L${x.line}] "${x.text}"`).join(' ');

/** The minutes as the judge sees them: topics T1.., RAIDD rows R1.., every point with its quotes. */
export function minutesForJudge(minutes) {
  const out = [];
  minutes.topics.forEach((t, i) => {
    out.push(`T${i + 1}. ${t.title}`);
    t.summary.forEach((p) => out.push(`  - ${p.text} ${q(p.quotes)}`));
    if (!t.actions.length) out.push('  Actions: none');
    t.actions.forEach((a) => out.push(`  Action: ${a.text} | owner: ${a.owner || '-'} | due: ${a.due || '-'} ${q(a.quotes)}`));
  });
  out.push('', 'RAIDD table:');
  if (!minutes.raidd.length) out.push('  (empty)');
  minutes.raidd.forEach((r, i) => out.push(`R${i + 1}. ${r.type} | ${r.change} | ${r.title} | topic ${r.topic} ${q(r.quotes)}`));
  return out.join('\n');
}

export function judgeSystem(tpl = template, rules = raiddRules) {
  return [
    'You check meeting minutes written by another assistant for a project manager, against the transcript and the template below.',
    'Give each topic (T1, T2, ...) and each RAIDD row (R1, R2, ...) exactly one verdict:',
    '- ok: a careful project manager would keep it as it is.',
    '- needs_edit: something must change before it can be kept.',
    'A topic needs an edit when a point is not supported by its quotes or the transcript, misstates where the discussion landed, misses a decision or action agreed in that topic, gets an owner or date wrong, or adds something not said. Minor wording does not make it needs_edit.',
    'A RAIDD row needs an edit when it is not a real RAIDD item under the rules (e.g. an action or a plain status), has the wrong type or wrong new/update, repeats another row, points to the wrong topic, or its quotes do not support it.',
    `Template "${tpl.id}" v${tpl.version}:`,
    `- Topic summary: ${tpl.topic.summary}`,
    `- Topic actions: ${tpl.topic.actions}`,
    ...tpl.rules.map((r) => `- ${r}`),
    `- RAIDD table: ${tpl.raidd}`,
    ...raiddGuide(rules),
    'Also list, as information only, any RAIDD item the meeting discussed that the table misses.',
    'Judge only from the transcript; do not use outside knowledge. Answer only by calling record_verdicts.',
  ].join('\n');
}

export function judgeUser({ lines, minutes, project }) {
  return [
    `Project: ${project?.name ?? 'unknown'}.`,
    'Transcript, one numbered line per speech line:',
    numbered(lines),
    '',
    'Minutes to check:',
    minutesForJudge(minutes),
  ].join('\n');
}

/** Checks the judge gave one valid verdict per item; returns the verdicts by item id and the problems. */
export function checkVerdicts(input, minutes) {
  const problems = [];
  const pick = (list, prefix, count) => {
    const byId = {};
    for (const v of Array.isArray(list) ? list : []) {
      const id = String(v?.item ?? '').trim().toUpperCase();
      if (!new RegExp(`^${prefix}([1-9]\\d*)$`).test(id) || Number(id.slice(1)) > count) { problems.push(`unknown item ${v?.item}`); continue; }
      if (!VERDICTS.includes(v.verdict)) { problems.push(`${id}: verdict must be ok or needs_edit`); continue; }
      if (byId[id]) { problems.push(`${id} judged twice`); continue; }
      byId[id] = { verdict: v.verdict, reason: String(v.reason ?? '').trim() };
    }
    for (let i = 1; i <= count; i += 1) if (!byId[`${prefix}${i}`]) problems.push(`${prefix}${i} has no verdict`);
    return byId;
  };
  const topics = pick(input?.topics, 'T', minutes.topics.length);
  const raidd = pick(input?.raidd, 'R', minutes.raidd.length);
  const missing = (Array.isArray(input?.missing) ? input.missing : []).map((m) => ({ type: m.type, title: String(m.title ?? ''), line: m.line }));
  return { topics, raidd, missing, problems };
}

/** One judge's verdicts on one set of minutes: one call, at most cfg.repairRounds repair calls. */
export async function judgeMinutes({ gateway, raw, minutes, project, model, tpl = template, cfg = judgeSettings }) {
  if (!model) throw new JudgeError('no_model', 'A judge model is required');
  const lines = speechLines(raw);
  const tool = judgeTool();
  const messages = [{ role: 'user', content: judgeUser({ lines, minutes, project }) }];
  const calls = [];
  let result;
  for (let round = 0; round <= cfg.repairRounds; round += 1) {
    const r = await gateway.call({
      purpose: round === 0 ? 'minutes-judge' : 'minutes-judge-repair',
      // tool_choice stays auto: the API refuses a forced tool on these models (probe 27/11/2026).
      model, max_tokens: cfg.maxTokens, system: judgeSystem(tpl), messages, tools: [tool],
    });
    calls.push({ round, costUsd: r.costUsd, latencyMs: r.latencyMs, usage: r.usage, traceId: r.traceId, logged: r.logged });
    const use = r.message?.content?.find((c) => c.type === 'tool_use' && c.name === 'record_verdicts');
    if (!use) throw new JudgeError('no_verdicts', 'The judge did not return verdicts');
    result = checkVerdicts(use.input, minutes);
    if (!result.problems.length || round === cfg.repairRounds) break;
    messages.push({ role: 'assistant', content: r.message.content });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, content: `Call record_verdicts again with every verdict. Problems: ${result.problems.join('; ')}` }] });
  }
  return { model, ...result, calls, costUsd: calls.reduce((s, c) => s + (c.costUsd ?? 0), 0) };
}
