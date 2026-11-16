// Learn tab: the Daily Starter, Weak spots and three mini-games.
// Only the Starter's first answer to each card goes through lc_grade_mine (the schedule);
// repeats and practice only give XP through lc_award_mine. Everything after the Starter is optional.
import { closeEnough, shuffle } from './text.js';
import { ideas } from './links.js';

const COLS = 'id, source_id, question, options, answer, explanation, box, last_result, reviews';
const STARTER_XP = 10;
const GAMES = { weak: ['Weak spots', weakSpots], match: ['Match pairs', matchPairs], blank: ['Fill the blank', fillBlank], speed: ['Speed round', speedRound] };
const $ = (id) => document.getElementById(id);
let sb, refresh;

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.filter((k) => k != null));
  return node;
}
const must = ({ data, error }) => { if (error) throw error; return data; };
const answerOf = (c) => String(c.options?.[c.answer] ?? '');
const stage = (...kids) => $('learn-stage').replaceChildren(...kids);
const back = () => el('button', { textContent: 'Back to Learn', onclick: () => home(true) });
const notEnough = () => ({ xp: 0, note: 'Not enough cards yet. Add a few links first.' });
// Optional practice; dayDone counts today for the streak (only when nothing was due).
const menu = (dayDone) => el('div', { className: 'row' },
  ...Object.entries(GAMES).map(([key, [name]]) => el('button', { textContent: name, onclick: () => run(() => solo(key, dayDone)) })));

function home(show) {
  $('learn-home').hidden = !show;
  $('learn-stage').hidden = show;
  if (show) refresh();
}

export function initLearn(client, onChange) {
  sb = client; refresh = onChange;
  $('start-starter').addEventListener('click', () => run(starter));
  document.querySelectorAll('[data-game]').forEach((b) => b.addEventListener('click', () => run(() => solo(b.dataset.game))));
}

async function run(flow) {
  home(false);
  try { await flow(); } catch (e) { stage(el('p', { className: 'error', textContent: e.message || String(e) }), back()); }
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
    stage(el('h2', { textContent: 'No cards due today' }), el('p', { textContent: 'Practice anything below to keep your streak.' }), menu(true), back());
    return;
  }
  // Learn before you're tested: a link's key ideas come first, the first time its cards come up.
  const fresh = [...new Set(due.filter((c) => !c.reviews).map((c) => c.source_id))];
  if (fresh.length) {
    const sources = must(await sb.from('lc_sources').select('id, title, url, lesson_url, key_ideas').in('id', fresh));
    for (const s of sources) if (s.key_ideas?.length) await study(s);
  }
  const firstRight = await drill(due, 'Daily Starter', async (card, choice) => must(await sb.rpc('lc_grade_mine', { p_card: card.id, p_choice: choice })));
  const res = await award(STARTER_XP, true);
  stage(el('h2', { textContent: 'Day done 🎉' }),
    el('p', { textContent: `${firstRight} of ${due.length} right first time · +${STARTER_XP} XP${res ? ` · 🔥 ${res.new_streak}-day streak` : ''}` }),
    el('p', { className: 'muted', textContent: 'Want more? All optional:' }), menu(false), back());
}

function study(s) {
  return new Promise((resolve) => {
    const go = el('button', { textContent: 'Got it, quiz me', onclick: resolve });
    const link = (href, text) => href && el('a', { href, target: '_blank', rel: 'noopener', textContent: text });
    stage(el('p', { className: 'muted', textContent: 'New topic · learn it first' }), el('h2', { textContent: s.title || 'Key ideas' }),
      ideas(s.key_ideas), el('p', { className: 'row' }, link(s.lesson_url, 'Full lesson ↗'), link(s.url, 'Original ↗')), go);
    go.focus();
  });
}

// Successive relearning: shuffled so topics mix, and every card comes back until you get it right.
// onFirst runs on a card's first answer only. A right answer you weren't sure of comes back once more.
async function drill(cards, label, onFirst) {
  const queue = shuffle(cards), seen = new Set();
  let firstRight = 0;
  while (queue.length) {
    const card = queue.shift();
    const { choice, sure } = await ask(card, `${label} · ${queue.length + 1} to go`);
    const right = choice === card.answer, first = !seen.has(card.id);
    let note = null;
    if (first) { seen.add(card.id); firstRight += right; await onFirst?.(card, choice); }
    if (!right) {
      queue.push(card);
      if (sure) note = 'You were sure of this one. Confident mistakes are the easiest to fix, so take a good look at why.';
    } else if (first && !sure) {
      queue.push(card);
      note = "Right, but you weren't sure, so it comes back once more.";
    }
    await reveal(card, choice, note);
  }
  return firstRight;
}

async function solo(key, dayDone = false) {
  const [name, game] = GAMES[key];
  const { xp, note } = await game(await gameCards());
  const res = xp || dayDone ? await award(xp, dayDone) : null;
  stage(el('h2', { textContent: name }), el('p', { textContent: note }),
    el('p', { textContent: `+${xp} XP${dayDone && res ? ` · 🔥 ${res.new_streak}-day streak` : ''}` }), back());
}

function options(card, onPick) {
  return el('div', { className: 'options' },
    ...card.options.map((o, i) => el('button', { className: 'option', textContent: o, onclick: () => onPick(i) })));
}

