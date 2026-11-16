# Hub

A static page with Learn and Style tabs. Supabase holds the login, data and images, and n8n does the AI work. On the server it's one tiny nginx container that uses a few MB of RAM.

It needs no Telegram: you add links in the app, and it installs on your phone's home screen like an app (see *Install on your phone*).

| Path | What it is |
|---|---|
| `public/` | The site, including the app manifest, icons and `sw.js` (the service worker that makes it installable). |
| `Dockerfile`, `write-config.sh` | The container: nginx serves `public/`, and at every start it writes `config.js` from the env vars below. |
| `sql/001_hub.sql` | Phase 1 database setup. Safe to run again. |
| `sql/002_learn.sql` | Phase 2: XP for the Daily Starter and mini-games. Safe to run again. |
| `sql/003_web.sql` | Works without Telegram (your own learner profile, adding links from the app). Safe to run again. |
| `sql/test-001.mjs` | A self-check that runs the SQL against an in-memory Postgres with Supabase's auth and storage stubbed in. |
| `tests/text.test.mjs` | A self-check for the typo-tolerant answer matching in Fill the blank. |

## Setup (once)

1. **Close sign-ups.** In Coolify, open your Supabase service → Environment Variables → set `DISABLE_SIGNUP` to `true` → Restart. Otherwise anyone who finds the page could create an account and upload images.
2. **Create your login.** In Supabase Studio → Authentication → Users → Add user → enter an email and password, and tick *Auto Confirm User*.
3. **Run the database setup.** In Studio → SQL Editor, paste all of `sql/001_hub.sql` and click Run. It should end with `Hub phase 1 ready`. Then do the same with `sql/002_learn.sql` (ends with `Hub phase 2 ready`) and `sql/003_web.sql` (ends with `Hub web setup ready`).
4. **Turn on the n8n workflow "Learning Coach: Web Links".** It turns links you add in the app into cards and a lesson, with no Telegram involved. Open it in n8n and:
   - Pick credentials on the HTTP nodes: your Apify one on **Get Video Transcript** and **Get Instagram Post**, "OpenRouter account" on **Read Slides**, and "OpenMAIC access code" on **OpenMAIC Login**.
   - Check the Postgres nodes use the same credential as the Telegram bot's (they're set to "Postgres account").
   - Click **Publish**. Its address is `https://n8n.kingsolomon.tech/webhook/learn-link`.

## Deploy in Coolify

1. **New Resource → Public Repository** → `https://github.com/notaspy598-dot/hub`.
2. **Build Pack:** `Dockerfile`. **Port:** `80`.
3. **Environment Variables:**

   | Name | Value | Where to find it |
   |---|---|---|
   | `SUPABASE_URL` | e.g. `https://supabase.kingsolomon.tech` | The address you open Supabase Studio at, or `SUPABASE_PUBLIC_URL` / `API_EXTERNAL_URL` in your Supabase service's env vars |
   | `SUPABASE_ANON_KEY` | a long `eyJ...` string | `SERVICE_SUPABASEANON_KEY` (or `ANON_KEY`) in your Supabase service's env vars |
   | `LINK_WEBHOOK` | `https://n8n.kingsolomon.tech/webhook/learn-link` | The production URL of the "Link Added in App" node in n8n |
   | `TELEGRAM_ID` | optional, digits only | Only to keep the cards your old Telegram bot chat made. Leave it empty to start fresh. |

   None of these are secret: the anon key is designed to be public, and the database's access rules protect your data. **Never** use the `service_role` key here.
4. **Domain:** `https://hub.kingsolomon.tech`. Wildcard DNS already covers it.
5. Deploy, open the page and log in. The first login creates your learner profile (or, with `TELEGRAM_ID`, picks up your bot chat's cards). The header should then show your XP and streak.

If a variable is missing or malformed, the container stops and Coolify's logs say which one.

To update the page later, push to the repo and redeploy.

## Install on your phone

- **iPhone (Safari):** open the page, tap Share → *Add to Home Screen*.
- **Android (Chrome):** open the page, tap ⋮ → *Install app* (or *Add to Home screen*). Once installed, Hub also shows up in the share sheet: share a video or article from Instagram, TikTok, YouTube or the browser to Hub, and the link is filled in for you to tap **Add**.

It opens full screen with its own icon and stays logged in. It needs a connection to load cards.

## Learn tab

- **Add a link:** a video (YouTube, TikTok, Instagram, Facebook), an Instagram carousel or photo post, or an article. n8n reads it, writes 5 review cards and starts an interactive lesson. For a carousel, Apify fetches the post and an AI model (Gemini Flash Lite on OpenRouter) reads the text on up to 10 slides, plus the caption. The list shows each link's progress; the cards are ready to play within a minute or two, and *Open lesson* appears when the lesson is built (5 to 15 minutes). If something fails, the reason shows under the link.
- **Skills:** cards mastered and due per skill (what the bot's `/stats` showed).

- **Daily Starter:** today's due cards, oldest first, up to 10. Your first answer to each card is graded with the same rule as the bot. Missed cards come back until you get them right, but only the first answer changes the schedule. One random mini-game finishes the day: +10 XP and today counts for your streak.
- **Mini-games:** Match pairs (2 XP a pair), Fill the blank (3 XP each) and Speed round (1 XP per right answer). They use any of your cards and never change when a card comes back.
- With no cards yet, the Starter goes straight to a game that says there aren't enough cards yet.

## If something's off

- **"Couldn't set up your profile" banner:** run `sql/003_web.sql`, then reload.
- **Links stay on "Waiting to start…":** check `LINK_WEBHOOK` and that the n8n workflow is published.
- **Every video link says "Authorization failed - please check your credentials":** the Apify API token in n8n is invalid or expired. Paste a fresh one from Apify (Settings → API & Integrations) into n8n's "Apify account" credential. This is also why the Telegram bot replied "I couldn't get enough text" to every video.
- **The bot says "Already answered" to every button:** n8n's Postgres credential may use a user other than `postgres`. Grant it the grading function:
  ```sql
  GRANT EXECUTE ON FUNCTION lc_grade(int, int, bigint) TO <that user>;
  ```

## Re-running the self-check

```bash
npm i @electric-sql/pglite@0.2.17
```

```bash
node sql/test-001.mjs sql/001_hub.sql sql/002_learn.sql sql/003_web.sql
```

```bash
node tests/text.test.mjs
```

## The Telegram bot

The app no longer needs it. Once you've added a link in the app and seen it work, you can deactivate the "Learning Coach: Telegram Bot" and "Learning Coach: Daily Review" workflows in n8n. Your cards, XP and streak stay.
