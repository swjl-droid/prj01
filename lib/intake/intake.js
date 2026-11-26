// Transcript intake checks (prj01-R1 US-3): file type, readable text, size, and a fingerprint for the
// duplicate check. A file that fails is refused with its reason; nothing is stored.
import { createHash } from 'node:crypto';

export const TYPES = ['.txt', '.md', '.vtt', '.srt'];
const MIN_CHARS = 200;
const MAX_BYTES = 1024 * 1024;

export class IntakeError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

export function readTranscript({ name, bytes, text }) {
  let content;
  if (typeof text === 'string') content = text;
  else {
    const lower = String(name ?? '').toLowerCase();
    const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
    if (!TYPES.includes(ext)) throw new IntakeError(`File type not accepted: "${name}". Use ${TYPES.join(', ')} or paste the text`);
    if (bytes.length > MAX_BYTES) throw new IntakeError('File too large (1 MB at most, about 150,000 words)');
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
      throw new IntakeError('The file is not readable text (UTF-8)');
    }
  }
  content = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (content.trim().length < MIN_CHARS) throw new IntakeError(`Too short to be a meeting transcript (${content.trim().length} characters; at least ${MIN_CHARS})`);
  // The fingerprint ignores spacing and case, so the same transcript saved twice is still a duplicate.
  const sha256 = createHash('sha256').update(content.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
  return { source: name || 'paste', text: content, sha256 };
}
