// What the model is asked for (prj01-R1 US-4). The template's rules and limits come from template.json,
// so a rule change is a data change; the tool schema forces a structured answer that code can check.
import { numbered } from './transcript.js';

const quote = {
  type: 'object',
  required: ['line', 'text'],
  properties: {
    line: { type: 'integer', description: 'The number of the transcript line the quote is copied from (the n in [Ln])' },
    text: { type: 'string', description: 'Words copied exactly from that line' },
  },
};

export function minutesTool(template) {
  const L = template.limits;
  return {
    name: 'record_minutes',
    description: 'Record the minutes of the meeting, every point backed by exact quotes.',
    input_schema: {
      type: 'object',
      required: ['meeting', 'topics'],
      properties: {
        meeting: {
          type: 'object',
          required: ['title', 'attendees'],
          properties: {
            title: { type: 'string', description: 'Short title of the meeting' },
            date: { type: 'string', description: 'Meeting date as said or shown in the transcript (YYYY-MM-DD), or empty' },
            attendees: { type: 'array', items: { type: 'string' }, description: 'People who spoke, as named in the transcript' },
          },
        },
        topics: {
          type: 'array', minItems: 1, maxItems: L.maxTopics,
          items: {
            type: 'object',
            required: ['title', 'summary', 'actions'],
            properties: {
              title: { type: 'string' },
              summary: {
                type: 'array', minItems: 1, maxItems: L.maxPointsPerTopic,
                items: { type: 'object', required: ['text', 'quotes'], properties: { text: { type: 'string' }, quotes: { type: 'array', minItems: 1, items: quote } } },
              },
              actions: {
                type: 'array', maxItems: L.maxActionsPerTopic, description: 'Empty when the topic agreed no action',
                items: {
                  type: 'object', required: ['text', 'quotes'],
                  properties: {
                    text: { type: 'string' },
                    owner: { type: 'string', description: 'As named in the meeting, or empty' },
                    due: { type: 'string', description: 'As said in the meeting, or empty' },
                    quotes: { type: 'array', minItems: 1, items: quote },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

export function systemPrompt(template) {
  return [
    'You write meeting minutes for a project manager. The minutes follow the template below exactly.',
    `Template "${template.id}" v${template.version}:`,
    `- Topic summary: ${template.topic.summary}`,
    `- Topic actions: ${template.topic.actions}`,
    ...template.rules.map((r) => `- ${r}`),
    `Limits: at most ${template.limits.maxTopics} topics, ${template.limits.maxPointsPerTopic} summary points and ${template.limits.maxActionsPerTopic} actions per topic; quotes at most ${template.limits.maxQuoteWords} words.`,
    `Write in ${template.language}. Answer only by calling record_minutes.`,
  ].join('\n');
}

export function userMessage({ lines, project, otherProjects = [], source }) {
  const others = otherProjects.length ? otherProjects.map((p) => p.name).join('; ') : 'none';
  return [
    `Project: ${project.name} (${project.methodology}). ${project.summary ?? ''}`.trim(),
    `Other projects in the same organisation: ${others}.`,
    `Transcript file: ${source ?? 'pasted text'}. Each line starts with its number [Ln], then the time if known, then the speaker.`,
    '',
    numbered(lines),
  ].join('\n');
}

export function repairMessage(problems) {
  return [
    'Some points in your minutes failed the checks below. Call record_minutes again with the whole corrected minutes.',
    'Copy each quote exactly from the line you cite; drop a point you cannot back with a real quote.',
    ...problems.map((p) => `- ${p.where}: ${p.detail}`),
  ].join('\n');
}
