// Builds the 10 mock 30-minute meeting transcripts for prj01-R1 US-4 (minutes) and US-5 (RAIDD), and
// their golden file. Run: node scripts/make-mock-meetings.mjs
//
// Two inputs, both in samples/meetings/:
//  - specs.json: the substance of each meeting, written by hand (topics, the lines that carry decisions,
//    actions and RAIDD events, the golden labels).
//  - dialogue/<id>.json: the natural discussion around those lines, written once by a model through the
//    gateway on a preview (GET /api/eval?task=dialogue&case=<id>), then kept here so builds repeat.
//    Every hand-written line must be in it word for word; the build stops if one is missing or changed.
// This script then adds what real transcripts have (lesson of gap Hub row 244: test on noisy data):
// fillers and repeated words, back-channel, cross-talk, speech-to-text errors on the discussion lines,
// name variants and unnamed dial-in speakers, the file format (.vtt Teams or plain, .srt, .txt) and
// timestamps at a speaking pace of about 140 words a minute. Seeded: the same files on every run.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { speechLines } from '../lib/minutes/transcript.js';

const DIR = new URL('../samples/meetings/', import.meta.url);
const spec = JSON.parse(readFileSync(new URL('specs.json', DIR), 'utf8'));
const bank = spec.bank;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The hand-written lines of a meeting: beat id -> { who, say }. */
export function beatsOf(m) {
  return Object.fromEntries(m.topics.flatMap((t) => t.beats.map((b, i) => [b.id ?? `${t.key}.${i + 1}`, b])));
}

function build(m, dialogue, seed) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const chance = (p) => r() < p;
  const byKey = Object.fromEntries(m.attendees.map((p) => [p.key, p]));
  const label = (key) => {
    const p = byKey[key];
    if (!p) throw new Error(`${m.id}: unknown speaker key "${key}" in the dialogue`);
    if (p.dialIn) return p.dialIn;
    if (m.format === 'teams' && p.team) return `${p.name} (${p.team})`;
    if (p.aliases?.length && chance(m.noise.nameVariants ?? 0)) return pick(p.aliases);
    return p.name;
  };
  const other = (key) => pick(m.attendees.filter((p) => p.key !== key && !p.dialIn)).key;

  function roughen(text, isBeat) {
    let t = text;
    if (!isBeat) for (const [a, b] of m.noise.asr ?? []) if (t.includes(a) && chance(0.6)) t = t.replace(a, b);
    if (chance(m.noise.fillers)) { const w = t.split(' '); if (w.length > 4) { w.splice(1 + Math.floor(r() * (w.length - 2)), 0, pick(bank.fillers)); t = w.join(' '); } }
    if (chance(m.noise.repeats)) t = t.replace(/^(\w+)/, '$1, $1');
    return t;
  }

  // The hand-written lines must all be there, once, unchanged, said by the right person.
  const beats = beatsOf(m);
  const seen = new Set();
  for (const l of dialogue) {
    if (!l.beat) continue;
    const b = beats[l.beat];
    if (!b) { delete l.beat; continue; } // a label on a line that is not a hand-written one (e.g. an opener)
    if (seen.has(l.beat)) throw new Error(`${m.id}: beat ${l.beat} appears twice`);
    if (!l.text.toLowerCase().includes(b.say.trim().toLowerCase())) throw new Error(`${m.id}: beat ${l.beat} was changed: "${l.text}"`);
    if (l.who !== b.who) throw new Error(`${m.id}: beat ${l.beat} said by ${l.who}, not ${b.who}`);
    seen.add(l.beat);
  }
  const missing = Object.keys(beats).filter((k) => !seen.has(k));
  if (missing.length) throw new Error(`${m.id}: beats missing from the dialogue: ${missing.join(', ')}`);

  const out = [];
  const mid = Math.floor(dialogue.length / 2);
  dialogue.forEach((l, i) => {
    out.push({ who: l.who, text: roughen(l.text, Boolean(l.beat)), beat: l.beat });
    if (!l.beat && chance(0.08)) out.push({ who: other(l.who), text: pick(bank.backchannel) });
    if (chance((m.noise.crosstalk ?? 0) / 4)) { out.push({ who: other(l.who), text: pick(bank.crosstalk) }); out.push({ who: l.who, text: pick(bank.resume) }); }
    if (i === mid) for (const o of m.noise.offtopic ?? []) out.push({ who: o.who, text: o.text });
  });

  let sec = 3 + Math.floor(r() * 20);
  return out.map((l) => {
    const dur = Math.max(2, Math.round(l.text.split(/\s+/).length / 2.35));
    const t = { ...l, label: label(l.who), start: sec, end: sec + dur };
    sec += dur + Math.floor(r() * 3);
    return t;
  });
}

