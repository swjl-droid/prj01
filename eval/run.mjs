// Golden-set check (prj01-R1 US-1 criterion "the golden-set check runs and fails the build on a
// regression"; first slice of AIP-W1 US-10, eval frame, Hub rows 227 and 235).
// Plain English: a golden set is an answer key. Each case gives an input and the answer we expect;
// CI runs the code on every case and fails if fewer cases pass than the set's threshold.
// Format, one JSON file per set in eval/golden/:
//   { "set": "...", "target": "<module path>#<export>", "threshold": 0.0-1.0, "blocking": true|false (default true),
//     "cases": [ { "id": "...", "input": [args...], "expect": <value>, "scorer": "equal" | "subset" } ] }
// "subset": every key in expect must match the result (extra keys allowed). Model-based targets
// (minutes, RAIDD) will plug in here with a fake model in CI, so CI never needs a model key.
// Usage: node eval/run.mjs            run every set
//        node eval/run.mjs --selftest  break each expected answer and require the check to fail
import { readdir, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const goldenDir = path.join(root, 'eval', 'golden');

export function subset(expect, actual) {
  if (expect === null || typeof expect !== 'object') return isDeepStrictEqual(expect, actual);
  if (Array.isArray(expect)) {
    return Array.isArray(actual) && expect.length === actual.length && expect.every((e, i) => subset(e, actual[i]));
  }
  if (actual === null || typeof actual !== 'object') return false;
  return Object.keys(expect).every((k) => subset(expect[k], actual[k]));
}

export async function loadSets(dir = goldenDir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(files.map(async (f) => ({ file: f, ...JSON.parse(await readFile(path.join(dir, f), 'utf8')) })));
}

export async function runSet(set) {
  const [mod, name] = set.target.split('#');
  const fn = (await import(pathToFileURL(path.join(root, mod)).href))[name];
  if (typeof fn !== 'function') throw new Error(`${set.file}: target ${set.target} is not a function`);
  const results = [];
  for (const c of set.cases) {
    let pass = false, error = null;
    try {
      const actual = await fn(...structuredClone(c.input));
      pass = (c.scorer ?? 'equal') === 'subset' ? subset(c.expect, actual) : isDeepStrictEqual(c.expect, actual);
    } catch (e) { error = e?.message ?? String(e); }
    results.push({ id: c.id, pass, error });
  }
  const rate = results.filter((r) => r.pass).length / results.length;
  return { set: set.set, file: set.file, threshold: set.threshold, rate, ok: rate >= set.threshold, results };
}

function breakExpect(v) {
  if (Array.isArray(v)) return [...v, '__planted__'];
  if (v && typeof v === 'object') return { ...v, __planted__: true, projectCount: -1 };
  return `${v}__planted__`;
}

async function main() {
  const selftest = process.argv.includes('--selftest');
  const sets = await loadSets();
  if (sets.length === 0) { console.error('No golden sets found in eval/golden'); process.exit(1); }
  let failed = false;
  for (const set of sets) {
    if (set.threshold === undefined || !Array.isArray(set.cases) || set.cases.length === 0) {
      console.error(`${set.file}: needs a threshold and at least one case`); process.exit(1);
    }
    if (selftest) {
      // Every case's answer is broken; the set must then fail, or the check proves nothing.
      const broken = { ...set, cases: set.cases.map((c) => ({ ...c, scorer: 'equal', expect: breakExpect(c.expect) })) };
      const r = await runSet(broken);
      if (r.ok) { console.error(`FAIL: ${set.file} passed with every expected answer broken`); failed = true; }
      else console.log(`  caught: ${set.file} fails with planted wrong answers (${Math.round(r.rate * 100)} % pass)`);
      continue;
    }
    const r = await runSet(set);
    if (set.blocking === false) {
      // Information only (still self-tested above): printed, never fails the build.
      console.log(`INFO ${r.set} (${r.file}): ${Math.round(r.rate * 100)} % of ${r.results.length} cases, not blocking`);
      continue;
    }
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.set} (${r.file}): ${Math.round(r.rate * 100)} % of ${r.results.length} cases, threshold ${Math.round(r.threshold * 100)} %`);
    for (const c of r.results.filter((x) => !x.pass)) console.log(`   case ${c.id} failed${c.error ? `: ${c.error}` : ''}`);
    if (!r.ok) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
