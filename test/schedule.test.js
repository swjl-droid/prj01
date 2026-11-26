// Unit tests for the schedule import (prj01-R1 US-2). No network, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTables, parseSchedule, exportRows, compareWithSource, ImportError, parseDelimited } from '../lib/schedule/import.js';
import { storedShape } from '../lib/schedule/check.js';

const pmi = [
  ['WBS ID', 'Task / Milestone', 'Artifact Type', 'Start Date', 'Finish Date', 'Predecessors'],
  ['T1', 'Design', 'Task', '2026-10-01', '2026-10-07', ''],
  ['T2', 'Build', 'Task', '2026-10-08', '2026-10-19', 'T1+2d'],
  ['T3', 'Test', 'Task', '2026-10-10', '2026-10-20', 'T2SS+1d, T1FF-1d'],
];

test('reads link types and lags, including negative lag', () => {
  const s = parseSchedule({ source: 't', rows: pmi }, 'PMI-PMBOK');
  assert.deepEqual(s.links, [
    { from: 'T1', to: 'T2', type: 'FS', lag: 2 },
    { from: 'T2', to: 'T3', type: 'SS', lag: 1 },
    { from: 'T1', to: 'T3', type: 'FF', lag: -1 },
  ]);
});

test('a key with a dash and a number is a key, not a lag', () => {
  const rows = [['Work Package ID', 'Work Package', 'Artifact Type', 'Stage', 'Start Date', 'Finish Date', 'Predecessors'],
    ['STG-1', 'Stage 1', 'Stage', '', '2026-10-01', '2026-10-07', ''],
    ['WP-01', 'Design', 'Work Package', 'STG-1', '2026-10-01', '2026-10-07', ''],
    ['WP-02', 'Build', 'Work Package', 'STG-1', '2026-10-08', '2026-10-10', 'WP-01, STG-1+1d']];
  const s = parseSchedule({ source: 't', rows }, 'PRINCE2');
  assert.deepEqual(s.links.map((l) => [l.from, l.lag]), [['WP-01', 0], ['STG-1', 1]]);
});

test('the read-back check finds a changed date and a lost link', () => {
  const table = { source: 't', rows: pmi };
  const stored = storedShape(parseSchedule(table, 'PMI-PMBOK'));
  assert.equal(compareWithSource(table, stored).length, 0);
  const changed = structuredClone(stored);
  changed.items[1].finish = '2026-10-20';
  changed.links.pop();
  const diffs = compareWithSource(table, changed);
  assert.equal(diffs.length, 2);
  assert.deepEqual(diffs.map((d) => d.column).sort(), ['Finish Date', 'Predecessors']);
});

test('columns are matched by name in any order, with the v4 names accepted', () => {
  const rows = [['Predecessor', 'Finish', 'WBS ID', 'Task / Milestone Name', 'Start', 'Type'],
    ['', '2026-10-07', 'T1', 'Design', '2026-10-01', 'task'],
    ['T1', '2026-10-19', 'T2', 'Build', '2026-10-08', 'Task']];
  const s = parseSchedule({ source: 't', rows }, 'PMI-PMBOK');
  assert.equal(s.items[1].name, 'Build');
  assert.equal(s.items[0].type, 'Task');
  const back = exportRows(storedShape(s));
  assert.deepEqual(back[0].slice(0, 3), ['WBS ID', 'Task / Milestone', 'Artifact Type']);
});

test('a paste from a spreadsheet (tab-separated, quoted cell) is read', async () => {
  const text = 'WBS ID\tTask / Milestone\tArtifact Type\tStart Date\tFinish Date\nT1\t"Design, phase 1"\tTask\t01/10/2026\t07/10/2026\n';
  const [t] = await readTables({ name: 'paste', text });
  const s = parseSchedule(t, 'PMI-PMBOK');
  assert.equal(s.items[0].name, 'Design, phase 1');
  assert.equal(s.items[0].start, '2026-10-01');
});

test('an Excel date number is read as a date', () => {
  const rows = [['WBS ID', 'Task / Milestone', 'Artifact Type', 'Start Date', 'Finish Date'], ['T1', 'Design', 'Task', 46296, 46302]];
  const s = parseSchedule({ source: 't', rows }, 'PMI-PMBOK');
  assert.equal(s.items[0].start, '2026-10-01');
});

test('every problem in a file is listed, and nothing is returned', () => {
  const rows = [['WBS ID', 'Task / Milestone', 'Artifact Type', 'Start Date', 'Finish Date', 'Predecessors'],
    ['T1', '', 'Task', '2026-10-01', '2026-10-07', 'T1'],
    ['T1', 'Again', 'Thing', 'soon', '2026-10-07', 'X9']];
  try {
    parseSchedule({ source: 't', rows }, 'PMI-PMBOK');
    assert.fail('should be refused');
  } catch (e) {
    assert.ok(e instanceof ImportError);
    assert.ok(e.errors.length >= 5, `got ${e.errors.length}: ${e.message}`);
  }
});

test('an unknown method is refused', () => {
  assert.throws(() => parseSchedule({ source: 't', rows: pmi }, 'SAFe'), ImportError);
});

test('a parent loop is refused', () => {
  const rows = [['WBS ID', 'Task / Milestone', 'Artifact Type', 'WBS Parent', 'Start Date', 'Finish Date'],
    ['A', 'a', 'Task', 'B', '2026-10-01', '2026-10-02'], ['B', 'b', 'Task', 'A', '2026-10-01', '2026-10-02']];
  assert.throws(() => parseSchedule({ source: 't', rows }, 'PMI-PMBOK'), /loops/);
});

test('an unclosed quote is refused', () => {
  assert.throws(() => parseDelimited('a,b\n"x,y\n'), ImportError);
});
