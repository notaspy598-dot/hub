# Hub

A static learning page. Supabase holds the login and data, and n8n does the AI work. On the server it's one tiny nginx container that uses a few MB of RAM.

It needs no Telegram: you add links in the app, and it installs on your phone's home screen like an app (see *Install on your phone*).

| Path | What it is |
|---|---|
| `public/` | The site, including the app manifest, icons and `sw.js` (the service worker that makes it installable). |
| `Dockerfile`, `write-config.sh` | The container: nginx serves `public/`, and at every start it writes `config.js` from the env vars below. |
| `sql/001_hub.sql` | Phase 1 database setup. Safe to run again. |
| `sql/002_learn.sql` | Phase 2: XP for the Daily Starter and mini-games. Safe to run again. |
| `sql/003_web.sql` | Works without Telegram (your own learner profile, adding links from the app). Safe to run again. |
| `sql/004_lessons.sql` | Key ideas per link, shown before its cards are quizzed. Safe to run again. |
| `sql/005_lesson_on_demand.sql` | OpenMAIC lessons only when you tap *Build lesson*, at most 10 a day. Safe to run again. |
| `sql/006_reminders.sql` | Opt-in daily reminders (Web Push): who wants one, at what hour, and who is due one. Safe to run again. |
| `sql/007_streak_freeze.sql` | Streak freezes: a missed day uses one instead of ending the streak (start with 1, earn 1 every 7 days, hold 2). Run it again if you ever re-run 001 or 002. Safe to run again. |
| `sql/008_engage.sql` | Reasons to come back: the weekly league, challenges, quests and recap, "Did you use it?", Go deeper and playlists. Needs 006 run first. Safe to run again. |
| `sql/009_complete.sql` | Flag a wrong card, archive a link, the daily goal, the activity grid, trophies and the "How Hub works" starter deck. Run after 008. Safe to run again. |
| `sql/010_local_own_ask.sql` | Days in each learner's own time zone, your own notes, photos and PDFs, *Ask about this*, and the *Coming up* forecast. Run after 009. Safe to run again. |
| `sql/test-001.mjs` | A self-check that runs the SQL against an in-memory Postgres with Supabase's auth and storage stubbed in. |
| `sql/test-006.mjs` | The same kind of self-check for the reminders. |
| `supabase/functions/remind/` | The Edge Function that sends the reminders, called once an hour. |
| `scripts/vapid-keys.mjs` | Makes the key pair Web Push needs. |
| `tests/text.test.mjs` | A self-check for the typo-tolerant answer matching in Fill the blank. |

## Setup (once)

1. **Close sign-ups.** In Coolify, open your Supabase service → Environment Variables → set `DISABLE_SIGNUP` to `true` → Restart. Otherwise anyone who finds the page could create an account and upload images.
2. **Create your login.** In Supabase Studio → Authentication → Users → Add user → enter an email and password, and tick *Auto Confirm User*.
3. **Run the database setup.** In Studio → SQL Editor, paste all of `sql/001_hub.sql` and click Run. It should end with `Hub phase 1 ready`. Then do the same with `sql/002_learn.sql` (ends with `Hub phase 2 ready`), `sql/003_web.sql` (ends with `Hub web setup ready`) `sql/004_lessons.sql` (ends with `Hub lessons setup ready`) `sql/005_lesson_on_demand.sql` (ends with `Hub lesson-on-demand setup ready`) `sql/007_streak_freeze.sql` (ends with `Hub streak freeze ready`) and, once the reminders' `sql/006_reminders.sql` is in, `sql/008_engage.sql` (ends with `Hub engage ready`). Until 008 is run, the This week panel and the "Did you use it?" card stay hidden. Run 007 before deploying a page that shows streak freezes, or the header reads 0. Then run `sql/009_complete.sql` (ends with `Hub complete ready`) **before** deploying this version of the page: the header, the link list and the daily goal read its new columns, so without it they come up empty. If you ever re-run 001 or 008, run 009 again after. Then run `sql/010_local_own_ask.sql` (ends with `Hub local days, own material and ask ready`); if you ever re-run 007, 008 or 009, run 010 again after. Until it's run, *Coming up* and *Ask about this* stay hidden and days stay in UTC.
4. **Turn on the n8n workflow "Learning Coach: Web Links".** It turns links, notes and photos you add in the app into key ideas and cards, answers *Ask about this* questions, and builds a lesson when you ask for one, with no Telegram involved. Open it in n8n and:
   - Pick credentials on the HTTP nodes: your Apify one on **Get Video Transcript** and **Get Instagram Post**, "OpenRouter account" on **Read Slides** and **Tutor Model (OpenRouter)**, and "OpenMAIC access code" on **OpenMAIC Login**.
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
   | `VAPID_PUBLIC_KEY` | optional | Only for daily reminders: the public key from `node scripts/vapid-keys.mjs` (see *Daily reminders*). Empty hides the reminder panel. |

   None of these are secret: the anon key is designed to be public, and the database's access rules protect your data. **Never** use the `service_role` key here.
