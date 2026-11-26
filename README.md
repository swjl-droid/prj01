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
