// Learn tab: the Daily Starter, Weak spots and three mini-games.
// Only the Starter's first answer to each card goes through lc_grade_mine (the schedule);
// repeats and practice only give XP through lc_award_mine. Everything after the Starter is optional.
import { closeEnough, shuffle, grade } from './text.js';
import { icon } from './links.js';

const COLS = 'id, source_id, question, options, answer, explanation, box, last_result, reviews';
const STARTER_XP = 10;
const GAMES = {
  weak: ['Weak spots', weakSpots, 'W', 'coral', 'Cards you keep missing'],
  match: ['Match pairs', matchPairs, 'M', 'gold', '6 pairs against the clock'],
  blank: ['Fill the blank', fillBlank, 'F', 'mint', 'Type 5 answers'],
  speed: ['Speed round', speedRound, 'S', 'blue', '60 seconds, keep the combo'],
};
const LANES = ['coral', 'gold', 'mint', 'blue']; // answer options A-D, like a rhythm game's lanes
// Judgements, rhythm-game style. Each is a word, an icon and a lane colour, never colour alone.
const JUDGE = { perfect: ['Perfect', 'check'], good: ['Good', 'check'], miss: ['Miss', 'x'] };
const $ = (id) => document.getElementById(id);
let sb, refresh;

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.filter((k) => k != null));
  return node;
}
const must = ({ data, error }) => { if (error) throw error; return data; };
const answerOf = (c) => String(c.options?.[c.answer] ?? '');
const btn = (text, kind, onclick) => el('button', { className: `btn ${kind}`, textContent: text, onclick });
const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
// Leaving a run: timers stop and the flow's pending promise is simply never resolved, so no XP is given.
// Starter answers already given stay graded; unanswered cards stay due. The phone's back button leaves too.
const timers = new Set();
const every = (fn, ms) => { const id = setInterval(fn, ms); timers.add(id); return id; };
function leave() { timers.forEach(clearInterval); timers.clear(); home(true); }
const exit = () => (history.state?.hubRun ? history.back() : leave());
const back = () => btn('Back to Learn', 'btn-light', exit);
// One HUD row per run screen: the leave button, then the progress track, counters or a short status.
const hud = (...items) => el('div', { className: 'runbar' }, ...items);
const stage = (...kids) => {
  const head = kids[0]?.classList?.contains('runbar') ? kids.shift() : hud();
  if (!head.querySelector('.quit')) head.prepend(el('button', { className: 'btn-icon quit', ariaLabel: 'Leave and go back to Learn', title: 'Leave', onclick: exit }, icon('x')));
  $('learn-stage').replaceChildren(head, ...kids.filter((k) => k != null));
  scrollTo({ top: 0 });
};
const notEnough = () => ({ xp: 0, note: 'Not enough cards yet. Add a few links first.' });
// The run's progress: one segment per card. A cleared card lights up in the colour of its first judgement.
const runbar = (total, marks, status) => hud(
  el('ol', { className: 'track', ariaLabel: `${marks.length} of ${total} cleared` },
    ...Array.from({ length: total }, (_, i) => el('li', { className: marks[i] ? `on ${marks[i]}` : '' }))),
  el('span', { className: 'runstatus', textContent: status }));
const tiles = (...list) => el('div', { className: 'tiles' },
  ...list.filter(Boolean).map(([name, value, lane]) => el('div', { className: `tile lane-${lane}` }, el('small', { textContent: name }), el('b', { textContent: value }))));
const tally = (t) => [['Perfect', t.perfect, 'mint'], ['Good', t.good, 'gold'], ['Miss', t.miss, 'coral']];
// A judgement popping in the HUD row at the moment of a hit (Speed round, Match pairs).
const popper = () => {
  const slot = el('span', { className: 'popslot', role: 'status' });
  slot.show = (kind) => slot.replaceChildren(el('span', { className: `pop ${kind}` }, icon(JUDGE[kind][1]), JUDGE[kind][0]));
  return slot;
};
// Optional practice; dayDone counts today for the streak (only when nothing was due).
const menu = (dayDone) => el('div', { className: 'games' },
  ...Object.entries(GAMES).map(([key, [name, , letter, lane, blurb]]) => el('button', { className: `game lane-${lane}`, onclick: () => run(() => solo(key, dayDone)) },
    el('span', { className: 'key', textContent: letter }), el('span', {}, el('b', { textContent: name }), el('small', { textContent: blurb })), icon('chevron', 'chev'))));

function home(show) {
  $('learn-home').hidden = !show;
  $('learn-stage').hidden = show;
  if (show) refresh();
}

