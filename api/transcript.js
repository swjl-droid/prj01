// Transcript drop point (prj01-R1 US-3; matching decided 26/11/2026, Hub row 242).
// POST { name, base64 } or { paste }: checked (type, text, size, duplicate), matched to one of the
//   person's projects by signal scoring, and stored. The answer says the project and why, or asks
//   which project when none or two match.
// POST { action: 'confirm', id, projectId }: the PM picks or confirms the project.
// GET ?projectId=  transcripts of a project;  GET ?pending=1  those waiting for the PM's choice.
import { config, matchingContext, findTranscript, insertTranscript, confirmTranscript, listTranscripts, SupabaseError } from '../lib/supabase.js';
import { readTranscript, IntakeError } from '../lib/intake/intake.js';
import { matchTranscript } from '../lib/intake/match.js';
import { bearer, fail, jsonBody } from '../lib/http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (message, status = 400) => Response.json({ ok: false, error: 'bad_request', message }, { status });

export async function POST(request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ ok: false, error: 'not_signed_in', message: 'Please sign in' }, { status: 401 });
    const cfg = config();
    const body = await jsonBody(request);

    if (body.action === 'confirm') {
      if (!UUID.test(String(body.id ?? '')) || !UUID.test(String(body.projectId ?? ''))) return bad('Choose a transcript and a project');
      const row = await confirmTranscript(cfg, token, body.id, body.projectId);
      return Response.json({ ok: true, transcript: row });
    }

    let t;
    try {
      t = typeof body.paste === 'string' && body.paste.trim()
        ? readTranscript({ name: 'paste', text: body.paste })
        : readTranscript({ name: String(body.name ?? 'file').slice(0, 200), bytes: Buffer.from(String(body.base64 ?? ''), 'base64') });
    } catch (e) {
      if (e instanceof IntakeError) return Response.json({ ok: true, refused: true, reasons: [e.reason] });
      throw e;
    }

    const ctx = await matchingContext(cfg, token);
    const org = body.orgId ? ctx.orgs.find((o) => o.id === body.orgId) : ctx.orgs[0];
    if (!org) return bad('No organisation yet: open your programme first');
    if (ctx.orgs.length > 1 && !body.orgId) return bad('You belong to several organisations: choose one');

    const dup = await findTranscript(cfg, token, org.id, t.sha256);
    if (dup) {
      const when = String(dup.created_at).slice(0, 10);
      return Response.json({ ok: true, refused: true, reasons: [`Already dropped on ${when} as "${dup.source_name}"; it is not processed twice`] });
    }

    const projects = ctx.projects.filter((p) => p.org_id === org.id);
    const m = matchTranscript(t.text, projects);
    let row;
    try {
      row = await insertTranscript(cfg, token, {
        org_id: org.id, project_id: m.projectId, source_name: t.source, content: t.text, content_sha256: t.sha256,
        status: m.decision === 'matched' ? 'matched' : 'needs_choice',
        match: { decision: m.decision, reason: m.reason, candidates: m.candidates.map((c) => ({ projectId: c.projectId, name: c.name, score: c.score })) },
      });
    } catch (e) {
      if (e instanceof SupabaseError && e.kind === '23505') {
        return Response.json({ ok: true, refused: true, reasons: ['Already dropped; it is not processed twice'] });
      }
      throw e;
    }
    const nameOf = (id) => projects.find((p) => p.id === id)?.name ?? null;
    return Response.json({
      ok: true, refused: false, id: row.id, decision: m.decision, project: m.projectId ? { id: m.projectId, name: nameOf(m.projectId) } : null,
      reason: m.reason, candidates: m.candidates.map((c) => ({ id: c.projectId, name: c.name, score: c.score, reasons: c.reasons })),
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
    });
  } catch (e) {
    return fail(e);
  }
}

export async function GET(request) {
  try {
    const token = bearer(request);
    if (!token) return Response.json({ ok: false, error: 'not_signed_in', message: 'Please sign in' }, { status: 401 });
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');
    const pending = url.searchParams.get('pending') === '1';
    if (!pending && !UUID.test(String(projectId ?? ''))) return bad('Give projectId or pending=1');
    return Response.json({ ok: true, transcripts: await listTranscripts(config(), token, { projectId, pending }) });
  } catch (e) {
    return fail(e);
  }
}
