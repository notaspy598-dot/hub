---
name: Hub
description: A rhythm game's stage for daily spaced-repetition review of your own saved links.
colors:
  stage: "#1d1647"
  hud: "#150f38"
  panel: "#251d5a"
  panel-up: "#2f2670"
  line: "#3b3185"
  ink: "#f8f4ff"
  ink-2: "#c4bcef"
  ink-dark: "#150f38"
  coral: "#ff5a36"
  gold: "#ffc42e"
  mint: "#2fd3a4"
  blue: "#4d7cff"
  coral-deep: "#b8331a"
  gold-deep: "#b5850a"
  mint-deep: "#138a69"
  blue-deep: "#2f4fc0"
typography:
  display:
    fontFamily: "Unbounded, system-ui, sans-serif"
    fontSize: "clamp(3rem, 18vw, 5rem)"
    fontWeight: 800
    lineHeight: 0.85
    fontFeature: "tnum"
  headline:
    fontFamily: "Unbounded, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1.2rem + 1.4vw, 2rem)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "0.01em"
  judgement:
    fontFamily: "Unbounded, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1.2rem + 1.4vw, 2rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.04em"
  title:
    fontFamily: "Unbounded, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.01em"
  prompt:
    fontFamily: "system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1.2rem + 1.4vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "10px"
  md: "14px"
  lg: "20px"
  grade: "28px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "0.7rem 1.25rem"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.panel-up}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "0.7rem 1.25rem"
    height: "48px"
  button-dark:
    backgroundColor: "{colors.ink-dark}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "0.7rem 1.25rem"
    height: "48px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    height: "48px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "12px"
    size: "44px"
  input:
    backgroundColor: "{colors.hud}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.7rem 0.85rem"
    height: "48px"
  stat:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.3rem 0.55rem"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  game-row:
    backgroundColor: "{colors.panel-up}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.6rem 0.75rem"
    height: "60px"
  option:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.65rem 0.8rem"
    height: "60px"
  sheet-perfect:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.lg}"
  sheet-good:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.lg}"
  sheet-miss:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.lg}"
  grade:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.grade}"
    size: "8.5rem"
---

# Design System: Hub

## Overview

**Creative North Star: "The Rhythm Stage"**

Every review is a note you hit. Hub is a rhythm game's stage at night: a deep indigo floor, a darker HUD strip pinned to the top, raised indigo panels, and four lane colours that light up only when something is being played or judged. Answers sit in lanes, every hit gets a stamped judgement, and a finished day gets a grade.

The density is phone-first and thumb-sized: 48px buttons, 60px game and answer rows, one column under 860px, two above. Reading text stays in the system face; Unbounded carries numerals, headings, buttons and judgements, so the game voice and the reading voice never blur. Pressable things are chunky and physical: a solid bottom edge is the key travel, and it drops to zero on press.

The world borrows grammar from real rhythm-game results screens and Duolingo's lesson flow (top progress track, slide-up answer sheet, press-down buttons, stat tiles), translated into Hub's own indigo-and-lanes look, never copying game art.

**Key Characteristics:**
- Dark indigo tonal layers (stage, HUD, panel, panel-up) instead of soft shadows.
- Four lane colours with one meaning each: a lane, a game, a judgement, a grade.
- Unbounded for numbers and the game voice; system UI for reading.
- Press-down buttons with a solid bottom edge that travels on press.
- Judgements are always word + icon + colour, stamped in.

## Colors

A night-stage palette: four indigo layers and two inks, with four saturated lane colours that are rare on purpose.

### Primary
- **Ink** (`ink`): primary actions (the ink button), focus rings, meter fills, ready pips. Ink, not a lane colour, is the action colour.

### Secondary (the four lanes)
- **Coral Lane** (`coral`, edge `coral-deep`): the Daily Starter panel, the first answer lane, the Weak spots game, the Miss judgement, the C grade.
- **Gold Lane** (`gold`, edge `gold-deep`): the second lane, Match pairs, the Good judgement, the A/B grade and default skill rank.
- **Mint Lane** (`mint`, edge `mint-deep`): the third lane, Fill the blank, the Perfect judgement, the S grade.
- **Blue Lane** (`blue`, edge `blue-deep`): the fourth lane and the Speed round.

