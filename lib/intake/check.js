// Golden-set helper for transcript matching (prj01-R1 US-3): the 3 sample projects of the synthetic
// sample programme (names and summaries as start_sample() creates them), each with its mock schedule,
// and a mock transcript; returns what the copilot decides. No database, no model.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTables, parseSchedule } from '../schedule/import.js';
import { readTranscript } from './intake.js';
import { matchTranscript } from './match.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLE = [
  { id: 'p-clinic', name: 'Clinic relocation', summary: 'Move a 40-staff outpatient clinic to a new building with no gap in appointments. Synthetic.', schedule: ['pmi-2-clinic-relocation.csv', 'PMI-PMBOK'] },
  { id: 'p-office', name: 'Regional office fit-out', summary: 'Fit out a 2-floor regional office: design, contractor, IT and move-in stages. Synthetic.', schedule: ['prince2-2-regional-office-fit-out.xlsx', 'PRINCE2'] },
  { id: 'p-portal', name: 'Customer self-service portal', summary: 'Release a customer portal in 2-week sprints: sign-in, bills, service requests. Synthetic.', schedule: ['agile-2-customer-portal.csv', 'Agile'] },
];

export async function sampleProjects() {
  return Promise.all(SAMPLE.map(async (p) => {
    const [file, method] = p.schedule;
    const [table] = await readTables({ name: file, bytes: await readFile(path.join(root, 'samples', 'schedules', file)) });
    return { id: p.id, name: p.name, summary: p.summary, items: parseSchedule(table, method).items };
  }));
}

export async function matchSample(rel) {
  const file = path.join(root, rel);
  const t = readTranscript({ name: path.basename(file), bytes: await readFile(file) });
  const projects = await sampleProjects();
  const m = matchTranscript(t.text, projects);
  const name = (id) => projects.find((p) => p.id === id)?.name ?? null;
  return { decision: m.decision, project: name(m.projectId), candidates: m.candidates.map((c) => c.name).sort() };
}
