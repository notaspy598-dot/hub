# Hub

A static page with Learn and Style tabs. Supabase holds the login, data and images, and n8n does the AI work. Nothing runs on the server except nginx serving these files.

| Path | What it is |
|---|---|
| `public/` | The site. The only file you edit is `config.js`. |
| `sql/001_hub.sql` | Phase 1 database setup. Safe to run again. |
| `sql/test-001.mjs` | A self-check that runs the SQL against an in-memory Postgres with Supabase's auth and storage stubbed in. |

## Setup (once)

1. **Close sign-ups.** In Coolify, open your Supabase service → Environment Variables → set `DISABLE_SIGNUP` to `true` → Restart. Otherwise anyone who finds the page could create an account and upload images into their own folder.
2. **Create your login.** In Supabase Studio → Authentication → Users → Add user → enter an email and password, and tick *Auto Confirm User*.
3. **Run the database setup.** In Studio → SQL Editor, paste all of `sql/001_hub.sql` and click Run. It should end with `Hub phase 1 ready`.
4. **Link your login to your Telegram bot.** Your Telegram ID comes from @userinfobot (it's the same number you put on the bot's trigger).
   ```sql
   INSERT INTO lc_profile (chat_id, user_id)
   VALUES (YOUR_TELEGRAM_ID, (SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL'))
   ON CONFLICT (chat_id) DO UPDATE SET user_id = EXCLUDED.user_id;
   ```
5. **Point the page at Supabase.** In `public/config.js`, fill in your Supabase URL and anon key (Studio → Project Settings → API).

## Deploy

1. Push this folder to a new **public** GitHub repo, for example `hub`. Nothing in it is secret.
2. In Coolify: **New Resource → Public Repository**, then paste the repo URL.
3. Set **Build Pack: Static** and **Base Directory: `/public`**.
4. Set the domain to `https://hub.kingsolomon.tech`. Wildcard DNS already covers it.
5. Deploy, open the page and log in. The header should show your XP and streak, and Learn should show how many cards are due.

To update the page later, push to the repo and redeploy.

## If something's off

- **"Your login isn't linked" banner:** step 4 didn't match. Check the email and Telegram ID.
- **The bot says "Already answered" to every button:** n8n's Postgres credential may use a user other than `postgres`. Grant it the grading function:
  ```sql
  GRANT EXECUTE ON FUNCTION lc_grade(int, int, bigint) TO <that user>;
  ```

## Re-running the self-check

```bash
npm i @electric-sql/pglite@0.2.17
```

```bash
node sql/test-001.mjs sql/001_hub.sql
```