Each lane has a `-deep` partner used only as the solid bottom edge or inset edge under that lane's face.

### Neutral
- **Stage Indigo** (`stage`): page background; also the inset well inside stat tiles.
- **HUD Indigo** (`hud`): the sticky top strip, the login screen, input wells, link and skill cells, and the default bottom edge of indigo buttons.
- **Panel Indigo** (`panel`): section panels, answer options, stat chips.
- **Raised Indigo** (`panel-up`): secondary buttons and game rows.
- **Line Indigo** (`line`): 2px borders, dividers, empty track segments, meter tracks, dashed empty states.
- **Soft Ink** (`ink-2`): secondary text, icons at rest, small labels.
- **Dark Ink** (`ink-dark`): text on ink and on any lane colour; the Start button face on the coral Starter.

### Named Rules
**The Lane Meaning Rule.** Coral, gold, mint and blue only ever mean an answer lane, a game, a judgement (Perfect mint, Good gold, Miss coral) or a grade. Never use one for decoration, a primary action, or a generic status.

**The Ink Action Rule.** Primary buttons are ink with dark-ink text; secondary buttons are raised indigo. On a lane-coloured surface (the Starter) the action is the dark button.

## Typography

**Display Font:** Unbounded (self-hosted variable woff2, 200-900, OFL), falling back to system-ui
**Body Font:** system-ui (-apple-system, Segoe UI, Roboto)

**Character:** A wide, heavy geometric display face for the game voice (scores, grades, judgements, headings, buttons) against the plain system face for anything you read. Numerals in Unbounded are tabular.

### Hierarchy
The ramp is three sizes (label 13px, body 16px, large clamp 24-32px); rank comes from weight, face and case rather than more sizes. Big numerals are the only exception.
- **Display**: the Starter's due count, the results grade (900, 5rem). Numbers only.
- **Headline**: the Starter heading and results heading.
- **Judgement**: PERFECT / GOOD / MISS in the answer sheet; uppercase, oblique 8deg, stamped in. The HUD pop uses the same treatment at label size.
- **Title**: panel headings (h2) and every button label.
- **Prompt**: the card question on a run screen, in the system face at the large size so it reads as text, not as game chrome.
- **Body**: descriptions, key ideas, link details; 52ch max where it runs long.
- **Label**: stat units, row subtitles, statuses, errors. Uppercase with 0.06em tracking only inside stat tiles.

### Named Rules
**The Two Voices Rule.** Unbounded is for numbers, headings, buttons and judgements; anything the user reads to learn is system UI.

## Layout

A single centred column with a 1040px max width and 16px gutters (the HUD aligns its padding to the same column). Under 860px everything stacks; at 860px and up the Learn page splits into two columns (1.1fr / 1fr): Starter and practice left, add-a-link and skills right. Game rows go two-up between 560px and 859px. Run screens (the stage) narrow to 640px with large bottom padding so the answer sheet never covers the last option.

On a phone the Daily Starter owns the first screen: it grows to the viewport height minus the HUD and its track becomes a highway of tall columns, one per due card, each with a note that falls once on load and rests on the hit line. With nothing due it collapses to a compact panel.

Rhythm: 4px between track segments, 8px between rows and chips, 16px between sections and page gutters, 20px panel padding. Safe-area insets are respected at the top of the HUD and the bottom of pages and the sheet.

## Elevation & Depth

Depth is tonal, not shadowed: stage, HUD, panel and raised panel step up in lightness. The only offsets are solid, zero-blur bottom edges, which are the physical key travel of pressable things and the stamped weight of ranks and grades. The single soft shadow belongs to the answer sheet, the one thing that floats over the stage.

### Shadow Vocabulary
- **Key travel** (`box-shadow: 0 4px 0 <edge>`): buttons; drops to `0 0 0` with a 4px translate on press.
- **Row travel** (`box-shadow: 0 3px 0 var(--hud)`): game rows, answer options, match tiles; drops 3px on press.
- **Lane key inset** (`box-shadow: inset 0 -3px 0 var(--lane-deep)`): the lettered lane key.
- **Rank edge** (`box-shadow: 0 3px 0 <lane-deep>`) and **Grade edge** (`box-shadow: 0 8px 0 <lane-deep>`): skill ranks and the results grade.
- **Sheet lift** (`box-shadow: 0 -12px 32px rgb(10 7 34 / .45)`): the answer sheet only.

