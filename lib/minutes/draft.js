// Drafts minutes from a transcript through the gateway (prj01-R1 US-4): one call, code checks, and at
// most settings.repairRounds repair calls that name the failed checks. Nothing is stored here.
import template from './template.json' with { type: 'json' };
import settings from './settings.json' with { type: 'json' };
import { speechLines } from './transcript.js';
import { minutesTool, systemPrompt, userMessage, repairMessage } from './prompt.js';
import { verifyMinutes } from './verify.js';

export class MinutesError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

function toolInput(message) {
  const use = message?.content?.find((c) => c.type === 'tool_use' && c.name === 'record_minutes');
  if (!use) throw new MinutesError('no_minutes', 'The model did not return minutes');
  return use;
}

export async function draftMinutes({ gateway, raw, project, otherProjects = [], source, tenantId = null, names = [], tpl = template, cfg = settings }) {
  const lines = speechLines(raw);
  if (lines.length < 5) throw new MinutesError('too_short', 'The transcript has fewer than 5 speech lines');
  const tool = minutesTool(tpl);
  const messages = [{ role: 'user', content: userMessage({ lines, project, otherProjects, source }) }];
  const calls = [];
  let result;
  for (let round = 0; round <= cfg.repairRounds; round += 1) {
    const r = await gateway.call({
      purpose: round === 0 ? 'minutes' : 'minutes-repair',
      model: cfg.model, max_tokens: cfg.maxTokens, system: systemPrompt(tpl), messages,
      tools: [tool], tool_choice: { type: 'tool', name: 'record_minutes' }, tenantId, names,
    });
    calls.push({ round, costUsd: r.costUsd, latencyMs: r.latencyMs, usage: r.usage, traceId: r.traceId, logged: r.logged });
    const use = toolInput(r.message);
    result = verifyMinutes(use.input, lines, tpl);
    if (result.checks.ok || round === cfg.repairRounds) break;
    messages.push({ role: 'assistant', content: r.message.content });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, content: repairMessage(result.checks.problems) }] });
  }
  return {
    ...result,
    lines,
    template: { id: tpl.id, version: tpl.version },
    model: cfg.model,
    calls,
    costUsd: calls.reduce((s, c) => s + (c.costUsd ?? 0), 0),
  };
}
