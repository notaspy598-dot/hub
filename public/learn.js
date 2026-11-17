// Learn tab: the Daily Starter, Weak spots and three mini-games.
// Only the Starter's first answer to each card goes through lc_grade_mine (the schedule);
// repeats and practice only give XP through lc_award_mine. Everything after the Starter is optional.
import { closeEnough, shuffle, grade, LEVELS } from './text.js';
import { icon, skillLevels } from './links.js';
import { play, soundToggle, confetti } from './sound.js';

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
  if (!head.querySelector('.sound')) head.append(soundToggle());
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

// With nothing due, practice from home counts for the streak, same as Start's "No cards due" menu.
const nothingDue = () => $('learn-home').querySelector('.starter').classList.contains('is-empty');

export function initLearn(client, onChange) {
  sb = client; refresh = onChange;
  $('start-starter').addEventListener('click', () => run(starter));
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
    for (const s of sources) if (s.key_ideas?.length) { await study(s); sb.rpc('lc_studied', { p_id: s.id }).then(() => {}); } // for "Did you use it?"
  }
  const levels = await skillLevels();
  const t = await drill(due, async (card, choice) => must(await sb.rpc('lc_grade_mine', { p_card: card.id, p_choice: choice })));
  const before = Number($('streak').textContent) || 0; // the header still shows the old streak (0 if it broke)
  const res = await award(STARTER_XP, true);
  const g = grade(t.perfect + t.good, due.length), n = res?.new_streak ?? 0;
  // An open loop for tomorrow: cards already waiting by the end of tomorrow (local time).
  const end = new Date(); end.setDate(end.getDate() + 2); end.setHours(0, 0, 0, 0);
  const { count: tomorrow } = await sb.from('lc_cards').select('id', { count: 'exact', head: true }).lte('due_at', end.toISOString());
  const now = await skillLevels(), ups = Object.keys(now).filter((k) => now[k] > (levels[k] ?? 0));
  const badge = el('div', { className: `grade g-${g.toLowerCase()}`, textContent: g, ariaLabel: `Grade ${g}` });
  play('done');
  stage(el('div', { className: 'results' }, badge,
    el('h2', { textContent: 'Day done' }),
    n > before ? el('p', { className: 'streak-up', textContent: streakLine(n) }) : null,
    freezeLine(res),
    ...ups.map((k) => el('p', { className: 'streak-up', textContent: `Level up: ${k} is now ${LEVELS[now[k]]}.` })),
    tiles(...tally(t)),
    tiles(['XP', `+${STARTER_XP}`, 'ink'], res && ['Streak', days(n), 'ink'], res && ['Freezes', `${res.freezes ?? 0}/2`, 'blue']),
    tomorrow ? el('p', { className: 'muted', textContent: `Tomorrow: ${tomorrow} ${tomorrow === 1 ? 'card' : 'cards'} on your track.` }) : null,
    el('p', { className: 'muted', textContent: 'Want more? All optional:' }), menu(false), back()));
  // The session's peak: confetti every day the Starter is cleared, a bigger burst on a milestone or a flawless S.
  confetti(badge, MILESTONES.includes(n) || g === 'S' || ups.length ? 140 : 70);
}

// Streak days that get the big burst. Early days matter most: 2 to 3 is +50%, 200 to 201 is +0.5%.
const MILESTONES = [3, 7, 14, 30, 50, 100, 150, 200, 250, 300, 365, 500, 730, 1000];
const streakLine = (n) => n === 1 ? 'Streak started. Come back tomorrow to make it 2.'
  : MILESTONES.includes(n) ? `${n}-day streak! Milestone reached.` : `Streak extended to ${days(n)}.`;