export function initLearn(client, onChange) {
  sb = client; refresh = onChange;
  $('start-starter').addEventListener('click', () => run(starter));
  // With nothing due, practice from home counts for the streak, same as Start's "No cards due" menu.
  const nothingDue = () => $('learn-home').querySelector('.starter').classList.contains('is-empty');
  document.querySelectorAll('[data-game]').forEach((b) => b.addEventListener('click', () => { const dayDone = nothingDue(); run(() => solo(b.dataset.game, dayDone)); }));
  addEventListener('popstate', () => { if (!$('learn-stage').hidden) leave(); });
}

async function run(flow) {
  timers.forEach(clearInterval); timers.clear(); // a game started from a results screen replaces the last one
  if (!history.state?.hubRun) history.pushState({ hubRun: true }, '');
  home(false);
  try { await flow(); } catch (e) { stage(el('h2', { textContent: 'Something went wrong' }), el('p', { className: 'error', textContent: e.message || String(e) }), back()); }
}

async function award(xp, dayDone) {
  const res = must(await sb.rpc('lc_award_mine', { p_xp: xp, p_day_done: dayDone }))?.[0];
  refresh();
  return res;
}

async function gameCards() {
  const cards = must(await sb.from('lc_cards').select(COLS).limit(300));
  return shuffle(cards.filter((c) => Array.isArray(c.options) && answerOf(c)));
}

async function starter() {
  const due = must(await sb.from('lc_cards').select(COLS).lte('due_at', new Date().toISOString()).order('due_at').limit(10));
  if (!due.length) {
    stage(el('div', { className: 'results' }, el('h2', { textContent: 'No cards due today' }),
      el('p', { className: 'muted', textContent: 'Play any practice game to keep your streak.' }), menu(true), back()));
    return;
  }
  // Learn before you're tested: a link's key ideas come first, the first time its cards come up.
  const fresh = [...new Set(due.filter((c) => !c.reviews).map((c) => c.source_id))];
  if (fresh.length) {
    const sources = must(await sb.from('lc_sources').select('id, title, url, lesson_url, key_ideas').in('id', fresh));
    for (const s of sources) if (s.key_ideas?.length) await study(s);
  }
  const t = await drill(due, async (card, choice) => must(await sb.rpc('lc_grade_mine', { p_card: card.id, p_choice: choice })));
  const res = await award(STARTER_XP, true);
  const g = grade(t.perfect + t.good, due.length);
  stage(el('div', { className: 'results' },
    el('div', { className: `grade g-${g.toLowerCase()}`, textContent: g, ariaLabel: `Grade ${g}` }),
    el('h2', { textContent: 'Day done' }),
    tiles(...tally(t)),
    tiles(['XP', `+${STARTER_XP}`, 'ink'], res && ['Streak', days(res.new_streak), 'ink']),
    el('p', { className: 'muted', textContent: 'Want more? All optional:' }), menu(false), back()));
}

// One key idea per card, so a dense topic reads a bite at a time. Back and Next step through them.
function study(s) {
  const list = s.key_ideas, n = list.length;
  const link = (href, text) => href && el('a', { href, target: '_blank', rel: 'noopener' }, text, icon('external'));
  return new Promise((resolve) => {
    const show = (i) => {
      const last = i === n - 1, k = list[i];
      const go = btn(last ? 'Got it, quiz me' : 'Next', 'btn-go', last ? resolve : () => show(i + 1));
      stage(runbar(n, Array(i + 1).fill('perfect'), `Idea ${i + 1} of ${n}`),
        el('div', { className: 'study' }, el('p', { className: 'prompt', textContent: `New topic: ${s.title || 'key ideas'}` }),
          el('article', { className: `idea-card lane-${LANES[i % 4]}` }, el('h2', { textContent: k.point }), k.explain ? el('p', { textContent: k.explain }) : null),
          el('div', { className: 'row' }, i ? btn('Back', 'btn-light', () => show(i - 1)) : null, go),
          last ? el('p', { className: 'row' }, link(s.lesson_url, 'Full lesson'), link(s.url, 'Original')) : null));
      go.focus();
    };
    show(0);
  });
}

