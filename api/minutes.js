// Minutes from a transcript (prj01-R1 US-4). Reads and writes with the person's token, so RLS decides
// what they reach; the model call goes through the gateway (costed and traced, content masked).
// POST { transcriptId }               drafts minutes (a new version) and stores them as a draft
// POST { action: 'approve', id }      the PM approves the draft (gate mode, L1)
// GET  ?transcriptId=                 the latest minutes of a transcript, with the transcript's lines
import { config, getTranscriptForMinutes, orgProjects, latestMinutes, insertMinutes, approveMinutes, currentUser } from '../lib/supabase.js';
import { createGateway } from '../lib/gateway/index.js';
import { draftMinutes, MinutesError } from '../lib/minutes/draft.js';
import { speechLines } from '../lib/minutes/transcript.js';
import settings from '../lib/minutes/settings.json' with { type: 'json' };
import { bearer, fail, jsonBody } from '../lib/http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (message, status = 400) => Response.json({ ok: false, error: 'bad_request', message }, { status });
const unsigned = () => Response.json({ ok: false, error: 'not_signed_in', message: 'Please sign in' }, { status: 401 });

/** Given names of the speakers, so the gateway masks them in traces (TRACE_CONTENT=masked). */
function givenNames(lines) {
  return [...new Set(lines.map((l) => (l.speaker ?? '').split(/[\s(]/)[0]).filter((w) => /^[A-Z][a-z]{1,20}$/.test(w)))];
}

export async function POST(request) {
  try {
    const token = bearer(request);
    if (!token) return unsigned();
    const cfg = config();
    const body = await jsonBody(request);

    if (body.action === 'approve') {
      if (!UUID.test(String(body.id ?? ''))) return bad('Choose the minutes to approve');
      const me = await currentUser(cfg, token);
      return Response.json({ ok: true, minutes: await approveMinutes(cfg, token, body.id, me.id) });
    }

    if (!UUID.test(String(body.transcriptId ?? ''))) return bad('Choose a transcript');
    const t = await getTranscriptForMinutes(cfg, token, body.transcriptId);
    if (!t.project_id) return bad('Choose the project of this transcript first');
    const projects = await orgProjects(cfg, token, t.org_id);
    const project = projects.find((p) => p.id === t.project_id);
    const previous = await latestMinutes(cfg, token, t.id);
    const gateway = createGateway({ app: 'prj01', timeoutMs: settings.timeoutMs });
    let r;
    try {
      r = await draftMinutes({
        gateway, raw: t.content, project, otherProjects: projects.filter((p) => p.id !== project.id),
        source: t.source_name, tenantId: t.org_id, names: givenNames(speechLines(t.content)),
      });
    } catch (e) {
      if (e instanceof MinutesError) return Response.json({ ok: false, error: e.kind, message: e.message }, { status: 422 });
      throw e;
    }
    const row = await insertMinutes(cfg, token, {
      org_id: t.org_id, transcript_id: t.id, project_id: t.project_id, version: (previous?.version ?? 0) + 1,
      content: r.minutes, checks: r.checks, template: `${r.template.id} v${r.template.version}`, model: r.model,
    });
    return Response.json({ ok: true, minutes: row, lines: r.lines, costUsd: r.costUsd, project: { id: project.id, name: project.name } });
  } catch (e) {
    return fail(e);
  }
}

export async function GET(request) {
  try {
    const token = bearer(request);
    if (!token) return unsigned();
    const id = new URL(request.url).searchParams.get('transcriptId') ?? '';
    if (!UUID.test(id)) return bad('Choose a transcript');
    const cfg = config();
    const t = await getTranscriptForMinutes(cfg, token, id);
    const m = await latestMinutes(cfg, token, id);
    return Response.json({ ok: true, minutes: m, lines: m ? speechLines(t.content) : [] });
  } catch (e) {
    return fail(e);
  }
}
