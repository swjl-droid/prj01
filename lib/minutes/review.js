// Combines the model judges' verdicts with John's (prj01-R1 US-4, review method decided by John
// 27/11/2026, Hub row 305). Per item (a topic or a RAIDD row):
//   - John decided (ok / needs_edit): his verdict is final.
//   - Otherwise (skipped or not reviewed yet): the judges' verdict when they all agree, else not OK.
// Score = items with a final OK / all items, skipped ones included. No weighting.
// The evidence page runs the same rules in the browser (its tests compare both on the same data).
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import judgeSettings from './judge.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KINDS = { topics: 'T', raidd: 'R' };

/** One item: judges = [{verdict}|undefined, ...], john = 'ok' | 'needs_edit' | 'skipped' | undefined. */
export function itemResult(judges, john) {
  const given = judges.map((j) => j?.verdict);
  const aligned = given.length > 0 && given.every((v) => v && v === given[0]);
  const judgesVerdict = aligned ? given[0] : null;
  if (john === 'ok' || john === 'needs_edit') return { aligned, judgesVerdict, final: john, by: 'john' };
  if (aligned) return { aligned, judgesVerdict, final: judgesVerdict, by: 'judges' };
  return { aligned, judgesVerdict, final: 'needs_edit', by: 'none' };
}

/**
 * cases: [{ id, counts: {topics, raidd}, judges: {<judgeId>: {topics: {T1: {verdict}}, raidd: {R1: ...}}}, john: {T1: 'ok', ...} }]
 * Returns per kind: total, misaligned, alignedOk, finalOk (counts and shares) and whether the bar is met.
 */
export function reviewStats(cases, { judgeIds = judgeSettings.judges.map((j) => j.id), bars = judgeSettings.bars } = {}) {
  const out = {};
  for (const [kind, prefix] of Object.entries(KINDS)) {
    const s = { total: 0, misaligned: 0, alignedOk: 0, alignedNotOk: 0, finalOk: 0, finalNotOk: 0, byJohn: 0 };
    for (const c of cases) {
      for (let i = 1; i <= (c.counts?.[kind] ?? 0); i += 1) {
        const id = `${prefix}${i}`;
        const r = itemResult(judgeIds.map((j) => c.judges?.[j]?.[kind]?.[id]), c.john?.[id]);
        s.total += 1;
        if (!r.aligned) s.misaligned += 1;
        if (r.aligned && r.judgesVerdict === 'ok') s.alignedOk += 1;
        if (r.aligned && r.judgesVerdict === 'needs_edit') s.alignedNotOk += 1;
        if (r.final === 'ok') s.finalOk += 1; else s.finalNotOk += 1;
        if (r.by === 'john') s.byJohn += 1;
      }
    }
    const share = (n) => (s.total ? n / s.total : 0);
    out[kind] = { ...s, misalignedShare: share(s.misaligned), alignedOkShare: share(s.alignedOk), alignedNotOkShare: share(s.alignedNotOk), finalOkShare: share(s.finalOk), finalNotOkShare: share(s.finalNotOk), bar: bars[kind], pass: s.total > 0 && share(s.finalOk) >= bars[kind] };
  }
  return out;
}

/**
 * The 10 evaluation minutes (samples/meetings/minutes/), each with its stored judge results
 * (samples/meetings/judges/, missing until judged: its items then count as not aligned) and John's
 * verdicts (samples/meetings/review/john.json, copied from the evidence pack).
 */
export async function loadReview(dir = path.join(root, 'samples', 'meetings')) {
  const readJson = async (p, fallback) => {
    try { return JSON.parse(await readFile(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  };
  const files = (await readdir(path.join(dir, 'minutes'))).filter((f) => /^m\d+\.json$/.test(f)).sort();
  const john = (await readJson(path.join(dir, 'review', 'john.json'), {})).verdicts ?? {};
  return Promise.all(files.map(async (f) => {
    const { case: id, minutes } = await readJson(path.join(dir, 'minutes', f));
    const counts = { topics: minutes.topics.length, raidd: minutes.raidd.length };
    const j = await readJson(path.join(dir, 'judges', f), null);
    if (j && (j.counts?.topics !== counts.topics || j.counts?.raidd !== counts.raidd)) throw new Error(`${id}: judge results do not match the stored minutes`);
    return { id, counts, judges: j?.judges ?? {}, john: john[id] ?? {} };
  }));
}

/** Golden-set target: does the stored review meet both bars? */
export async function storedReview() {
  const s = reviewStats(await loadReview());
  return { topicsPass: s.topics.pass, raiddPass: s.raidd.pass };
}
