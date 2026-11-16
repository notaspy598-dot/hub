---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: ["public/style.css","public/learn.js","public/links.js"]
---

# Hub app shell (login, Learn, Style)

Scope: the whole Hub PWA in public/ (login, header, Learn home, Daily Starter and practice game screens, links, skills, Style tab). Mode: Operate. Mobile-first, installed on phones, a few minutes a day; a few invited users, so empty states matter.

Must keep: every element id and data-* hook the scripts use, live regions, keyboard focus, the learn-before-quiz flow and grading rules.

## Direction contract

THESIS: Every review is a note you hit. The app is a rhythm game's stage: answers sit in four coloured lanes, every hit gets a judgement, and a finished day gets a graded results screen. It refuses the category default of a white page with one green button and a lesson path.

OWN-WORLD: Deep indigo stage (#1d1647), darker HUD strip, raised indigo panels; four lane colours (coral #ff5a36, gold #ffc42e, mint #2fd3a4, blue #4d7cff) that only ever mean a lane, a game, or a judgement; Unbounded (self-hosted) for numerals, judgements and headings, system UI for reading; chunky press-down buttons from Duolingo.

STORY: Open the app, see today's track (cards due) and the streak at a glance, press Start, learn the key ideas, hit each card, read the judgement in the answer sheet, finish with a grade and stat tiles. Practice and links are optional and below.

FIRST VIEWPORT: Phone: HUD (wordmark, streak, XP, due as compact counters, log out), Learn/Style pill tabs, then the Daily Starter as a full-width coral panel whose heading is "Daily Starter", a segmented lane track of today's cards and the Start button; the practice track list begins below the fold line. Desktop: same HUD, two columns, Starter and practice left, add-a-link and skills right.

FORM: Rhythm-game results grammar (Taiko no Tatsujin, DJMAX Respect, Rift of the NecroDancer) plus Duolingo's lesson flow (top progress track, green/red answer sheet with one Continue, press-down buttons, stat tiles on completion); position 3 of 7 on the grounded list; seed:d40165e2b5aff69a. Signature interaction: the answer sheet slides up carrying a judgement stamp (PERFECT, GOOD, MISS) in its lane colour. Raises: cleared cards stay in the track as filled segments (ticket wallet); skills as ranked whole cells (character catalog); judgement always word plus shape, never colour alone (centre rail); three type sizes, rank by weight and case (timetable).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
