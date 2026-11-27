// Golden-set target for the stored evaluation minutes (prj01-R1 US-4): re-checks the minutes Opus 5.5
// drafted for mock meeting <id> (samples/meetings/minutes/<id>.json) against its transcript with
// today's parser and checks, and compares with the meeting's golden file. No model call.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import template from './template.json' with { type: 'json' };
import { speechLines } from './transcript.js';
import { verifyMinutes } from './verify.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf8'));

export async function storedMinutes(id) {
  const golden = (await read('samples/meetings/golden.json')).meetings.find((m) => m.id === id);
  const stored = await read(`samples/meetings/minutes/${id}.json`);
  const lines = speechLines(await readFile(path.join(root, 'samples/meetings', golden.file), 'utf8'));
  const { checks, minutes } = verifyMinutes(stored.minutes, lines, template);
  const cited = new Set(minutes.topics.flatMap((t) => [...t.summary, ...t.actions]).flatMap((p) => p.quotes).map((q) => q.line));
  const planted = golden.raidd.filter((e) => cited.has(e.at.line)).length;
  return {
    checksOk: checks.ok,
    quotesMissing: checks.stats.missing,
    everyPointQuoted: minutes.topics.every((t) => [...t.summary, ...t.actions].every((p) => p.quotes.length > 0)),
    topicsMatchMeeting: minutes.topics.length === golden.topics.length,
    plantedRaiddCitedAtLeast80: planted / golden.raidd.length >= 0.8,
  };
}

/** How the RAIDD table of one set of minutes compares with the meeting's golden labels (rubric line 3). */
export function raiddAgainstGolden(minutes, golden, window = 2) {
  const rows = minutes.raidd ?? [];
  const near = (row, line) => row.quotes.some((q) => q.found && Math.abs(q.line - line) <= window);
  const events = golden.raidd.map((e) => {
    const hits = rows.map((r, i) => ({ r, i })).filter(({ r }) => near(r, e.at.line));
    return { beat: e.beat, type: e.type, change: e.change, title: e.title, rows: hits.map((h) => h.i + 1), typeRight: hits.length === 1 && hits[0].r.type === e.type, changeRight: hits.length === 1 && hits[0].r.change === e.change };
  });
  const lookAlikes = golden.notRaidd.filter((n) => rows.some((r) => r.quotes.some((q) => q.found && q.line === n.at.line))).map((n) => n.beat);
  const matched = new Set(events.flatMap((e) => e.rows));
  return {
    events, lookAlikes,
    extraRows: rows.map((r, i) => i + 1).filter((n) => !matched.has(n)),
    once: events.filter((e) => e.rows.length === 1).length,
    typeRight: events.filter((e) => e.typeRight).length,
    total: events.length,
  };
}

/** Golden-set target for rubric line 3: yes / no per meeting. */
export async function storedRaidd(id) {
  const golden = (await read('samples/meetings/golden.json')).meetings.find((m) => m.id === id);
  const stored = await read(`samples/meetings/minutes/${id}.json`);
  const lines = speechLines(await readFile(path.join(root, 'samples/meetings', golden.file), 'utf8'));
  const { minutes } = verifyMinutes(stored.minutes, lines, template);
  const r = raiddAgainstGolden(minutes, golden);
  return { eachPlantedOnce: r.once === r.total, rightTypes: r.typeRight === r.total, noLookAlikes: r.lookAlikes.length === 0 };
}
