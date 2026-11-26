// Supabase access for prj01 (prj01-R1 US-1: sign-in, separation, sample programme).
// Plain English: the browser never talks to the database directly. It sends the person's email and
// password to our own functions, which ask Supabase Auth for a sign-in token; every data request then
// carries that token, and the database's row rules (RLS) show only the person's own organisations.
// The project address and publishable key come from Vercel (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
// the publishable key cannot read anything by itself: without a person's token RLS returns nothing.

const SCHEMA = 'app_prj01';

export class SupabaseError extends Error {
  constructor(status, kind, message) {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

export function config(env = process.env) {
  const url = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key) {
    throw new SupabaseError(503, 'not_configured', 'Sign-in is not configured yet');
  }
  return { url, key };
}

async function call(cfg, path, { method = 'GET', token, body, profile = false, fetchImpl = fetch } = {}) {
  const headers = { apikey: cfg.key, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (profile) {
    headers['Accept-Profile'] = SCHEMA;
    headers['Content-Profile'] = SCHEMA;
  }
  const res = await fetchImpl(`${cfg.url}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    // Only the kind of error leaves this function: never the token, the key or the password.
    const kind = data?.error_code ?? data?.code ?? data?.error ?? 'error';
    const message = data?.msg ?? data?.message ?? data?.error_description ?? 'Request failed';
    throw new SupabaseError(res.status, String(kind), String(message));
  }
  return data;
}

export async function signUp(cfg, email, password, opts) {
  const d = await call(cfg, '/auth/v1/signup', { method: 'POST', body: { email, password }, ...opts });
  return session(d);
}

export async function signIn(cfg, email, password, opts) {
  const d = await call(cfg, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, ...opts });
  return session(d);
}

export async function signOut(cfg, token, opts) {
  await call(cfg, '/auth/v1/logout', { method: 'POST', token, ...opts });
}

function session(d) {
  // A sign-up that still waits for an e-mail confirmation returns a user but no token.
  if (!d?.access_token) return { token: null, expiresIn: 0, email: d?.email ?? d?.user?.email ?? null, needsConfirmation: true };
  return { token: d.access_token, expiresIn: d.expires_in ?? 3600, email: d.user?.email ?? null, needsConfirmation: false };
}

// The signed-in person's programme: makes sure their sample programme exists (start_sample does
// nothing the second time), then reads what RLS lets them see.
export async function loadProgramme(cfg, token, opts) {
  await call(cfg, '/rest/v1/rpc/start_sample', { method: 'POST', token, body: {}, profile: true, ...opts });
  const orgs = await call(cfg, '/rest/v1/orgs?select=id,name,is_sample&order=name', { token, profile: true, ...opts });
  const projects = await call(cfg,
    '/rest/v1/projects?select=id,org_id,name,methodology,summary,start_date,end_date,is_sample&order=name',
    { token, profile: true, ...opts });
  return groupProgramme(orgs, projects);
}

export async function forgetMe(cfg, token, opts) {
  return call(cfg, '/rest/v1/rpc/forget_me', { method: 'POST', token, body: {}, profile: true, ...opts });
}

// Pure: orgs and projects (as RLS returned them) into the page's view. A project whose
// organisation was not returned is dropped, never shown under another organisation.
export function groupProgramme(orgs, projects) {
  const byOrg = new Map((orgs ?? []).map((o) => [o.id, { id: o.id, name: o.name, isSample: !!o.is_sample, projects: [] }]));
  for (const p of projects ?? []) {
    const org = byOrg.get(p.org_id);
    if (!org) continue;
    org.projects.push({
      id: p.id, name: p.name, methodology: p.methodology, summary: p.summary ?? '',
      start: p.start_date ?? null, end: p.end_date ?? null, isSample: !!p.is_sample,
    });
  }
  const list = [...byOrg.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const o of list) o.projects.sort((a, b) => a.name.localeCompare(b.name));
  return { orgs: list, projectCount: list.reduce((n, o) => n + o.projects.length, 0) };
}

// ---------- Schedules (prj01-R1 US-2) ----------

export async function importSchedule(cfg, token, projectId, parsed, opts) {
  const body = {
    p_project: projectId, p_method: parsed.method, p_source: String(parsed.source).slice(0, 300),
    p_items: parsed.items, p_links: parsed.links,
  };
  return call(cfg, '/rest/v1/rpc/import_schedule', { method: 'POST', token, body, profile: true, ...opts });
}

export async function listSchedules(cfg, token, projectId, opts) {
  const q = `/rest/v1/schedules?select=id,method,source_name,item_count,link_count,imported_at&project_id=eq.${encodeURIComponent(projectId)}&order=imported_at.desc`;
  return call(cfg, q, { token, profile: true, ...opts });
}

// One stored schedule in the import's own shape, items and links in their original order.
export async function getSchedule(cfg, token, id, opts) {
  const e = encodeURIComponent(id);
  const [meta] = await call(cfg, `/rest/v1/schedules?select=id,project_id,method,source_name,item_count,link_count,imported_at&id=eq.${e}`, { token, profile: true, ...opts });
  if (!meta) throw new SupabaseError(404, 'not_found', 'Schedule not found');
  const items = await call(cfg, `/rest/v1/schedule_items?select=key,name,type,parent,start_date,finish_date,duration,size,owner,status,notes,extras&schedule_id=eq.${e}&order=position`, { token, profile: true, ...opts });
  const links = await call(cfg, `/rest/v1/schedule_links?select=from_key,to_key,link_type,lag_days&schedule_id=eq.${e}&order=position`, { token, profile: true, ...opts });
  return {
    ...meta,
    items: items.map((i) => ({
      key: i.key, name: i.name, type: i.type, parent: i.parent, start: i.start_date, finish: i.finish_date,
      duration: i.duration, size: i.size === null ? null : Number(i.size), owner: i.owner, status: i.status,
      notes: i.notes, extras: i.extras ?? {},
    })),
    links: links.map((l) => ({ from: l.from_key, to: l.to_key, type: l.link_type, lag: l.lag_days })),
  };
}
