// Schedule import (prj01-R1 US-2; design decided by John 26/11/2026, Hub row 239).
// Plain English: a schedule file is read into one shape for every method (12 fixed slots plus the
// method's extras), checked line by line, and refused as a whole, with every reason, if anything is
// wrong, so nothing is ever half-imported. exportRows() writes it back in the fixed order with the
// method's own column names, which is how the read-back is compared with the source.
import ExcelJS from 'exceljs';
import profilesData from './profiles.json' with { type: 'json' };

export const SLOTS = profilesData.slots;
export const METHODS = Object.keys(profilesData.methods);
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;
const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];
const MAX_ROWS = 2000;

export function profile(method) {
  const p = profilesData.methods[method];
  if (!p) throw new ImportError([{ row: null, column: null, reason: `Unknown method "${method}". Use one of: ${METHODS.join(', ')}` }]);
  return p;
}

export class ImportError extends Error {
  constructor(errors) {
    super(errors.map((e) => e.reason).join('; '));
    this.errors = errors;
  }
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- 1. Read a file into a table of strings (or Dates) ----------

export function parseDelimited(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t'
    : (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new ImportError([{ row: rows.length + 1, column: null, reason: 'A quoted cell is never closed' }]);
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

async function parseXlsx(bytes) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch {
    throw new ImportError([{ row: null, column: null, reason: 'The Excel file cannot be opened (damaged, password-protected or not .xlsx)' }]);
  }
  const sheets = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const v = r.getCell(c).value;
        vals.push(cellValue(v));
      }
      if (vals.some((v) => String(v ?? '').trim() !== '')) rows.push(vals);
    });
    if (rows.length) sheets.push({ sheet: ws.name, rows });
  });
  return sheets;
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);            // formula: its last value
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);                   // hyperlink
    return '';
  }
  return v;
}

// Returns one table per schedule in the input: a CSV / pasted text is one table, an .xlsx is one per sheet.
export async function readTables({ name, bytes, text }) {
  const lower = String(name ?? '').toLowerCase();
  if (text !== undefined && (!name || /\.(csv|tsv|txt)$/.test(lower) || lower === 'paste')) {
    return [{ source: name || 'paste', rows: parseDelimited(text) }];
  }
  if (/\.(csv|tsv|txt)$/.test(lower)) {
    const t = new TextDecoder('utf-8', { fatal: true });
    let decoded;
    try { decoded = t.decode(bytes); } catch {
      throw new ImportError([{ row: null, column: null, reason: 'The file is not readable text (UTF-8)' }]);
    }
    return [{ source: name, rows: parseDelimited(decoded) }];
  }
  if (/\.xlsx$/.test(lower)) {
    const sheets = await parseXlsx(bytes);
    if (!sheets.length) throw new ImportError([{ row: null, column: null, reason: 'The Excel file has no filled sheet' }]);
    return sheets.map((s) => ({ source: sheets.length > 1 ? `${name} [${s.sheet}]` : name, rows: s.rows }));
  }
  throw new ImportError([{ row: null, column: null, reason: `File type not accepted: "${name}". Use .csv, .tsv, .txt or .xlsx` }]);
}

// ---------- 2. Map columns, check every cell ----------

function headerMap(headers, p, errors) {
  const lookup = new Map();
  for (const slot of SLOTS) {
    for (const n of [slot, p.labels[slot], ...(p.aliases[slot] ?? [])]) if (n) lookup.set(norm(n), { slot });
  }
  for (const x of p.extras) for (const n of [x.key, x.label, ...(x.aliases ?? [])]) lookup.set(norm(n), { extra: x.key });
  const map = [];
  const seen = new Set();
  headers.forEach((h, i) => {
    const hit = lookup.get(norm(h));
    if (String(h ?? '').trim() === '') { map[i] = null; return; }
    if (!hit) {
      errors.push({ row: 1, column: String(h), reason: `Column "${h}" is not a ${p.name ?? ''} column. Accepted: ${[...SLOTS.map((s) => p.labels[s]), ...p.extras.map((x) => x.label)].join(', ')}`.replace(' a  column', ' a known column') });
      map[i] = null; return;
    }
    const id = hit.slot ?? `extra:${hit.extra}`;
    if (seen.has(id)) errors.push({ row: 1, column: String(h), reason: `Column "${h}" appears twice` });
    seen.add(id);
    map[i] = hit;
  });
  for (const r of p.required) {
    if (!seen.has(r)) errors.push({ row: 1, column: p.labels[r], reason: `Required column "${p.labels[r]}" is missing` });
  }
  return map;
}

function toIsoDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {          // Excel date serial
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let y, mo, d;
  if (m) [, y, mo, d] = m;
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [, d, mo, y] = m;  // dd/mm/yyyy
  else return null;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return null;
  return dt.toISOString().slice(0, 10);
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*(d|days?|pts?|points?)?\s*$/i.exec(String(v).replace(/^±/, ''));
  return m ? Number(m[1]) : null;
}

function parseLinks(cell, keys, toKey) {
  const out = [], errs = [];
  const s = String(cell ?? '').trim();
  if (s === '' || s === '—' || s === '-') return { out, errs };
  for (const raw of s.split(/[,;]/).map((t) => t.trim()).filter(Boolean)) {
    // A token that is itself a key is a plain finish-to-start link; otherwise KEY[FS|SS|FF|SF][+/-Nd].
    const m = keys.has(raw) ? null : /^(.+?)([+-]\d+)d$/i.exec(raw);
    let body = m ? m[1] : raw;
    const lag = m ? Number(m[2]) : 0;
    let type = 'FS';
    if (!keys.has(body)) {
      const t = body.slice(-2).toUpperCase();
      if (LINK_TYPES.includes(t) && keys.has(body.slice(0, -2))) { type = t; body = body.slice(0, -2); }
    }
    if (!keys.has(body)) { errs.push(`link "${raw}" points to an unknown key`); continue; }
    if (body === toKey) { errs.push(`link "${raw}" points to the item itself`); continue; }
    out.push({ from: body, to: toKey, type, lag });
  }
  return { out, errs };
}

// table: { source, rows } (row 0 = headers). Returns { method, source, items, links } or throws ImportError.
export function parseSchedule(table, method) {
  const p = { ...profile(method), name: method };
  const errors = [];
  const [headers = [], ...body] = table.rows;
  if (!body.length) throw new ImportError([{ row: null, column: null, reason: 'The schedule has a header row but no tasks' }]);
  if (body.length > MAX_ROWS) throw new ImportError([{ row: null, column: null, reason: `More than ${MAX_ROWS} rows` }]);
  const map = headerMap(headers, p, errors);
  if (errors.length) throw new ImportError(errors);

  const raw = body.map((r, i) => {
    const item = { row: i + 2, extras: {}, rawLinks: '' };
    map.forEach((m, c) => {
      if (!m) return;
      const v = r[c] ?? '';
      if (m.slot) item[m.slot] = v; else if (String(v).trim() !== '') item.extras[m.extra] = String(v).trim();
    });
    return item;
  });
  const keys = new Set();
  for (const it of raw) {
    const k = String(it.key ?? '').trim();
    if (!k) errors.push({ row: it.row, column: p.labels.key, reason: `Row ${it.row}: ${p.labels.key} is empty` });
    else if (!KEY_RE.test(k)) errors.push({ row: it.row, column: p.labels.key, reason: `Row ${it.row}: ${p.labels.key} "${k}" may only use letters, digits, dot, dash and underscore` });
    else if (keys.has(k)) errors.push({ row: it.row, column: p.labels.key, reason: `Row ${it.row}: ${p.labels.key} "${k}" appears twice` });
    keys.add(k);
  }
  const typeLookup = new Map(p.types.map((t) => [norm(t), t]));
  const items = [], links = [];
  for (const it of raw) {
    const key = String(it.key ?? '').trim();
    const where = (slot) => ({ row: it.row, column: p.labels[slot] });
    const name = String(it.name ?? '').trim();
    if (!name) errors.push({ ...where('name'), reason: `Row ${it.row}: ${p.labels.name} is empty` });
    const type = typeLookup.get(norm(it.type));
    if (!type) errors.push({ ...where('type'), reason: `Row ${it.row}: ${p.labels.type} "${String(it.type ?? '').trim()}" is not one of: ${p.types.join(', ')}` });
    const parent = String(it.parent ?? '').trim();
    if (parent && !keys.has(parent)) errors.push({ ...where('parent'), reason: `Row ${it.row}: ${p.labels.parent} "${parent}" is not a key in this schedule` });
    if (parent && parent === key) errors.push({ ...where('parent'), reason: `Row ${it.row}: an item cannot be its own ${p.labels.parent}` });
    const dates = {};
    for (const slot of ['start', 'finish']) {
      const v = it[slot];
      if (v === undefined || String(v).trim?.() === '' || v === '') {
        if (p.required.includes(slot)) errors.push({ ...where(slot), reason: `Row ${it.row}: ${p.labels[slot]} is empty` });
        dates[slot] = null; continue;
      }
      dates[slot] = toIsoDate(v);
      if (!dates[slot]) errors.push({ ...where(slot), reason: `Row ${it.row}: ${p.labels[slot]} "${String(v)}" is not a date (use yyyy-mm-dd or dd/mm/yyyy)` });
    }
    if (dates.start && dates.finish && dates.finish < dates.start) {
      errors.push({ ...where('finish'), reason: `Row ${it.row}: ${p.labels.finish} ${dates.finish} is before ${p.labels.start} ${dates.start}` });
    }
    let size = null;
    if (it.size !== undefined && String(it.size).trim() !== '') {
      size = toNumber(it.size);
      if (size === null) errors.push({ ...where('size'), reason: `Row ${it.row}: ${p.labels.size} "${String(it.size)}" is not a number` });
    }
    const l = parseLinks(it.links, keys, key);
    for (const e of l.errs) errors.push({ ...where('links'), reason: `Row ${it.row}: ${p.labels.links} ${e}` });
    links.push(...l.out);
    items.push({
      key, name, type: type ?? '', parent: parent || null, start: dates.start, finish: dates.finish,
      duration: String(it.duration ?? '').trim() || null, size,
      owner: String(it.owner ?? '').trim() || null, status: String(it.status ?? '').trim() || null,
      notes: String(it.notes ?? '').trim() || null, extras: it.extras,
    });
  }
  // A parent chain must not loop back on itself.
  const parentOf = new Map(items.map((i) => [i.key, i.parent]));
  for (const i of items) {
    const seen = new Set([i.key]);
    for (let p2 = parentOf.get(i.key); p2; p2 = parentOf.get(p2)) {
      if (seen.has(p2)) { errors.push({ row: null, column: p.labels.parent, reason: `${p.labels.parent} chain loops at "${i.key}"` }); break; }
      seen.add(p2);
    }
  }
  if (errors.length) throw new ImportError(errors);
  return { method, source: table.source, items, links };
}

