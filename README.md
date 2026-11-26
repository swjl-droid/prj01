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
