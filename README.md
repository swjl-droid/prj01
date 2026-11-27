# prj01: PM copilot

Build repo for the PM copilot (ADR-03: one platform repo, plus one repo per build).

- **Platform and shared rules:** [swjl-droid/ai-platform](https://github.com/swjl-droid/ai-platform). Read its `CLAUDE.md` first.
- **Deploys:** Vercel project `prj01` (team `swjl`), functions in `sin1` (Singapore).
- **Data:** schema `app_prj01` in the shared Supabase project `ai-platform`.

## Release 1 (prj01-R1)

- **Sign-in (US-1):** e-mail and password with Supabase Auth, through `api/auth.js`; the browser keeps
  the token in the tab's memory only. `api/programme.js` reads `app_prj01` with the person's token, so the
  database's RLS shows only their own organisation; the first sign-in creates their synthetic sample
  programme (3 projects). `api/forget-me.js` calls `app_prj01.forget_me()`. Schema, policies and the
  separation and forget-me tests live in ai-platform (`supabase/`).
- **Settings in Vercel:** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (Production and Preview).
- **Golden-set check:** `node eval/run.mjs` runs every set in `eval/golden/` and fails below its
  threshold; `--selftest` proves a wrong answer fails. CI runs both.
- **Schedule import (US-2):** one generic schema for every method (decision 26/11, Hub row 239). Method
  labels, column names and extras live in `lib/schedule/profiles.json` (data: a new method or column is
  a new entry). Every method uses the same 12 slots in the same order (Key, Name, Type, Parent, Start,
  Finish, Duration, Size, Owner, Status, Links, Notes), extras from slot 13. Accepted: CSV / TSV / TXT,
  `.xlsx` (one schedule per sheet), paste from a spreadsheet, a folder of files. Links are
  `KEY[FS|SS|FF|SF][+/-Nd]`, e.g. `T3.4, M03+3d, 1.1.2SS+5d`. A file with any problem is refused whole,
  with every reason. After storing, the import reads the schedule back from the database and counts
  the cells that differ from the source (must be 0). Blank templates: `/api/template?method=<method>`.
- **Mock schedules:** `samples/schedules` (8 mocks, 2 per method; refused samples in `bad/`), rebuilt
  with `node scripts/make-mock-schedules.mjs`. The golden sets `schedule_import` and
  `schedule_refusals` check them in CI.
- **Transcript drop point (US-3):** "Drop a transcript" takes a file (`.txt`, `.md`, `.vtt`, `.srt`)
  or pasted text, refuses a wrong type, unreadable text, a text too short or the same text dropped
  twice, and matches it to a project by signal scoring (decision 26/11, Hub row 242): project name,
  the project's schedule (keys, task names, words only it uses) and the people who own its tasks.
  Weights, threshold, gap and runner-up share are settings in `lib/intake/match-settings.json`. When
  no project or two projects fit, it asks "Which project?" and files the transcript once the PM picks.
  Mock transcripts: `samples/transcripts` (golden set `transcript_match`).
- **Minutes from a transcript (US-4):** "Minutes" on a filed transcript drafts them with Claude Opus 5.5
  through the gateway (AI-L15 decision): numbered topics, each with its discussion and actions, every
  point backed by quotes from the transcript. The template is data (`lib/minutes/template.json`, from
  John's AI-L07 rubric); model and limits in `lib/minutes/settings.json`. Code checks every quote word
  for word against the line it cites (`lib/minutes/verify.js`) and asks the model once to repair a
  failed check. Minutes are stored as a draft (`app_prj01.minutes`, a new version per redraft) and the
  PM approves them. The API refuses a forced tool choice on these models, so the tool is on auto and
  an answer without it is a failure.
- **Mock meetings:** `samples/meetings` holds 10 mock 30-minute meetings (specs written by hand,
  discussion by Sonnet 5.5 kept in `dialogue/`, noise added by `node scripts/make-mock-meetings.mjs`),
  their golden file and the evaluation minutes (`minutes/`). Golden set `minutes_stored` re-checks the
  stored minutes in CI. `api/eval.js` (previews only) writes dialogue and drafts evaluation minutes.
- **Minutes review (US-4 acceptance, decision Hub row 305):** two model judges (`lib/minutes/judge.json`:
  Sonnet 5.5 and Opus 5.5, `?task=judge&case=m01&judge=sonnet`) give every topic and RAIDD row OK or
  Needs edit with a reason (`samples/meetings/judges/`). John reviews any items in the evidence pack;
  his verdicts are copied to `samples/meetings/review/john.json`. Final per item: John's, else both
  judges' when they agree, else not OK (`lib/minutes/review.js`). Golden set `minutes_review` fails CI
  until at least 70 % of topics and 80 % of RAIDD rows end OK. The older strict line-distance check
  (`minutes_raidd`) is printed for information only (`"blocking": false`).