4. **Domain:** `https://hub.kingsolomon.tech`. Wildcard DNS already covers it.
5. Deploy, open the page and log in. The first login creates your learner profile (or, with `TELEGRAM_ID`, picks up your bot chat's cards). The header should then show your XP and streak.

### Adding friends

Sign-ups stay closed, so you create each account:

1. In Supabase Studio → Authentication → Users → Add user → their email and a temporary password, and tick *Auto Confirm User*.
2. Send them the page link and the temporary password, ideally in different messages.
3. They log in and set their own password under *Your password* on the Learn page. Their first login gives them their own empty learner profile; nobody sees anyone else's cards, links or XP.

To remove someone, delete them in Studio → Authentication → Users. That ends their login; their cards stay in the database, unlinked from any account.

If a variable is missing or malformed, the container stops and Coolify's logs say which one.

To update the page later, push to the repo and redeploy.

## Install on your phone

- **iPhone (Safari):** open the page, tap Share → *Add to Home Screen*.
- **Android (Chrome):** open the page, tap ⋮ → *Install app* (or *Add to Home screen*). Once installed, Hub also shows up in the share sheet: share a video or article from Instagram, TikTok, YouTube or the browser to Hub, and the link is filled in for you to tap **Add**.

It opens full screen with its own icon and stays logged in. Each time it opens with a connection it keeps today's track on the phone, so the Daily Starter also plays offline (on the subway, say); the answers sync as soon as you're back online, and only then do the XP and streak update. Everything else needs a connection.

## Sound, haptics and reminders

- **Sound:** every answer plays a short chime (Perfect, Good and Miss are variations of one sound), Speed round's chime climbs with your combo and every 5 in a row gets a flourish, and finishing the Daily Starter plays a fanfare. They're made in the browser, so there are no sound files. The speaker button next to the X in a run mutes them, and the phone remembers. On iPhone, sound starts after your first tap and follows the ring/silent switch.
- **Haptics:** Android phones vibrate on each answer. iPhones have no vibration API for web apps, so Hub uses the one thing Safari offers: a light haptic tick (iOS 18 or later), one tick per answer.
- **App icon badge:** the number of cards due shows on Hub's home-screen icon (Android; on iPhone once reminders are allowed).

### Daily reminders (optional, off for everyone until they turn it on)

One notification a day at the hour each person picks, only if they haven't played that day and cards are due. The wording rotates and never guilt-trips. After 5 reminders in a row with no round after them, a last one says reminders are pausing, and none go out until the person turns them back on.

On iPhone this works only with Hub added to the Home Screen and opened from there (iOS 16.4 or later); in a Safari tab the panel explains that. On Android it works in Chrome, installed or not.

Setup, once:

1. **Keys:** on your computer, in the `hub` folder, run `node scripts/vapid-keys.mjs` and keep both lines somewhere safe. The private key is secret: it only ever goes to the server in step 3.
2. **Hub app:** in Coolify, add `VAPID_PUBLIC_KEY` (the public key, without the `VAPID_PUBLIC_KEY=` part) to Hub's environment variables and redeploy. The *Daily reminder* panel appears on the Learn page.
3. **Server (one script):** from the `hub` folder on your computer, copy three files to the server and run the script there. Type these two lines in a terminal on your computer (PowerShell works), not in an SSH session that is already logged in to the server, and don't paste the script's contents into a terminal. Use the address you SSH into the Coolify server with:
   ```bash
   scp scripts/setup-reminders.sh sql/006_reminders.sql supabase/functions/remind/index.ts root@YOUR_SERVER_IP:
   ssh -t root@YOUR_SERVER_IP "bash setup-reminders.sh"
   ```
   It runs the reminders SQL, installs the `remind` Edge Function into Supabase with your keys next to it (in `remind/keys.json`, on the server only), restarts the functions container and tests it. Paste the two keys and an email when it asks. It ends by printing the function's URL and a `REMIND_SECRET`: keep both for step 4. It's safe to run again and keeps the same secret. Run it again whenever `index.ts` changes (the weekly recap came with `sql/008_engage.sql`).
   If you'd rather do it by hand: run `sql/006_reminders.sql` in Studio, put `index.ts` in Supabase's functions folder as `remind/index.ts`, and give the functions container `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` plus an email) and `REMIND_SECRET` as environment variables or in a `keys.json` next to it.
