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