// Recall first: you try to answer from memory before the options appear, and say how sure you are.
function ask(card, label) {
  return new Promise((resolve) => {
    const head = () => [el('p', { className: 'muted', textContent: label }), el('h2', { textContent: card.question })];
    const show = (sure) => stage(...head(), options(card, (choice) => resolve({ choice, sure })));
    const know = el('button', { textContent: 'I know it', onclick: () => show(true) });
    stage(...head(), el('p', { className: 'muted', textContent: 'Think of the answer first, then:' }),
      el('div', { className: 'row' }, know, el('button', { className: 'second', textContent: 'Not sure', onclick: () => show(false) })));
    know.focus();
  });
}

// The card flips to show the right answer and why.
function reveal(card, choice, note) {
  const right = choice === card.answer;
  return new Promise((resolve) => {
    const next = el('button', { textContent: 'Next', onclick: resolve });
    stage(el('div', { className: 'flip' },
      el('p', { className: right ? 'good' : 'bad', textContent: right ? '✅ Correct' : '❌ Not quite' }),
      el('h2', { textContent: card.question }),
      el('p', {}, 'Answer: ', el('b', { textContent: answerOf(card) })),
      card.explanation ? el('p', { className: 'muted', textContent: card.explanation }) : null,
      right ? null : el('p', { textContent: 'Before you go on: say in your own words why this is the answer.' }),
      note ? el('p', { className: 'muted', textContent: note }) : null,
      next));
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
    const clock = el('b', { textContent: '0' });
    const timer = setInterval(() => { clock.textContent = Math.floor((Date.now() - start) / 1000); }, 250);
    const tile = (text, id, side) => {
      const b = el('button', { className: 'tile', textContent: text });
      b.onclick = () => {
        if (sel?.b === b) { b.classList.remove('picked'); sel = null; return; }
        if (!sel || sel.side === side) { sel?.b.classList.remove('picked'); sel = { b, id, side }; b.classList.add('picked'); return; }
        const other = sel.b, match = sel.id === id;
        sel = null; other.classList.remove('picked');
        if (!match) {
          misses++;
          for (const x of [b, other]) { x.classList.add('miss'); setTimeout(() => x.classList.remove('miss'), 450); }
          return;
        }
        for (const x of [b, other]) { x.disabled = true; x.classList.add('done'); }
        if (--left) return;
        clearInterval(timer);
        const s = Math.round((Date.now() - start) / 1000);
        resolve({ xp: set.length * 2, note: `${set.length} pairs in ${s}s${misses ? `, ${misses} miss${misses > 1 ? 'es' : ''}` : ''}.` });
      };
      return b;
    };
    stage(el('p', { className: 'muted' }, 'Match pairs · tap a question, then its answer · ⏱ ', clock, 's'),
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
  const firstRight = await drill(set, 'Weak spots');
  return { xp: set.length * 2, note: `${firstRight} of ${set.length} right first time, and all ${set.length} cleared.` };
}

// Fill the blank: type the answer to 5 cards, small typos allowed. 3 XP each.
async function fillBlank(cards) {
  const short = cards.filter((c) => answerOf(c).length <= 40); // typing a whole sentence isn't fun
  const set = (short.length >= 3 ? short : cards).slice(0, 5);
  if (!set.length) return notEnough();
  let right = 0;
  for (const [i, card] of set.entries()) {
    const guess = await typed(card, `Fill the blank · ${i + 1} of ${set.length}`);
    const ok = closeEnough(guess, answerOf(card));
    right += ok;
    await reveal(card, ok ? card.answer : -1);
  }
  return { xp: right * 3, note: `${right} of ${set.length} right.` };
}

function typed(card, label) {
  return new Promise((resolve) => {
    const input = el('input', { autocomplete: 'off', autocapitalize: 'off', placeholder: 'Type the answer', ariaLabel: 'Your answer' });
    const form = el('form', { className: 'blank', onsubmit: (e) => { e.preventDefault(); resolve(input.value); } },
      input, el('button', { textContent: 'Check' }));
    stage(el('p', { className: 'muted', textContent: label }), el('h2', { textContent: card.question }), form);
    input.focus();
  });
}

// Speed round: 60 seconds of multiple choice. 1 XP per right answer.
function speedRound(cards) {
  const pool = cards.filter((c) => c.options.length >= 2);
  if (pool.length < 2) return notEnough();
  return new Promise((resolve) => {
    const end = Date.now() + 60_000;
    let right = 0, total = 0, order = [], i = 0;
    const clock = el('b', { textContent: '60' }), score = el('b', { textContent: '0' }), box = el('div', { className: 'speed' });
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      clock.textContent = left;
      if (left) return;
      clearInterval(timer);
      resolve({ xp: right, note: `${right} of ${total} right in 60 seconds.` });
    }, 200);
    const next = () => {
      if (i >= order.length) { order = shuffle(pool); i = 0; }
      const card = order[i++];
      box.replaceChildren(el('h2', { textContent: card.question }), options(card, (k) => {
        if (Date.now() >= end) return;
        total++;
        const ok = k === card.answer;
        if (ok) score.textContent = ++right;
        box.dataset.flash = ok ? 'good' : 'bad';
        setTimeout(() => delete box.dataset.flash, 250);
        next();
      }));
    };
    stage(el('p', { className: 'muted' }, 'Speed round · ⏱ ', clock, 's · ✅ ', score), box);
    next();
  });
}
