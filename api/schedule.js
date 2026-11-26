// Read a project's schedules back (prj01-R1 US-2): ?projectId= lists them; ?id= returns one in the
// fixed column order with the method's own labels; ?id=&format=csv downloads it as CSV.
import { config, listSchedules, getSchedule } from '../lib/supabase.js';
import { exportRows } from '../lib/schedule/import.js';
import { bearer, fail } from '../lib/http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const csvCell = (v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export async function GET(request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ ok: false, error: 'not_signed_in', message: 'Please sign in' }, { status: 401 });
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const projectId = url.searchParams.get('projectId');
    const cfg = config();
    if (id) {
      if (!UUID.test(id)) return Response.json({ ok: false, error: 'bad_request', message: 'Bad schedule id' }, { status: 400 });
      const s = await getSchedule(cfg, token, id);
      const rows = exportRows(s);
      if (url.searchParams.get('format') === 'csv') {
        const name = String(s.source_name).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.(csv|xlsx|tsv|txt)$/i, '');
        return new Response(rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-read-back.csv"` },
        });
      }
      return Response.json({ ok: true, schedule: { id: s.id, method: s.method, source: s.source_name, importedAt: s.imported_at }, rows });
    }
    if (!projectId || !UUID.test(projectId)) return Response.json({ ok: false, error: 'bad_request', message: 'Give projectId or id' }, { status: 400 });
    return Response.json({ ok: true, schedules: await listSchedules(cfg, token, projectId) });
  } catch (e) {
    return fail(e);
  }
}
