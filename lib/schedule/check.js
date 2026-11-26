// Read-back checks for the schedule import (prj01-R1 US-2), used by the golden set and the tests.
// accuracy(): imports a sample file, sends it through the same shape the database stores and returns
// (import_schedule payload, read back as rows), and counts the cells that differ from the source.
// refusal(): imports a file that must be refused and returns the reasons given.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTables, parseSchedule, compareWithSource, ImportError } from './import.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// What the database gives back for a stored schedule: the payload of import_schedule() after a JSON
// round trip, in the order of position (items) and position (links).
export function storedShape(parsed) {
  const payload = JSON.parse(JSON.stringify({
    items: parsed.items.map((i) => ({ ...i, size: i.size === null ? null : String(i.size) })),
    links: parsed.links,
  }));
  return {
    method: parsed.method,
    items: payload.items.map((i) => ({ ...i, size: i.size === null ? null : Number(i.size) })),
    links: payload.links.map((l) => ({ from: l.from, to: l.to, type: l.type ?? 'FS', lag: l.lag ?? 0 })),
  };
}

async function load(rel) {
  const file = path.join(root, rel);
  const bytes = await readFile(file);
  return readTables({ name: path.basename(file), bytes });
}

export async function accuracy(rel, method) {
  const tables = await load(rel);
  let items = 0, links = 0, differences = 0;
  for (const t of tables) {
    const parsed = parseSchedule(t, method);
    const diffs = compareWithSource(t, storedShape(parsed));
    items += parsed.items.length; links += parsed.links.length; differences += diffs.length;
  }
  return { items, links, differences };
}

export async function refusal(rel, method) {
  try {
    const tables = await load(rel);
    for (const t of tables) parseSchedule(t, method);
    return { refused: false, reasons: [] };
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    return { refused: true, reasons: e.errors.map((x) => x.reason) };
  }
}