// What the streak freezes did today (sql/007): one saved the streak after a missed day, or a 7th day earned one.
const freezeLine = (res) => {
  const text = [res?.saved && `A streak freeze saved your streak (${res.freezes} left).`,
    res?.earned && `You earned a streak freeze: ${res.freezes} of 2.`].filter(Boolean).join(' ');
  return text ? el('p', { className: 'muted', textContent: text }) : null;
};

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
          last ? el('p', { className: 'row' }, link(s.lesson_url, 'Full lesson'), link(/^https?:/.test(s.url) && s.url, 'Original')) : null));
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
  let run = 0; // right answers in a row: each one rings a semitone higher
  while (queue.length) {
    const card = queue.shift();
    const { choice, sure } = await ask(card, runbar(cards.length, marks, `${queue.length + 1} left`));
    const right = choice === card.answer, isFirst = !first.has(card.id);
    const kind = !right ? 'miss' : sure ? 'perfect' : 'good';
    let note = null;
    run = right ? run + 1 : 0;
    if (isFirst) { first.set(card.id, kind); t[kind]++; await onFirst?.(card, choice); }
    if (!right) {
      queue.push(card);
      if (sure) note = 'You were sure of this one. Confident mistakes are the easiest to fix, so take a good look at why.';
    } else if (isFirst && !sure) {
      queue.push(card);
      note = "Right, but you weren't sure, so it comes back once more.";
    } else marks.push(first.get(card.id));
    await reveal(card, choice, note, kind, runbar(cards.length, marks, `${queue.length} left`), true, run - 1);
  }
  return t;
}

async function solo(key, dayDone = false) {
  const [name, game] = GAMES[key];
  const { xp, note, stats = [], best, flawless, seen } = await game(await gameCards());
  const res = xp || dayDone ? await award(xp, dayDone) : null;
  // Personal best on this device, higher is better. The first score only sets it; beating it is the reward.
  let prev = null;
  try { prev = localStorage.getItem(`hub-best-${key}`); if (best != null && (prev == null || best > Number(prev))) localStorage.setItem(`hub-best-${key}`, best); } catch { /* not remembered */ }
  const record = best != null && prev != null && best > Number(prev);
  const head = el('h2', { textContent: record ? `${name}: new best!` : name });
  play(record || flawless ? 'done' : 'clear');
  stage(el('div', { className: 'results' }, head, el('p', { textContent: note }),
    dayDone ? freezeLine(res) : null,
    stats.length ? tiles(...stats) : null,
    tiles(['XP', `+${xp}`, 'ink'], dayDone && res && ['Streak', days(res.new_streak), 'ink']),
    seen?.length >= 2 ? await challengeForm(seen, best) : null, back()));
  if (record || flawless) confetti(head);
}

// After a Speed round: send the cards you just played, and your score, to someone in the league.
async function challengeForm(seen, score) {
  const { data: league } = await sb.rpc('lc_league');
  const me = league?.find((p) => p.me), others = (league ?? []).filter((p) => !p.me);
  if (!league || !others.length) return null; // no league yet (sql/008 not run, or nobody else joined)
  if (!me) return el('p', { className: 'muted', textContent: 'Pick a league name on Learn to challenge a friend to these cards.' });
  const pick = el('select', { ariaLabel: 'Friend to challenge' }, ...others.map((p) => el('option', { value: p.name, textContent: p.name })));
  const msg = el('p', { className: 'muted', role: 'status' });
  const send = el('button', { className: 'btn btn-go', textContent: 'Send', onclick: async () => {
    send.disabled = true;
    const { error } = await sb.rpc('lc_challenge', { p_to: pick.value, p_cards: seen, p_score: score });
    msg.textContent = error ? error.message : `Sent. ${pick.value} plays the same cards and tries to beat ${score}.`;
    if (error) send.disabled = false;
  } });
  return el('div', { className: 'challenge-send' }, el('b', { textContent: 'Challenge a friend' }), el('div', { className: 'inline-form' }, pick, send), msg);
}

