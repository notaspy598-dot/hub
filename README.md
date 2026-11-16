# Hub

A static page with Learn and Style tabs. Supabase holds the login, data and images, and n8n does the AI work. On the server it's one tiny nginx container that uses a few MB of RAM.

| Path | What it is |
|---|---|
| `public/` | The site. |
| `Dockerfile`, `write-config.sh` | The container: nginx serves `public/`, and at every start it writes `config.js` from the env vars below. |
| `sql/001_hub.sql` | Phase 1 database setup. Safe to run again. |
| `sql/002_learn.sql` | Phase 2: XP for the Daily Starter and mini-games. Safe to run again. |
| `sql/test-001.mjs` | A self-check that runs the SQL against an in-memory Postgres with Supabase's auth and storage stubbed in. |
| `tests/text.test.mjs` | A self-check for the typo-tolerant answer matching in Fill the blank. |

## Setup (once)

1. **Close sign-ups.** In Coolify, open your Supabase service → Environment Variables → set `DISABLE_SIGNUP` to `true` → Restart. Otherwise anyone who finds the page could create an account and upload images.
2. **Create your login.** In Supabase Studio → Authentication → Users → Add user → enter an email and password, and tick *Auto Confirm User*.
3. **Run the database setup.** In Studio → SQL Editor, paste all of `sql/001_hub.sql` and click Run. It should end with `Hub phase 1 ready`. Then do the same with `sql/002_learn.sql`, which ends with `Hub phase 2 ready`.

## Deploy in Coolify

1. **New Resource → Public Repository** → `https://github.com/notaspy598-dot/hub`.
2. **Build Pack:** `Dockerfile`. **Port:** `80`.
3. **Environment Variables:**

   | Name | Value | Where to find it |
   |---|---|---|
   | `SUPABASE_URL` | e.g. `https://supabase.kingsolomon.tech` | The address you open Supabase Studio at, or `SUPABASE_PUBLIC_URL` / `API_EXTERNAL_URL` in your Supabase service's env vars |
   | `SUPABASE_ANON_KEY` | a long `eyJ...` string | `SERVICE_SUPABASEANON_KEY` (or `ANON_KEY`) in your Supabase service's env vars |
   | `TELEGRAM_ID` | digits only | Message @userinfobot on Telegram. It's the same number as on the bot's trigger. |

   None of these are secret: the anon key is designed to be public, and the database's access rules protect your data. **Never** use the `service_role` key here.
4. **Domain:** `https://hub.kingsolomon.tech`. Wildcard DNS already covers it.
5. Deploy, open the page and log in. The first login links your account to your Telegram chat automatically. The header should then show your XP and streak.

If a variable is missing or malformed, the container stops and Coolify's logs say which one.

To update the page later, push to the repo and redeploy.

## Learn tab

- **Daily Starter:** today's due cards, oldest first, up to 10. Your first answer to each card is graded with the same rule as the bot. Missed cards come back until you get them right, but only the first answer changes the schedule. One random mini-game finishes the day: +10 XP and today counts for your streak.
- **Mini-games:** Match pairs (2 XP a pair), Fill the blank (3 XP each) and Speed round (1 XP per right answer). They use any of your cards and never change when a card comes back.
- With no linked Telegram chat there are no cards, so the Starter goes straight to a game that says there aren't enough cards yet.

## If something's off

- **"Your login isn't linked" banner:** check `TELEGRAM_ID`, then restart. A Telegram chat can only be linked to one login.
- **The bot says "Already answered" to every button:** n8n's Postgres credential may use a user other than `postgres`. Grant it the grading function:
  ```sql
  GRANT EXECUTE ON FUNCTION lc_grade(int, int, bigint) TO <that user>;
  ```

## Re-running the self-check

```bash
npm i @electric-sql/pglite@0.2.17
```

```bash
node sql/test-001.mjs sql/001_hub.sql sql/002_learn.sql
```

```bash
node tests/text.test.mjs
```
