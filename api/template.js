// Blank schedule template per method (prj01-R1 US-2), built from the method profile: the 12 fixed slots
// in order with the method's labels, then its extras. No sign-in needed: it holds no data.
import { exportRows, METHODS } from '../lib/schedule/import.js';

export async function GET(request) {
  const method = new URL(request.url).searchParams.get('method');
  if (!METHODS.includes(method)) {
    return Response.json({ ok: false, error: 'bad_request', message: `method must be one of: ${METHODS.join(', ')}` }, { status: 400 });
  }
  const [header] = exportRows({ method, items: [], links: [] });
  const slug = method.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return new Response(header.map((h) => (/[",]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h)).join(',') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}-template.csv"` },
  });
}
