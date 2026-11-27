// Turns a stored transcript (plain text, Teams/Zoom .vtt, .srt, "Name: text" lines) into numbered
// speech lines, so the model can cite a line and code can check the quote against it (prj01-R1 US-4).

const TIME = /(\d{1,2}:)?\d{1,2}:\d{2}([.,]\d{1,3})?/;
const CUE = new RegExp(`^\\s*${TIME.source}\\s*-->\\s*${TIME.source}`);
// "Name: text", "[00:12:34] Name (Team): text", and unnamed speakers such as "Speaker 5" or "Call-in user 2".
const SPEAKER_PREFIX = /^\s*(\[[^\]]{1,20}\]\s*)?([A-Z+][\w.'+-]*(?:\s+[\w+][\w.'+-]*){0,3}(?:\s*\([^)]{1,30}\))?)\s*:\s+(.+)$/;

/** Splits the text into speech lines: { n (1-based), speaker, time, text }. */
export function speechLines(raw) {
  const out = [];
  let time = null;
  for (const rawLine of String(raw).replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line || /^WEBVTT/.test(line) || /^NOTE(\s|$)/.test(line) || /^\d+$/.test(line)) continue;
    const cue = line.match(CUE);
    if (cue) { time = line.match(TIME)[0].replace(',', '.'); continue; }
    let speaker = null;
    let text = line;
    const v = line.match(/^<v\s+([^>]+)>(.*?)(<\/v>)?$/);
    if (v) { speaker = v[1].trim(); text = v[2].trim(); } else {
      const p = line.match(SPEAKER_PREFIX);
      if (p) { speaker = p[2].trim(); text = p[3].trim(); if (p[1]) time = p[1].replace(/[[\]\s]/g, ''); }
    }
    text = text.replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    out.push({ n: out.length + 1, speaker, time, text });
  }
  return out;
}

/** The transcript as the model sees it: one numbered line per speech line. */
export function numbered(lines) {
  return lines.map((l) => `[L${l.n}]${l.time ? ` (${l.time})` : ''} ${l.speaker ?? 'Unknown'}: ${l.text}`).join('\n');
}

/** Lower case, one space, plain quotes and dashes: the only differences a quote may have. */
export function norm(s) {
  return String(s).toLowerCase()
    .replace(/[‘’‛`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/…/g, '...').replace(/\s+/g, ' ').trim();
}