// ---------- 3. Write back in the fixed order, with the method's labels ----------

export function linkText(l) {
  return `${l.from}${l.type === 'FS' ? '' : l.type}${l.lag ? `${l.lag > 0 ? '+' : ''}${l.lag}d` : ''}`;
}

export function exportRows(schedule) {
  const p = profile(schedule.method);
  const header = [...SLOTS.map((s) => p.labels[s]), ...p.extras.map((x) => x.label)];
  const byTo = new Map();
  for (const l of schedule.links) byTo.set(l.to, [...(byTo.get(l.to) ?? []), l]);
  const rows = schedule.items.map((i) => [
    i.key, i.name, i.type, i.parent ?? '', i.start ?? '', i.finish ?? '', i.duration ?? '',
    i.size === null || i.size === undefined ? '' : String(Number(i.size)),
    i.owner ?? '', i.status ?? '', (byTo.get(i.key) ?? []).map(linkText).join(', '), i.notes ?? '',
    ...p.extras.map((x) => i.extras?.[x.key] ?? ''),
  ]);
  return [header, ...rows];
}

// ---------- 4. Read-back check: does what we stored say exactly what the source said? ----------
// Compares every mapped cell of the source with the read-back, after the same normalisation the
// import applies (trim, dates to yyyy-mm-dd, numbers, link lists). Returns the list of differences.
export function compareWithSource(table, schedule) {
  const p = { ...profile(schedule.method), name: schedule.method };
  const map = headerMap(table.rows[0], p, []);
  const back = exportRows(schedule);
  const backCol = new Map(back[0].map((h, i) => [h, i]));
  const diffs = [];
  const slotLabel = (m) => (m.slot ? p.labels[m.slot] : p.extras.find((x) => x.key === m.extra).label);
  table.rows.slice(1).forEach((r, ri) => {
    map.forEach((m, c) => {
      if (!m) return;
      const label = slotLabel(m);
      const want = canon(m.slot, r[c]);
      const got = canon(m.slot, back[ri + 1][backCol.get(label)]);
      if (want !== got) diffs.push({ row: ri + 2, column: label, source: want, readBack: got });
    });
  });
  if (back.length - 1 !== table.rows.length - 1) diffs.push({ row: null, column: null, source: table.rows.length - 1, readBack: back.length - 1 });
  return diffs;
}

function canon(slot, v) {
  if (v === null || v === undefined) return '';
  if (slot === 'start' || slot === 'finish') return String(v).trim() === '' ? '' : (toIsoDate(v) ?? String(v));
  if (slot === 'size') { const n = toNumber(v); return n === null ? String(v).trim() : String(n); }
  if (slot === 'type') return norm(v);
  if (slot === 'links') {
    const s = String(v).trim();
    if (s === '' || s === '—' || s === '-') return '';
    return s.split(/[,;]/).map((t) => t.trim().replace(/^(.+?)FS(?=[+-]\d+d$|$)/i, '$1').replace(/([+-])0+(\d)/, '$1$2')).filter(Boolean).join(', ');
  }
  return String(v).trim();
}
