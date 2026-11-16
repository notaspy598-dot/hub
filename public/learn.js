// Learn tab: the Daily Starter and three mini-games.
// Only the Starter's first answer to each card goes through lc_grade_mine (the schedule);
// repeats and games only give XP through lc_award_mine.
import { closeEnough, shuffle } from './text.js';

const COLS = 'id, question, options, answer, explanation';
const STARTER_XP = 10;
const GAMES = { match: ['Match pairs', matchPairs], blank: ['Fill the blank', fillBlank], speed: ['Speed round', speedRound] };
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
const notEnough = () => ({ xp: 0, note: 'Not enough cards yet. Send the Telegram bot a few links first.' });

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
  const queue = [...due], graded = new Set();
  while (queue.length) {
    const card = queue.shift();
    const choice = await ask(card, `Daily Starter · ${queue.length + 1} to go`);
    if (!graded.has(card.id)) {
      graded.add(card.id);
      must(await sb.rpc('lc_grade_mine', { p_card: card.id, p_choice: choice }));
    }
    if (choice !== card.answer) queue.push(card); // missed cards come back until you get them right
    await reveal(card, choice);
  }
  const key = shuffle(Object.keys(GAMES))[0];
  const [name, game] = GAMES[key];
  await pause(due.length ? 'Cards done' : 'No cards due today', `One mini-game to finish the day: ${name}.`, 'Play');
  const { xp, note } = await game(await gameCards());
  const res = await award(STARTER_XP + xp, true);
  stage(el('h2', { textContent: 'Day done 🎉' }), el('p', { textContent: note }),
    el('p', { textContent: `+${STARTER_XP + xp} XP${res ? ` · 🔥 ${res.new_streak}-day streak` : ''}` }), back());
}

async function solo(key) {
  const [name, game] = GAMES[key];
  const { xp, note } = await game(await gameCards());
  if (xp) await award(xp, false);
  stage(el('h2', { textContent: name }), el('p', { textContent: note }), el('p', { textContent: `+${xp} XP` }), back());
}

function pause(title, text, label) {
  return new Promise((resolve) => {
    const go = el('button', { textContent: label, onclick: resolve });
    stage(el('h2', { textContent: title }), el('p', { textContent: text }), go);
    go.focus();
  });
}

function options(card, onPick) {
  return el('div', { className: 'options' },
    ...card.options.map((o, i) => el('button', { className: 'option', textContent: o, onclick: () => onPick(i) })));
}

function ask(card, label) {
  return new Promise((resolve) => {
    stage(el('p', { className: 'muted', textContent: label }), el('h2', { textContent: card.question }), options(card, resolve));
  });
}

// The card flips to show the right answer and why.
function reveal(card, choice) {
  const right = choice === card.answer;
  return new Promise((resolve) => {
    const next = el('button', { textContent: 'Next', onclick: resolve });
    stage(el('div', { className: 'flip' },
      el('p', { className: right ? 'good' : 'bad', textContent: right ? '✅ Correct' : '❌ Not quite' }),
      el('h2', { textContent: card.question }),
      el('p', {}, 'Answer: ', el('b', { textContent: answerOf(card) })),
      card.explanation ? el('p', { className: 'muted', textContent: card.explanation }) : null,
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
