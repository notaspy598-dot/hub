# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
The owner plus a few invited people (sign-ups are closed; accounts are created by hand in Supabase). They use Hub mostly on a phone, installed to the home screen, for a few minutes a day: clear the Daily Starter to keep the streak, add links they want to learn from, and optionally play practice games. Because others log in too, first-run and empty states matter (no links yet, no cards due, no skills yet).

## Product Purpose
Turn saved links (YouTube, TikTok, Instagram, Facebook videos, Instagram carousels, articles) into short lessons of key ideas and spaced-repetition review cards, then make reviewing them a daily habit. Success is a kept streak and cards moving up to mastered.

## Positioning
Learning from your own saved feed: every card comes from a link the person chose, the key ideas are taught before the quiz, recall comes before the options appear, and missed cards come back until they are right.

## Operating Context
Static PWA (`public/`) served by nginx; Supabase for login, data and storage; n8n turns links into key ideas and cards; OpenMAIC builds a full lesson only when you tap Build lesson. Android share sheet can send a link straight into the Add form. Works offline for the shell and today's Daily Starter (saved on the phone, synced when back online); everything else needs a connection.

## Capabilities and Constraints
- Learn: Daily Starter (up to 10 due cards, study key ideas first, "I know it" / "Not sure" before options, flip reveal), practice games (Weak spots, Match pairs, Fill the blank, Speed round), Add a link with live status, Skills mastered/due.
- Flag a wrong card, archive a link, a daily goal (5, 10 or 20), typed answers for well-known cards, search, share a key idea as an image, a 12-week activity grid, trophies and a starter deck for new people (sql/009).
- XP shop (sql/011): the header's XP is what you can spend (streak freezes, double or nothing, extra Speed round time, extra Go deeper rounds, themes, league titles); lifetime XP still drives the league and trophies. The day's first play gives 2× practice XP for 15 minutes; Expert skills offer a no-mistakes Legendary run. A one-time intro and small "Not now"-able cards offer a buy when it helps (no freeze on a 3+ day streak, a bet after Day done, extra time before a Speed round, a round past the Go deeper limit, Legendary when a skill hits Expert, the first time you can afford a title or theme).
- Header shows streak, XP and cards due. One page: Learn, with Today, Progress and History tabs.
- Plain HTML/CSS/vanilla JS modules, no build step. Keep element ids and JS hooks the scripts depend on.

## Brand Commitments
Name: Hub. Gamified (streak, XP, mini-games) is intended. Visual references: patterns borrowed from real game UIs, translated into Hub's own look, never copying game art or logos.

## Evidence on Hand
No testimonials, metrics or screenshots. Icons in `public/icon-*.png` and `icon.svg` (orange "H").

## Product Principles
1. Learn before you're tested.
2. Daily habit first; everything else is optional.
3. Fast on a phone: one thumb, short sessions.
4. Honest progress: numbers come from the database, never invented.

## Accessibility & Inclusion
Keyboard focus and screen-reader live regions already exist; keep them. Respect reduced motion.