// Successive relearning: shuffled so topics mix, and every card comes back until you get it right.
// onFirst runs on a card's first answer only. A right answer you weren't sure of comes back once more.
// Returns the first-answer tally: perfect (right and sure), good (right, unsure), miss.
async function drill(cards, onFirst) {
  const queue = shuffle(cards), first = new Map(), marks = [], t = { perfect: 0, good: 0, miss: 0 };
  while (queue.length) {
    const card = queue.shift();
    const { choice, sure } = await ask(card, runbar(cards.length, marks, `${queue.length + 1} left`));
    const right = choice === card.answer, isFirst = !first.has(card.id);
    const kind = !right ? 'miss' : sure ? 'perfect' : 'good';
    let note = null;
    if (isFirst) { first.set(card.id, kind); t[kind]++; await onFirst?.(card, choice); }
    if (!right) {
      queue.push(card);
      if (sure) note = 'You were sure of this one. Confident mistakes are the easiest to fix, so take a good look at why.';
    } else if (isFirst && !sure) {
      queue.push(card);
      note = "Right, but you weren't sure, so it comes back once more.";
    } else marks.push(first.get(card.id));
    await reveal(card, choice, note, kind, runbar(cards.length, marks, `${queue.length} left`));
  }
  return t;
}

async function solo(key, dayDone = false) {
  const [name, game] = GAMES[key];
  const { xp, note, stats = [] } = await game(await gameCards());
  const res = xp || dayDone ? await award(xp, dayDone) : null;
  stage(el('div', { className: 'results' }, el('h2', { textContent: name }), el('p', { textContent: note }),
    stats.length ? tiles(...stats) : null,
    tiles(['XP', `+${xp}`, 'ink'], dayDone && res && ['Streak', days(res.new_streak), 'ink']), back()));
}

// Answer options sit in lanes A-D. With `marked`, they show the result instead of taking a pick.
function options(card, onPick, marked) {
  return el('div', { className: 'options' },
    ...card.options.map((o, i) => {
      const b = el('button', { className: `option lane-${LANES[i % 4]}`, onclick: () => onPick?.(i) },
        el('span', { className: 'key', textContent: String.fromCharCode(65 + i) }), el('span', { textContent: o }));
      if (marked) {
        b.disabled = true;
        if (i === card.answer) b.classList.add('is-right');
        else if (i === marked.choice) b.classList.add('is-wrong');
      }
      return b;
    }));
}

// Recall first: you try to answer from memory before the options appear, and say how sure you are.
function ask(card, bar) {
  return new Promise((resolve) => {
    const show = (sure) => stage(bar, el('h2', { textContent: card.question }), options(card, (choice) => resolve({ choice, sure })));
    const know = btn('I know it', 'btn-go', () => show(true));
    stage(bar, el('h2', { textContent: card.question }), el('p', { className: 'prompt', textContent: 'Think of the answer first, then:' }),
      el('div', { className: 'row' }, know, btn('Not sure', 'btn-light', () => show(false))));
    know.focus();
  });
}

// The answer sheet slides up with the judgement stamp.
function reveal(card, choice, note, kind, bar, showOptions = true) {
  const right = kind !== 'miss';
  const [word, mark] = JUDGE[kind];
  return new Promise((resolve) => {
    const next = btn('Continue', 'btn-dark', resolve);
    stage(bar, el('h2', { textContent: card.question }), showOptions ? options(card, null, { choice }) : null,
      el('div', { className: `sheet ${kind}`, role: 'status' }, el('div', { className: 'sheet-in' },
        el('p', { className: 'judge' }, icon(mark), word),
        right ? null : el('p', {}, 'Answer: ', el('b', { textContent: answerOf(card) })),
        card.explanation ? el('p', { textContent: card.explanation }) : null,
        right ? null : el('p', { className: 'note', textContent: 'Before you go on: say in your own words why this is the answer.' }),
        note ? el('p', { className: 'note', textContent: note }) : null,
        next)));
    next.focus();
  });
}

// Match pairs: 6 questions against 6 answers, timed. 2 XP a pair.
function matchPairs(cards) {
  const seen = new Set();
  const set = cards.filter((c) => !seen.has(answerOf(c)) && seen.add(answerOf(c))).slice(0, 6);
  if (set.length < 2) return notEnough();
  return new Promise((resolve) => {
    const start = Date.now();
    let sel = null, left = set.length, misses = 0;
    const clock = el('b', { textContent: '0' }), pop = popper();
    const timer = every(() => { clock.textContent = Math.floor((Date.now() - start) / 1000); }, 250);
    const tile = (text, id, side) => {
      const b = el('button', { className: 'tile-btn', textContent: text });
      b.onclick = () => {
        if (sel?.b === b) { b.classList.remove('picked'); sel = null; return; }
        if (!sel || sel.side === side) { sel?.b.classList.remove('picked'); sel = { b, id, side }; b.classList.add('picked'); return; }
        const other = sel.b, match = sel.id === id;
        sel = null; other.classList.remove('picked');
        pop.show(match ? 'perfect' : 'miss');
        if (!match) {
          misses++;
          for (const x of [b, other]) { x.classList.add('miss'); setTimeout(() => x.classList.remove('miss'), 600); }
          return;
        }
        for (const x of [b, other]) { x.disabled = true; x.classList.add('done'); }
        if (--left) return;
        clearInterval(timer);
        const s = Math.round((Date.now() - start) / 1000);
        resolve({ xp: set.length * 2, note: `${set.length} pairs in ${s}s.`,
          stats: [['Pairs', set.length, 'mint'], ['Time', `${s}s`, 'ink'], ['Miss', misses, 'coral']] });
      };
      return b;
    };
    stage(hud(el('span', { className: 'stat' }, icon('clock'), clock, el('small', { textContent: 's' })), pop),
      el('p', { className: 'prompt', textContent: 'Tap a question, then its answer.' }),
      el('div', { className: 'match' },
        el('div', { className: 'col' }, ...set.map((c) => tile(c.question, c.id, 'q'))),
        el('div', { className: 'col' }, ...shuffle(set).map((c) => tile(answerOf(c), c.id, 'a')))));
  });
}

