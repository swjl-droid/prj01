// Transcript-to-project matching (prj01-R1 US-3; decision 26/11/2026, Hub row 242: signal scoring,
// no model call). Plain English: each "scorer" looks for one kind of clue that a transcript belongs to
// a project (its name said aloud, its schedule's task names or keys, the people who own its tasks) and
// gives each project a mark from 0 to 1. The marks are combined with the weights in match-settings.json.
// The copilot only decides on its own when the best project clearly passes the bar and clearly beats
// the runner-up; otherwise it asks the PM, and says why.
import defaults from './match-settings.json' with { type: 'json' };

const STOP = new Set(('a an and are as at be been but by can do for from had has have he her his i if in into is it its '
  + 'me my no not of on or our out over so than that the their them then there these they this to up us was we were '
  + 'what when which who will with would you your yes ok okay thanks thank just also very really about all any some '
  + 'one two three new next last week today tomorrow monday tuesday wednesday thursday friday please right well now '
  + 'think going get got let lets need needs make sure good great see team meeting call update updates item items '
  + 'project projects plan task tasks stage sprint phase gate done start finish date dates people work').split(' '));

export function words(text) {
  return String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

function phraseIn(haystack, phrase) {
  const p = String(phrase ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return p.length > 2 && haystack.includes(` ${p} `);
}

// ---------- Scorers: (transcript, project, context) -> { score 0..1, reasons [] } ----------

const scorers = {
  // The project's own name (or most of its distinctive words) is said or written.
  name(t, p) {
    if (phraseIn(t.flat, p.name)) return { score: 1, reasons: [`names the project "${p.name}"`] };
    const nameWords = [...new Set(words(p.name))];
    if (!nameWords.length) return { score: 0, reasons: [] };
    const hit = nameWords.filter((w) => t.wordSet.has(w));
    const score = hit.length / nameWords.length;
    return { score: score >= 0.5 ? score * 0.8 : 0, reasons: score >= 0.5 ? [`uses the project's name words: ${hit.join(', ')}`] : [] };
  },
  // The project's schedule (and summary): exact item keys, task names, and words only this project uses.
  schedule(t, p, ctx) {
    const reasons = [];
    const keys = (p.items ?? []).map((i) => i.key).filter((k) => /[a-z]/i.test(k) && k.length >= 3);
    const keyHits = keys.filter((k) => new RegExp(`(^|[^A-Za-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i').test(t.raw));
    const nameHits = (p.items ?? []).map((i) => i.name).filter((n) => words(n).length >= 2 && phraseIn(t.flat, n));
    const own = ctx.distinctive.get(p.id) ?? new Set();
    const wordHits = [...own].filter((w) => t.wordSet.has(w));
    if (keyHits.length) reasons.push(`mentions schedule keys ${keyHits.slice(0, 5).join(', ')}`);
    if (nameHits.length) reasons.push(`mentions ${nameHits.length} of its task names, e.g. "${nameHits[0]}"`);
    if (wordHits.length >= 3) reasons.push(`uses ${wordHits.length} words found only in this project, e.g. ${wordHits.slice(0, 4).join(', ')}`);
    const score = Math.min(1, keyHits.length * 0.25 + nameHits.length * 0.2 + Math.min(wordHits.length, 12) / 12 * 0.6);
    return { score, reasons };
  },
  // People or roles who own items in this project (and in no other) take part.
  people(t, p, ctx) {
    const own = (ctx.owners.get(p.id) ?? []).filter((o) => !ctx.sharedOwners.has(o.toLowerCase()));
    const hits = own.filter((o) => phraseIn(t.flat, o));
    return { score: Math.min(1, hits.length / 2), reasons: hits.length ? [`mentions ${hits.slice(0, 3).join(', ')}, who own tasks in it`] : [] };
  },
};

function context(projects) {
  const vocab = new Map(projects.map((p) => [p.id, new Set(words([p.summary, ...(p.items ?? []).flatMap((i) => [i.name, i.notes])].join(' ')))]));
  const distinctive = new Map();
  for (const p of projects) {
    const others = projects.filter((q) => q.id !== p.id).map((q) => vocab.get(q.id));
    distinctive.set(p.id, new Set([...vocab.get(p.id)].filter((w) => !others.some((s) => s.has(w)))));
  }
  const owners = new Map(projects.map((p) => [p.id, [...new Set((p.items ?? []).map((i) => i.owner).filter((o) => o && o.length >= 4))]]));
  const count = new Map();
  for (const list of owners.values()) for (const o of list) count.set(o.toLowerCase(), (count.get(o.toLowerCase()) ?? 0) + 1);
  const sharedOwners = new Set([...count].filter(([, n]) => n > 1).map(([o]) => o));
  return { distinctive, owners, sharedOwners };
}

// projects: [{ id, name, summary, items: [{ key, name, owner, notes }] }]
// Returns { decision: 'matched' | 'ask', projectId, reason, candidates: [{ projectId, name, score, reasons }] }
export function matchTranscript(text, projects, settings = defaults) {
  const s = { ...defaults, ...settings, weights: { ...defaults.weights, ...(settings?.weights ?? {}) } };
  const raw = String(text ?? '');
  const t = { raw, flat: ` ${raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `, wordSet: new Set(words(raw)) };
  const ctx = context(projects);
  const totalWeight = Object.values(s.weights).reduce((a, b) => a + b, 0);
  const scored = projects.map((p) => {
    let total = 0;
    const reasons = [];
    for (const [name, weight] of Object.entries(s.weights)) {
      const fn = scorers[name];
      if (!fn || !weight) continue;
      const r = fn(t, p, ctx);
      total += weight * r.score;
      reasons.push(...r.reasons);
    }
    return { projectId: p.id, name: p.name, score: Math.round((total / totalWeight) * 1000) / 1000, reasons };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const candidates = scored.filter((c) => c.score >= s.floor).slice(0, s.maxCandidates);
  const [top, second] = scored;
  if (!top || top.score < s.floor) {
    return { decision: 'ask', projectId: null, reason: 'It matches none of your projects. Which project is it for?', candidates: [] };
  }
  const runnerUp = second?.score ?? 0;
  const gap = top.score - runnerUp;
  if (top.score >= s.threshold && gap >= s.minGap && runnerUp <= s.maxRunnerUpShare * top.score) {
    return { decision: 'matched', projectId: top.projectId, reason: `Matched to "${top.name}": ${top.reasons.join('; ')}`, candidates };
  }
  if (top.score < s.threshold && candidates.length <= 1) {
    return { decision: 'ask', projectId: null, reason: `Not sure: the best match "${top.name}" is weak. Which project is it for?`, candidates };
  }
  return { decision: 'ask', projectId: null, reason: `It fits more than one project (${candidates.map((c) => c.name).join(' and ')}). Which project is it for?`, candidates };
}
