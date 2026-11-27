// Runs the minutes judges from a Claude session on John's plan, not through the API (decision 27/11/2026,
// Hub row 311: builder-only model work stays off the API). Plain English: this script hands a judge the
// same instructions the old API route used, then checks and stores what the judge answers.
//
//   node scripts/judge-session.mjs prompt <case> [out.md]
//       writes the judge's instructions, the numbered transcript, the minutes (T1.., R1..) and the answer
//       format for meeting <case> (m01..m10)
//   node scripts/judge-session.mjs store <case> <judgeId> <model> <answer.json>
//       checks the answer ({topics, raidd, missing}, one verdict per item) against the stored minutes and
//       writes it into samples/meetings/judges/<case>.json; refuses an incomplete answer
//
// judgeId comes from lib/minutes/judge.json (sonnet, opus); model is the model that actually answered.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { judgeSystem, judgeUser, judgeTool, checkVerdicts } from '../lib/minutes/judge.js';
import { speechLines } from '../lib/minutes/transcript.js';
import judgeSettings from '../lib/minutes/judge.json' with { type: 'json' };
import spec from '../samples/meetings/specs.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'samples', 'meetings');

async function meeting(id) {
  const m = spec.meetings.find((x) => x.id === id);
  if (!m) throw new Error(`unknown case ${id} (m01..m10)`);
  const raw = await readFile(path.join(dir, m.file), 'utf8');
  const stored = JSON.parse(await readFile(path.join(dir, 'minutes', `${id}.json`), 'utf8'));
  return { m, raw, stored };
}

async function prompt(id, out) {
  const { m, raw, stored } = await meeting(id);
  const text = [
    '# Instructions', judgeSystem(), '',
    '# Answer format',
    'Answer with one JSON object only (no other text), matching this schema:',
    JSON.stringify(judgeTool().input_schema, null, 1), '',
    '# Meeting', judgeUser({ lines: speechLines(raw), minutes: stored.minutes, project: { name: m.project } }),
  ].join('\n');
  if (out) { await writeFile(out, text); console.log(`${id}: judge prompt written to ${out} (${text.length} characters)`); } else process.stdout.write(text);
}

async function store(id, judgeId, model, file) {
  if (!judgeSettings.judges.some((j) => j.id === judgeId)) throw new Error(`unknown judge ${judgeId}`);
  if (!model) throw new Error('model is required');
  const { stored } = await meeting(id);
  const answer = JSON.parse((await readFile(file, 'utf8')).replace(/^```(json)?\s*|\s*```\s*$/g, ''));
  const r = checkVerdicts(answer, stored.minutes);
  if (r.problems.length) { console.error(`${id} ${judgeId}: not stored, ${r.problems.join('; ')}`); process.exit(1); }
  await mkdir(path.join(dir, 'judges'), { recursive: true });
  const p = path.join(dir, 'judges', `${id}.json`);
  let cur = { case: id, judges: {} };
  try { cur = JSON.parse(await readFile(p, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  cur.minutesTemplate = stored.template;
  cur.counts = { topics: stored.minutes.topics.length, raidd: stored.minutes.raidd.length };
  cur.judges[judgeId] = { model, via: "Claude session on John's plan", judgedOn: new Date().toISOString().slice(0, 10), topics: r.topics, raidd: r.raidd, missing: r.missing, problems: [], costUsd: 0, calls: 1 };
  const order = judgeSettings.judges.map((j) => j.id);
  cur.judges = Object.fromEntries(Object.entries(cur.judges).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)));
  await writeFile(p, `${JSON.stringify(cur, null, 1)}\n`);
  const ne = (o) => Object.values(o).filter((v) => v.verdict === 'needs_edit').length;
  console.log(`${id} ${judgeId}: stored; topics ${ne(r.topics)} needs edit, RAIDD ${ne(r.raidd)} needs edit, missing ${r.missing.length}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'prompt') await prompt(args[0], args[1]);
else if (cmd === 'store') await store(...args);
else { console.error('usage: judge-session.mjs prompt <case> [out.md] | store <case> <judgeId> <model> <answer.json>'); process.exit(1); }