const hms = (s, sep) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${sep}000`;

function render(m, lines) {
  if (m.format === 'vtt' || m.format === 'teams') {
    return ['WEBVTT', '', `NOTE Synthetic meeting transcript (prj01-R1 US-4 mock ${m.id}).`, '',
      ...lines.flatMap((l, i) => [String(i + 1), `${hms(l.start, '.')} --> ${hms(l.end, '.')}`, `<v ${l.label}>${l.text}</v>`, ''])].join('\n');
  }
  if (m.format === 'srt') return lines.flatMap((l, i) => [String(i + 1), `${hms(l.start, ',')} --> ${hms(l.end, ',')}`, `${l.label}: ${l.text}`, '']).join('\n');
  return lines.map((l) => `[${hms(l.start, '').slice(0, 8)}] ${l.label}: ${l.text}`).join('\n');
}

function main() {
  const missing = spec.meetings.filter((m) => !existsSync(new URL(`dialogue/${m.id}.json`, DIR))).map((m) => m.id);
  if (missing.length) { console.error(`No dialogue yet for ${missing.join(', ')}: run GET /api/eval?task=dialogue&case=<id> on a preview first.`); process.exit(1); }
  const golden = [];
  spec.meetings.forEach((m, i) => {
    const dialogue = JSON.parse(readFileSync(new URL(`dialogue/${m.id}.json`, DIR), 'utf8')).lines;
    const lines = build(m, dialogue, 1000 + i * 7919);
    const text = render(m, lines) + '\n';
    writeFileSync(new URL(m.file, DIR), text);
    const parsed = speechLines(text);
    const at = {};
    let from = 0;
    for (const l of lines.filter((x) => x.beat)) {
      const k = parsed.findIndex((p, j) => j >= from && p.text === l.text);
      if (k < 0) throw new Error(`${m.id}: beat ${l.beat} not found in the rendered transcript`);
      at[l.beat] = { line: parsed[k].n, text: l.text };
      from = k + 1;
    }
    const words = parsed.reduce((s, l) => s + l.text.split(/\s+/).length, 0);
    const minutes = Math.round(lines.at(-1).end / 60);
    golden.push({
      id: m.id, file: m.file, project: m.project, title: m.title, date: m.date, words, minutes,
      topics: m.topics.map((t) => ({ topic: t.title, mustSay: t.mustSay ?? [], actions: t.actions ?? [] })),
      raidd: (m.raidd ?? []).map((e) => ({ ...e, at: at[e.beat] })),
      notRaidd: (m.notRaidd ?? []).map((e) => ({ ...e, at: at[e.beat] })),
    });
    console.log(`${m.id} ${m.file}: ${parsed.length} lines, ${words} words, about ${minutes} minutes, ${golden.at(-1).raidd.length} RAIDD events`);
  });
  writeFileSync(new URL('golden.json', DIR), JSON.stringify({ note: 'Built by scripts/make-mock-meetings.mjs. Line numbers count speech lines as lib/minutes/transcript.js does.', meetings: golden }, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