// Weak spots: up to 8 cards you missed last time or that are still in the first boxes,
// until each one is right. 2 XP each. Never changes when a card comes back.
async function weakSpots(cards) {
  const set = cards.filter((c) => c.reviews > 0 && (c.last_result === false || c.box <= 1)).sort((a, b) => a.box - b.box).slice(0, 8);
  if (!set.length) return { xp: 0, note: 'No weak spots right now. Cards you miss in the Starter show up here.' };
  const t = await drill(set);
  return { xp: set.length * 2, note: `All ${set.length} cleared.`, stats: tally(t) };
}

// Fill the blank: type the answer to 5 cards, small typos allowed. 3 XP each.
async function fillBlank(cards) {
  const short = cards.filter((c) => answerOf(c).length <= 40); // typing a whole sentence isn't fun
  const set = (short.length >= 3 ? short : cards).slice(0, 5);
  if (!set.length) return notEnough();
  const marks = [];
  for (const [i, card] of set.entries()) {
    const guess = await typed(card, runbar(set.length, marks, `${set.length - i} left`));
    const kind = closeEnough(guess, answerOf(card)) ? 'perfect' : 'miss';
    marks.push(kind);
    await reveal(card, kind === 'perfect' ? card.answer : -1, null, kind, runbar(set.length, marks, `${set.length - i - 1} left`), false);
  }
  const right = marks.filter((k) => k === 'perfect').length;
  return { xp: right * 3, note: `${right} of ${set.length} right.`, stats: [['Perfect', right, 'mint'], ['Miss', set.length - right, 'coral']] };
}

function typed(card, bar) {
  return new Promise((resolve) => {
    const input = el('input', { autocomplete: 'off', autocapitalize: 'off', placeholder: 'Type the answer', ariaLabel: 'Your answer' });
    const form = el('form', { className: 'blank', onsubmit: (e) => { e.preventDefault(); resolve(input.value); } },
      input, el('button', { className: 'btn btn-go', textContent: 'Check' }));
    stage(bar, el('h2', { textContent: card.question }), form);
    input.focus();
  });
}

// Speed round: 60 seconds of multiple choice. 1 XP per right answer; a miss resets the combo.
function speedRound(cards) {
  const pool = cards.filter((c) => c.options.length >= 2);
  if (pool.length < 2) return notEnough();
  return new Promise((resolve) => {
    const end = Date.now() + 60_000;
    let right = 0, total = 0, combo = 0, best = 0, order = [], i = 0;
    const clock = el('b', { textContent: '60' }), comboEl = el('b', { textContent: '0' }), pop = popper(), box = el('div', { className: 'speed' });
    const timer = every(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      clock.textContent = left;
      if (left) return;
      clearInterval(timer);
      resolve({ xp: right, note: `${right} of ${total} right in 60 seconds.`,
        stats: [['Perfect', right, 'mint'], ['Miss', total - right, 'coral'], ['Max combo', best, 'ink']] });
    }, 200);
    const next = () => {
      if (i >= order.length) { order = shuffle(pool); i = 0; }
      const card = order[i++];
      box.replaceChildren(el('h2', { textContent: card.question }), options(card, (k) => {
        if (Date.now() >= end) return;
        total++;
        const ok = k === card.answer;
        right += ok; combo = ok ? combo + 1 : 0; best = Math.max(best, combo);
        comboEl.textContent = combo;
        pop.show(ok ? 'perfect' : 'miss');
        next();
      }));
    };
    stage(hud(el('span', { className: 'stat' }, icon('clock'), clock, el('small', { textContent: 's' })),
      el('span', { className: 'stat' }, comboEl, el('small', { textContent: 'combo' })), pop), box);
    next();
  });
}
