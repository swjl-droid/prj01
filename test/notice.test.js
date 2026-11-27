// prj01-R1 US-7: the terms and data notice exists, has the shared template's sections, says what the
// story asks for, and is linked from the sign-in card. No network: reads the files in public/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const notice = readFileSync(new URL('../public/notice.html', import.meta.url), 'utf8');
const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const text = notice.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// The 10 sections of the shared terms template (decision 20/11, Hub row 142), in order.
const SECTIONS = [
  'Who runs it', 'What it is', 'What data it keeps', 'Where data goes', 'Trial and end',
  'Your rights', 'What not to upload', 'Children', 'Limits and responsibility', 'Changes and contact',
];

test('the notice has the 10 template sections, numbered and in order', () => {
  const heads = [...notice.matchAll(/<h2 id="s(\d+)">(\d+)\. ([^<]+)<\/h2>/g)];
  assert.equal(heads.length, SECTIONS.length);
  heads.forEach((h, i) => {
    assert.equal(Number(h[1]), i + 1);
    assert.equal(Number(h[2]), i + 1);
    assert.ok(h[3].startsWith(SECTIONS[i]), `section ${i + 1} is "${h[3]}"`);
  });
});

test('the notice carries a version number and a date', () => {
  assert.match(notice, /<p class="meta" id="version">Version v\d+(\.\d+)?[^<]*\d{1,2} \w+ 20\d\d/);
});

test('the notice states what the story asks for', () => {
  assert.match(text, /prototype/i);                       // prototype status
  assert.match(text, /What data it keeps/);                // data collected
  assert.match(notice, /<tr><td>Supabase[^\n]*<td>Singapore<\/td><\/tr>/); // where it goes
  assert.match(notice, /id="voyage"[\s\S]*Any region/);    // the Voyage 'any region' note (Hub row 163)
  assert.match(text, /Forget me/);                         // how to forget me
  assert.match(text, /not liable/);                        // liability limits
});

test('the sign-in card links the notice', () => {
  const signin = index.slice(index.indexOf('<section id="signin"'), index.indexOf('</section>', index.indexOf('<section id="signin"')));
  assert.match(signin, /<a href="\/notice\.html"[^>]*>terms and data notice<\/a>/);
});
