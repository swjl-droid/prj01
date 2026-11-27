// Minutes as Markdown, every point followed by its quotes and their line numbers (prj01-R1 US-4).
export function minutesMarkdown({ minutes, project, lines }) {
  const time = new Map(lines.map((l) => [l.n, l.time]));
  const q = (quotes) => quotes.map((x) => `> L${x.line}${time.get(x.line) ? ` (${time.get(x.line)})` : ''}: "${x.text}"${x.found ? '' : ' (NOT FOUND)'}`).join('\n');
  const m = minutes.meeting ?? {};
  const out = [
    `# ${m.title || 'Meeting minutes'}`,
    '',
    `- **Project:** ${project.name}`,
    `- **Date:** ${m.date || 'not stated'}`,
    `- **Attendees:** ${(m.attendees ?? []).join(', ') || 'not stated'}`,
  ];
  minutes.topics.forEach((t, i) => {
    out.push('', `## ${i + 1}. ${t.title}`, '', '**Discussion**', '');
    t.summary.forEach((p) => out.push(`- ${p.text}`, '', q(p.quotes), ''));
    out.push('**Actions**', '');
    if (t.actions.length === 0) out.push('- None agreed.', '');
    t.actions.forEach((a) => out.push(`- ${a.text}${a.owner ? ` (owner: ${a.owner}` : ' (owner: not stated'}${a.due ? `, due: ${a.due})` : ')'}`, '', q(a.quotes), ''));
  });
  if (Array.isArray(minutes.raidd)) {
    out.push('', '## RAIDD', '');
    if (minutes.raidd.length === 0) out.push('None raised.', '');
    else {
      out.push('| # | Type | New or update | Item | Topic |', '| --- | --- | --- | --- | --- |');
      minutes.raidd.forEach((r, i) => out.push(`| ${i + 1} | ${r.type} | ${r.change} | ${r.title.replace(/\|/g, '/')} | ${r.topic} |`));
      out.push('');
      minutes.raidd.forEach((r, i) => out.push(`RAIDD ${i + 1}:`, q(r.quotes), ''));
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