### Named Rules
**The Key Travel Rule.** A solid bottom edge means "this can be pressed or this was stamped". It always collapses on press; it never appears on static panels.

## Shapes

Soft, chunky rectangles: 14px for buttons, inputs, rows and cells; 20px for panels and the sheet's top corners; 10px for stat chips and small inset wells. Ranks and the grade sit rotated -4deg like a stamp. Track segments are short rounded bars (3-5px radius); on the phone highway they become tall columns with rounded tops (10px 10px 4px 4px). Borders are always 2px; dashed borders mean empty or done.

## Components

### Buttons
Chunky and physical, Duolingo's press-down.
- **Shape:** 14px radius, minimum 48px tall, Unbounded 700 label, icon gap 0.5rem.
- **Primary:** ink face, dark-ink text, lavender edge.
- **Secondary:** raised indigo face, HUD edge.
- **Dark:** dark-ink face, used on lane-coloured surfaces.
- **Ghost:** transparent, soft ink, no edge.
- **Icon:** 44px square, soft ink, panel background on hover.
- **Hover / Focus / Active:** hover brightens 8%; focus is a 3px ink outline offset 3px; active drops the edge with a 4px translate (80ms).

### Chips (HUD stats)
- **Style:** panel chips, 10px radius, Tabler icon in soft ink, Unbounded tabular numeral, small unit label (hidden under 420px).

### Cards / Containers
- **Corner Style:** 20px panels; 14px cells.
- **Background:** panel for sections; HUD wells for link and skill cells; the Starter is the one coral panel.
- **Shadow Strategy:** none (see Elevation).
- **Internal Padding:** 20px panels; about 13-14px cells.

### Inputs / Fields
- **Style:** HUD well, 2px line border, 14px radius, 48px tall; a leading Tabler icon sits inside when the field has one.
- **Focus:** border turns ink, no outline.

### Navigation
- **HUD:** sticky, HUD indigo with a 2px line bottom border: wordmark, stat chips, log out.

### Run HUD row
Every run screen has one HUD row, and it starts with a leave (X) icon button. It then carries the segmented progress track (cleared segments fill with their first judgement's lane colour) and a "left" count, or, in timed games, the clock and combo chips plus a pop slot where judgements stamp in.

### Game rows and answer options
Rows carry a lettered lane key (40px, lane face, deep inset edge) followed by name and subtitle. Answer options cycle the four lanes; hover shows the lane colour on the 2px border. After answering, the right option takes a mint border on a dark mint well and the wrong one a coral border on a dark coral well with a coral strike-through.

### Answer sheet (signature)
Slides up from the bottom (380ms, ease-out-expo curve) in the judgement's lane colour with dark-ink text, carrying the judgement stamp (word + Tabler icon, scaled in from 1.5x) and one full-width Continue button.

### Results
A rotated grade stamp (8.5rem, lane face by grade) over a row of stat tiles: lane-coloured frames with an uppercase label and a stage-indigo well holding the Unbounded numeral.

## Do's and Don'ts

### Do:
- **Do** keep every lane colour tied to a lane, a game, a judgement or a grade: Perfect is mint, Good is gold, Miss is coral.
- **Do** make primary buttons ink and secondary buttons raised indigo; use the dark button on a lane-coloured surface.
- **Do** show every judgement as word + icon + colour, never colour alone.
- **Do** start every run screen's single HUD row with the leave (X) button.
- **Do** take icons from the inline Tabler outline sprite in index.html (2px stroke, round caps, currentColor).
- **Do** collapse the solid bottom edge on press for anything that has one.
- **Do** keep all animation behind prefers-reduced-motion.

### Don't:
- **Don't** put kicker or eyebrow labels above headings.
- **Don't** use a lane colour for a primary action, decoration or general status.
- **Don't** add type sizes beyond the three-step ramp except for display numerals.
- **Don't** use emoji or text glyphs as icons.
- **Don't** give static panels a bottom edge or soft shadow; the sheet is the only floating surface.