4. **Hourly call:** the n8n workflow **Hub: Daily Reminders** runs every hour and `POST`s to the URL from step 3. Open it, click **Send Due Reminders**, and under *Credential* create a new **Header Auth** credential: *Name* `x-remind-secret`, *Value* the `REMIND_SECRET` from step 3. Save, then **Publish**. Each run answers with how many reminders were sent (`{"sent":0,...}` just means nobody was due that hour).
5. **On each phone:** open Hub (on iPhone, from the Home Screen icon), find *Daily reminder* on the Learn page, pick a time and tap **Turn on**, then **Allow**.

## Learn tab

- **Your own material:** under *Add a link*, open *Or add your own* and paste notes, pick photos of pages or slides (up to 10), or pick a PDF. Photos are shrunk on the phone, stored in the private `hub-uploads` bucket (each person's own folder) and read by the same AI as carousels. A PDF's text is read on the phone with pdf.js, so only text leaves it; a scanned PDF has no text, so photograph its pages instead. Either way it becomes key ideas and cards like a link. They don't count as "links added" for quests and trophies.
- **Ask about this:** under a link's *Key ideas* (Today or History), ask a question and an AI tutor answers from that link's text and key ideas, saying when it goes beyond them. It remembers the last few questions on that link, so follow-ups work. 30 questions a day.
- **Add a link:** a video (YouTube, TikTok, Instagram, Facebook), an Instagram carousel or photo post, or an article. n8n reads it, then writes a short lesson of 3 to 8 **key ideas** and 5 to 15 review cards (about 2 per idea, so denser topics get more) that test only those ideas. For a carousel, Apify fetches the post and an AI model (Gemini Flash Lite on OpenRouter) reads the text on up to 10 slides, plus the caption. The key ideas and cards are ready within a minute or two; tap *Key ideas* under the link to read them. Lessons are on demand: tap *Build lesson* under a link and OpenMAIC builds a deeper lesson around its key ideas (at most 10 a day, since each one is a paid run). *Open lesson* appears as soon as its first parts are built, with a note on how many are ready, and the rest keeps filling in. If a lesson fails, *Try the lesson again* shows instead. If something fails, the reason shows under the link. **Archive** under a link takes it off the list and stops its cards coming back (Undo right after, or *Restore* in History, makes them due again).
- **Skills:** per skill, how far toward mastery you are (each correct Starter answer moves a card one of its 4 steps, so it grows every day), cards mastered and due, and its level: Novice, Learner (25% mastered), Solid (50%) or Expert (75%). The Day done screen shows each skill's progress today and says when one levels up. **Go deeper** on a skill asks the AI for a new set of key ideas and cards that build on what you already have there, with no link needed (3 a day).
- **Playlists:** add a public or unlisted YouTube playlist link and its videos queue up; one joins your links each day you open Hub. Only the first 15 videos are read, and Watch Later can't be imported (YouTube keeps it private).
- **This week:** your XP, days, cards mastered and ideas used since Monday (your time), three quests that change every week (claim each for bonus XP), and the league: pick a name to join, and only people with a name are shown, with their XP this week. After a Speed round you can challenge someone in the league to the same cards; they get 60 seconds to beat your score. With reminders on, a recap of your week arrives on Sunday at your reminder hour.
- **Flag a card:** every answer sheet has *Flag this card as wrong*. A flagged card never comes back and leaves your skills; it stays in the database (`lc_cards.hidden = 'flagged'`) so you can look at what the AI got wrong.
- **Your data:** under Account, *Cards for Anki* downloads a file Anki imports (File → Import; question and options on the front, answer and explanation on the back, the skill as a tag), and *Full backup* downloads every link, key idea and card as JSON. Flagged and archived cards are left out.
- **History:** search every key idea and card you have; every word you type must match. *Share as image* on a key idea (there, under a link, or while studying) makes a picture of it for the phone's share sheet, or downloads it on a computer.
- **Progress:** the last 12 weeks as a grid (darker is more XP that day, in your days like the streak), *Coming up*: how many cards come due each of the next 7 days, so a heavy day shows before it arrives and trophies with Bronze, Silver and Gold tiers for best streak, cards mastered, Expert skills, links added, ideas used, challenges won and XP. A new tier gets a celebration the next time you open Progress.
- **First run:** someone with no links at all gets *How Hub works*, 7 key ideas and 8 cards on how Hub teaches, so day one has a track to play.
- **Did you use it?** A day after you study a link's key ideas, a card asks about one of them: have you put it to use? Yes is +5 XP and counts toward the "use ideas" quest. One a day.

- **Daily Starter:** today's due cards, oldest first, up to your daily goal (5, 10 or 20, set under Account; 10 to start), shuffled so topics mix. The first time a link's cards come up, you read its key ideas before you're quizzed on them. Each question shows on its own first: think of the answer, tap *I know it* or *Not sure*, then pick from the options. Cards you know well (box 4 and up, with a short answer) ask you to type the answer instead, typos allowed as in Fill the blank. Your first answer to each card is graded with the same rule as the bot. Missed cards come back until you get them right, and a right answer you weren't sure of comes back once more, but only the first answer changes the schedule. Finishing the cards finishes the day: +10 XP and today counts for your streak. Practice afterwards is optional.
- **Practice:** Weak spots (up to 8 cards you missed last time or that are still in the first boxes, until each is right; 2 XP each), Match pairs (2 XP a pair), Fill the blank (3 XP each) and Speed round (1 XP per right answer). They never change when a card comes back.
- With no cards due, the Starter offers practice instead, and finishing one counts today for your streak.

Why it works this way (from the learning research, mainly Dunlosky et al. 2013, *Improving Students' Learning With Effective Learning Techniques*):

| What the app does | The finding |
|---|---|
| Teaches a link's key ideas once, then quizzes | Practice testing is one of the two most effective study techniques; rereading barely helps, so the ideas are shown once and recalled after that. |
| Brings cards back after 1, 2, 4, 8, 16, 32 days | Spaced practice beats cramming, and the gap should grow as the card sticks. |
| Asks you to recall the answer before showing options, and to type it once you know a card well | Producing an answer from memory strengthens it more than recognising it in a list. |
| Repeats missed cards until they're right, then spaces them | Successive relearning: retrieve to a right answer every session, across spaced sessions. |
| Mixes topics in a session | Interleaving helps you tell similar ideas apart. |
| Asks how sure you are, and flags confident mistakes | Mistakes made with high confidence are the most likely to be corrected after feedback (the hypercorrection effect). Lucky guesses get one more go. |
| After a miss, asks you to explain the answer in your own words | Self-explanation helps the answer make sense, not just stick. |
| Weak spots drill | Deliberate practice: spend extra time where you're weakest. |

## Local days

Since `sql/010`, a day ends at midnight where each person is, not at midnight UTC: the streak, the daily Starter, the activity grid, the week, quests and "Did you use it?" all follow it. The page saves the phone's time zone on every load, and `sql/010` tells Supabase's API (PostgREST) to run `lc_local_time` before each request, which switches that request to the person's time zone. Nothing else needs changing.

If the page says **"Days still end at midnight UTC"**, PostgREST isn't running that step. Either its in-database config is off (`PGRST_DB_CONFIG=false` on the rest container), or it already has a `db_pre_request` of its own (010 then prints a warning and leaves it alone). Fix it with one of these, then restart the Supabase rest container: set `PGRST_DB_PRE_REQUEST=public.lc_local_time` on it, or add `PERFORM public.lc_local_time();` to the existing pre-request function.

The bot, n8n and the reminders don't go through it: reminders already use each person's time zone, and the bot is retired.

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
node sql/test-001.mjs sql/001_hub.sql sql/002_learn.sql sql/003_web.sql sql/004_lessons.sql sql/005_lesson_on_demand.sql sql/006_reminders.sql sql/007_streak_freeze.sql sql/008_engage.sql sql/009_complete.sql sql/010_local_own_ask.sql
```

```bash
node sql/test-006.mjs
```

```bash
node tests/text.test.mjs
```

## The Telegram bot

The app no longer needs it. Once you've added a link in the app and seen it work, you can deactivate the "Learning Coach: Telegram Bot" and "Learning Coach: Daily Review" workflows in n8n. Your cards, XP and streak stay.