// A friend's challenge: their Speed round cards, 60 seconds, beat their score. Plays once.
export const playChallenge = (c) => run(async () => {
  const dayDone = nothingDue();
  const cards = must(await sb.rpc('lc_challenge_cards', { p_id: c.id })).filter((k) => Array.isArray(k.options) && answerOf(k));
  const r = await speedRound(shuffle(cards));
  const [f] = must(await sb.rpc('lc_finish_challenge', { p_id: c.id, p_score: r.best ?? 0 }));
  const res = r.xp || dayDone ? await award(r.xp, dayDone) : null;
  const won = f.their_score > f.score, tie = f.their_score === f.score;
  const head = el('h2', { textContent: won ? `You beat ${f.other}!` : tie ? `A tie with ${f.other}` : `${f.other} wins this one` });
  play(won ? 'done' : 'clear');
  stage(el('div', { className: 'results' }, head, el('p', { textContent: r.note }),
    dayDone ? freezeLine(res) : null,
    tiles(['You', f.their_score, won ? 'mint' : 'ink'], [f.other, f.score, won || tie ? 'ink' : 'coral'], ['XP', `+${r.xp}`, 'ink']), back()));
  if (won) confetti(head);
});

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
function reveal(card, choice, note, kind, bar, showOptions = true, step = 0) {
  const right = kind !== 'miss';
  const [word, mark] = JUDGE[kind];
  play(kind, step);
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
        pop.show(match ? 'perfect' : 'miss'); play(match ? 'perfect' : 'miss', set.length - left);
        if (!match) {
          misses++;
          for (const x of [b, other]) { x.classList.add('miss'); setTimeout(() => x.classList.remove('miss'), 600); }
          return;
        }
        for (const x of [b, other]) { x.disabled = true; x.classList.add('done'); }
        if (--left) return;
        clearInterval(timer);
        const s = Math.round((Date.now() - start) / 1000);
        resolve({ xp: set.length * 2, note: `${set.length} pairs in ${s}s.`, best: set.length === 6 ? -s : null, // faster wins; only full boards count
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
  return { xp: set.length * 2, note: `All ${set.length} cleared.`, stats: tally(t), flawless: !t.miss };
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
  return { xp: right * 3, note: `${right} of ${set.length} right.`, stats: [['Perfect', right, 'mint'], ['Miss', set.length - right, 'coral']],
    best: right, flawless: right === set.length };
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
    const seen = new Set(); // the cards shown, so they can be sent as a challenge
    const clock = el('b', { textContent: '60' }), comboEl = el('b', { textContent: '0' }), pop = popper(), box = el('div', { className: 'speed' });
    const timer = every(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      if (left && left <= 5 && String(left) !== clock.textContent) play('tick'); // the last five seconds count down
      clock.textContent = left;
      if (left) return;
      clearInterval(timer);
      resolve({ xp: right, note: `${right} of ${total} right in 60 seconds.`, best: right, seen: [...seen],
        stats: [['Perfect', right, 'mint'], ['Miss', total - right, 'coral'], ['Max combo', best, 'ink']] });
    }, 200);
    const next = () => {
      if (i >= order.length) { order = shuffle(pool); i = 0; }
      const card = order[i++];
      seen.add(card.id);
      box.replaceChildren(el('h2', { textContent: card.question }), options(card, (k) => {
        if (Date.now() >= end) return;
        total++;
        const ok = k === card.answer;
        right += ok; combo = ok ? combo + 1 : 0; best = Math.max(best, combo);
        comboEl.textContent = combo;
        pop.show(ok ? 'perfect' : 'miss');
        play(!ok ? 'miss' : combo % 5 ? 'perfect' : 'combo', combo - 1); // every 5 in a row gets the bigger flourish
        next();
      }));
    };
    stage(hud(el('span', { className: 'stat' }, icon('clock'), clock, el('small', { textContent: 's' })),
      el('span', { className: 'stat' }, comboEl, el('small', { textContent: 'combo' })), pop), box);
    next();
  });
}
