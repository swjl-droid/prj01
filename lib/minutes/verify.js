// Code checks on a minutes draft (prj01-R1 US-4): the template's shape and limits, and faithfulness of
// every quote: each must be copied from the transcript. A quote cited on the wrong line but found on
// another is moved there (counted as relocated); a quote found nowhere is a problem.
import { norm } from './transcript.js';

function words(s) { return norm(s).split(' ').filter(Boolean).length; }

function people(lines) {
  const set = new Set();
  for (const l of lines) if (l.speaker) for (const w of norm(l.speaker).split(/[\s.()]+/)) if (w.length > 1) set.add(w);
  return set;
}

/** Checks one draft; returns the draft with quotes resolved to their line, and the findings. */
export function verifyMinutes(minutes, lines, template) {
  const L = template.limits;
  const problems = [];
  const stats = { quotes: 0, exact: 0, relocated: 0, missing: 0, points: 0, actions: 0 };
  const byN = new Map(lines.map((l) => [l.n, norm(l.text)]));
  const all = lines.map((l) => ({ n: l.n, t: norm(l.text) }));
  const everyone = norm(lines.map((l) => `${l.speaker ?? ''} ${l.text}`).join(' '));
  const speakers = people(lines);

  function checkQuotes(where, quotes) {
    if (!Array.isArray(quotes) || quotes.length === 0) { problems.push({ where, kind: 'no_quote', detail: 'has no quote' }); return []; }
    return quotes.map((q, i) => {
      stats.quotes += 1;
      const t = norm(q?.text ?? '');
      const at = `${where}, quote ${i + 1}`;
      if (!t) { stats.missing += 1; problems.push({ where: at, kind: 'empty_quote', detail: 'is empty' }); return { ...q, found: false }; }
      if (words(t) > L.maxQuoteWords) problems.push({ where: at, kind: 'long_quote', detail: `has ${words(t)} words (at most ${L.maxQuoteWords})` });
      if (byN.get(q.line)?.includes(t)) { stats.exact += 1; return { line: q.line, text: q.text, found: true }; }
      const other = all.find((l) => l.t.includes(t));
      if (other) { stats.relocated += 1; return { line: other.n, text: q.text, found: true, citedLine: q.line }; }
      stats.missing += 1;
      problems.push({ where: at, kind: 'quote_not_found', detail: `"${q.text}" is not in line ${q.line} nor anywhere in the transcript` });
      return { ...q, found: false };
    });
  }

  const topics = Array.isArray(minutes?.topics) ? minutes.topics : [];
  if (topics.length === 0) problems.push({ where: 'minutes', kind: 'no_topics', detail: 'has no topics' });
  if (topics.length > L.maxTopics) problems.push({ where: 'minutes', kind: 'too_many_topics', detail: `has ${topics.length} topics (at most ${L.maxTopics})` });
  const outTopics = topics.map((topic, ti) => {
    const tw = `Topic ${ti + 1}`;
    if (!String(topic?.title ?? '').trim()) problems.push({ where: tw, kind: 'no_title', detail: 'has no title' });
    const summary = Array.isArray(topic?.summary) ? topic.summary : [];
    const actions = Array.isArray(topic?.actions) ? topic.actions : [];
    if (summary.length === 0) problems.push({ where: tw, kind: 'no_summary', detail: 'has no summary point' });
    if (summary.length > L.maxPointsPerTopic) problems.push({ where: tw, kind: 'too_many_points', detail: `has ${summary.length} summary points (at most ${L.maxPointsPerTopic})` });
    if (actions.length > L.maxActionsPerTopic) problems.push({ where: tw, kind: 'too_many_actions', detail: `has ${actions.length} actions (at most ${L.maxActionsPerTopic})` });
    return {
      title: String(topic?.title ?? '').trim().replace(/^(topic\s*)?\d+\s*[.):-]\s*/i, ''), // numbering is the template's job
      summary: summary.map((p, pi) => { stats.points += 1; return { text: String(p?.text ?? '').trim(), quotes: checkQuotes(`${tw}, point ${pi + 1}`, p?.quotes) }; }),
      actions: actions.map((a, ai) => {
        stats.actions += 1;
        const aw = `${tw}, action ${ai + 1}`;
        const owner = String(a?.owner ?? '').trim();
        if (owner && !norm(owner).split(/\s+/).some((w) => speakers.has(w) || everyone.includes(w))) {
          problems.push({ where: aw, kind: 'owner_not_in_transcript', detail: `owner "${owner}" is not named in the transcript` });
        }
        return { text: String(a?.text ?? '').trim(), owner, due: String(a?.due ?? '').trim(), quotes: checkQuotes(aw, a?.quotes) };
      }),
    };
  });

  return {
    minutes: { meeting: minutes?.meeting ?? {}, topics: outTopics },
    checks: { ok: problems.length === 0, problems, stats },
  };
}
