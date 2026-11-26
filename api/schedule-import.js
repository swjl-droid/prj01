// Schedule import (prj01-R1 US-2). The browser sends one or more files (a file, a folder's files) or a
// paste, with the project and the method. Each file is read and checked; a file with any problem is
// refused as a whole with every reason. A good file is stored in one call (all or nothing), then read
// back from the database and compared cell by cell with the source: the answer gives the number of
// differences, which must be 0.
import { config, importSchedule, getSchedule, SupabaseError } from '../lib/supabase.js';
import { readTables, parseSchedule, compareWithSource, ImportError, METHODS } from '../lib/schedule/import.js';
import { bearer, fail, jsonBody } from '../lib/http.js';

const MAX_FILES = 20;
const MAX_BYTES = 3 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ ok: false, error: 'not_signed_in', message: 'Please sign in' }, { status: 401 });
    const cfg = config();
    const { projectId, method, files = [], paste } = await jsonBody(request);
    if (!UUID.test(String(projectId ?? ''))) return bad('Choose a project');
    if (!METHODS.includes(method)) return bad(`Choose a method: ${METHODS.join(', ')}`);
    const inputs = [];
    if (typeof paste === 'string' && paste.trim()) inputs.push({ name: 'paste', text: paste });
    if (!Array.isArray(files) || files.length > MAX_FILES) return bad(`At most ${MAX_FILES} files at once`);
    let total = 0;
    for (const f of files) {
      const bytes = Buffer.from(String(f?.base64 ?? ''), 'base64');
      total += bytes.length;
      inputs.push({ name: String(f?.name ?? 'file').slice(0, 200), bytes });
    }
    if (total > MAX_BYTES) return bad('Files too large (3 MB at most per import)');
    if (!inputs.length) return bad('Add a file, a folder or a paste');

    const results = [];
    for (const input of inputs) {
      let tables;
      try { tables = await readTables(input); } catch (e) {
        if (!(e instanceof ImportError)) throw e;
        results.push({ source: input.name, ok: false, reasons: e.errors.map((x) => x.reason) });
        continue;
      }
      for (const table of tables) {
        let parsed;
        try { parsed = parseSchedule(table, method); } catch (e) {
          if (!(e instanceof ImportError)) throw e;
          results.push({ source: table.source, ok: false, reasons: e.errors.map((x) => x.reason) });
          continue;
        }
        try {
          const id = await importSchedule(cfg, token, projectId, parsed);
          const stored = await getSchedule(cfg, token, id);
          const differences = compareWithSource(table, stored);
          results.push({ source: table.source, ok: true, scheduleId: id, items: stored.items.length, links: stored.links.length, differences: differences.length, firstDifferences: differences.slice(0, 5) });
        } catch (e) {
          if (e instanceof SupabaseError && e.status < 500) {
            results.push({ source: table.source, ok: false, reasons: [e.kind === '42501' ? 'Project not found in your organisation' : `Not stored: ${e.message}`] });
          } else throw e;
        }
      }
    }
    return Response.json({ ok: true, results });
  } catch (e) {
    return fail(e);
  }
}

function bad(message) {
  return Response.json({ ok: false, error: 'bad_request', message }, { status: 400 });
}
