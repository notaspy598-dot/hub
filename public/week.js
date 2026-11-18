// This week: your numbers, three quests, the league and friends' challenges (sql/008), plus the daily
// "Did you use it?" card. Every number comes from the database. Before sql/008 is run, both cards stay hidden.
import { el, skillLevels } from './links.js';
import { playChallenge } from './learn.js';
import { play, confetti } from './sound.js';
import { localDay } from './text.js';

const $ = (id) => document.getElementById(id);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
let sb, refresh, use = null;

// Runs a change, shows a failure under the panel, then reloads the header and this panel.
const act = (fn) => async (e) => {
  const b = e?.currentTarget;
  if (b) b.disabled = true;
  $('week-error').textContent = '';
  try { await fn(b); } catch (err) { $('week-error').textContent = err.message || String(err); if (b) b.disabled = false; return; }
  refresh();
};
const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; };

export function initWeek(client, onChange) {
  sb = client; refresh = onChange;
  $('name-form').addEventListener('submit', (e) => { e.preventDefault(); act(() => rpc('lc_set_name', { p_name: e.target.elements.name.value }))(); });
  $('rename').addEventListener('click', () => { $('name-form').hidden = false; $('name-form').elements.name.focus(); });
  const answer = (used) => act(async (b) => {
    const xp = await rpc('lc_answer_use', { p_source: use.source_id, p_idea: use.idea, p_used: used });
    play(used ? 'perfect' : 'clear');
    if (xp) confetti(b, 30);
  });
  $('use-yes').addEventListener('click', answer(true));
  $('use-no').addEventListener('click', answer(false));
}

function quest(q) {
  const done = q.progress >= q.goal;
  const claim = done && !q.claimed && el('button', { type: 'button', className: 'btn btn-go btn-sm', textContent: `Claim +${q.xp} XP`,
    onclick: act(async (b) => { await rpc('lc_claim_quest', { p_quest: q.quest }); play('done'); confetti(b, 60); }) });
  return el('li', { className: q.claimed ? 'claimed' : '' }, el('b', { textContent: q.title }),
    claim || el('small', { textContent: q.claimed ? 'Claimed' : `${q.progress}/${q.goal}` }),
    el('span', { className: 'meter', role: 'img', ariaLabel: `${q.progress} of ${q.goal}` }, el('i', { style: `width:${Math.round(100 * q.progress / q.goal)}%` })));
}

// A challenge from either side. score is the sender's, their_score the receiver's.
function challenge(c) {
  if (c.incoming && c.their_score == null) return el('li', {}, el('span', {}, el('b', { textContent: c.other }), ` challenged you: beat ${c.score} in a Speed round.`),
    el('button', { type: 'button', className: 'btn btn-go btn-sm', textContent: 'Play', onclick: () => playChallenge(c) }));
  if (c.their_score == null) return el('li', { className: 'muted', textContent: `Waiting for ${c.other} to play your ${c.score}.` });
  const mine = c.incoming ? c.their_score : c.score, theirs = c.incoming ? c.score : c.their_score;
  const verdict = mine > theirs ? 'you won' : mine < theirs ? `${c.other} won` : 'a tie';
  return el('li', { className: 'muted', textContent: `You ${mine}, ${c.other} ${theirs}: ${verdict}.` });
}

// Progress tab's other two panels (sql/009). Both stay hidden until it's run.
export async function loadProgress() {
  const [act, life, levels, ahead] = await Promise.all([sb.rpc('lc_activity', { p_days: 84 }), sb.rpc('lc_lifetime'), skillLevels(), sb.rpc('lc_forecast', { p_days: 7 })]);
  $('activity-card').hidden = !!act.error;
  $('forecast-card').hidden = !!ahead.error; // hidden until sql/010 is run
  if (!ahead.error) forecast(ahead.data);
  $('trophies-card').hidden = !!life.error;
  if (!act.error) activity(act.data);
  if (!life.error && life.data?.[0]) trophies({ ...life.data[0], expert: Object.values(levels).filter((s) => s.lv === 3).length });
}

// The next 7 days: how many cards come due each day, so a heavy day shows before it arrives. Overdue counts as today.
function forecast(rows) {
  const due = new Map(rows.map((r) => [String(r.day).slice(0, 10), r.due]));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
  const counts = days.map((d) => due.get(localDay(d)) ?? 0), max = Math.max(1, ...counts), week = counts.reduce((a, b) => a + b, 0);
  $('forecast').replaceChildren(...days.map((d, i) => el('li', { title: `${counts[i]} due` },
    el('b', { textContent: counts[i] }),
    el('span', { className: 'bar' }, el('i', { style: `height:${Math.round(100 * counts[i] / max)}%` })),
    el('small', { textContent: i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString(undefined, { weekday: 'short' }) }))));
  $('forecast').ariaLabel = days.map((d, i) => `${i ? d.toLocaleDateString(undefined, { weekday: 'long' }) : 'Today'}: ${counts[i]}`).join(', ');
  $('forecast-sum').textContent = week ? `${plural(counts[0], 'card')} due today, ${week} over the next 7 days.` : 'Nothing due in the next 7 days.';
}

// 12 weeks as columns, Monday on top, in your days like the streak. Darker means more XP that day.
function activity(rows) {
  const xp = new Map(rows.map((r) => [String(r.day).slice(0, 10), r.played ? Math.max(r.xp, 1) : r.xp]));
  const today = localDay(), start = new Date();
  start.setHours(12, 0, 0, 0); // noon, so stepping a day at a time never trips over a DST change
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 77); // Monday, 11 weeks before this one
  const max = Math.max(1, ...xp.values()), played = rows.filter((r) => r.played).length;
  $('activity').replaceChildren(...Array.from({ length: 84 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const day = localDay(d), n = xp.get(day) ?? 0;
    return el('li', { className: day > today ? 'future' : `${n ? `l${Math.ceil(4 * n / max)}` : ''}${day === today ? ' today' : ''}`, title: `${day}: ${n} XP` });
  }));
  $('activity').ariaLabel = `Played ${plural(played, 'day')} in the last 12 weeks`;
  $('activity-sum').textContent = `${plural(played, 'day')} played in the last 12 weeks.`;
}

// Three tiers each. Every number comes from lc_lifetime or your skills; the tiers live only here.
const TROPHIES = [
  ['best_streak', 'On fire', 'day best streak', [7, 30, 100]],
  ['mastered', 'Memory bank', 'cards mastered', [10, 100, 500]],
  ['expert', 'Expert', 'skills at Expert', [1, 3, 10]],
  ['links', 'Collector', 'links added', [5, 25, 100]],
  ['used', 'In real life', 'ideas used', [1, 10, 50]],
  ['won', 'Challenger', 'challenges won', [1, 5, 25]],
  ['xp', 'Grinder', 'XP', [1000, 10000, 50000]],
];
const TIERS = ['Locked', 'Bronze', 'Silver', 'Gold'];
function trophies(life) {
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem('hub-trophies')) || {}; } catch { /* first time on this device */ }
  const fresh = [], now = {};
  $('trophies').replaceChildren(...TROPHIES.map(([key, name, unit, goals]) => {
    const n = life[key] ?? 0, tier = goals.filter((g) => n >= g).length, next = goals[tier];
    now[key] = tier;
    if (seen[key] != null && tier > seen[key]) fresh.push(`${name} (${TIERS[tier]})`);
    return el('li', { className: tier ? '' : 'locked' }, el('span', { className: `level lv-${tier}`, textContent: TIERS[tier] }), el('b', { textContent: name }),
      el('small', { textContent: next ? `${n.toLocaleString()} / ${next.toLocaleString()} ${unit}` : `${n.toLocaleString()} ${unit}. Maxed out.` }));
  }));
  try { localStorage.setItem('hub-trophies', JSON.stringify(now)); } catch { /* not remembered */ }
  const earned = Object.values(now).reduce((a, b) => a + b, 0);
  $('trophies-sum').replaceChildren(fresh.length ? el('span', { className: 'streak-up', textContent: `New: ${fresh.join(', ')}! ` }) : '',
    `${earned} of ${TROPHIES.length * 3} earned.`);
  if (fresh.length) { play('done'); confetti($('trophies-title'), 60); }
}

export async function loadWeek() {
  const [week, quests, league, challenges, prompt, titles] = await Promise.all(
    ['lc_my_week', 'lc_quests', 'lc_league', 'lc_my_challenges', 'lc_use_prompt', 'lc_league_titles'].map((fn) => sb.rpc(fn)));
  const title = new Map((titles.data ?? []).map((t) => [t.name, t.title])); // empty before sql/011
  const off = [week, quests, league, challenges, prompt].some((r) => r.error);
  $('week-card').hidden = off;
  use = !off && prompt.data?.[0];
  $('use-card').hidden = !use;
  if (use) {
    $('use-text').replaceChildren('From ', el('b', { textContent: use.title || 'a link you studied' }), ': ', el('q', { textContent: use.point }),
      ' Have you put it to use since?');
    $('use-yes').disabled = $('use-no').disabled = false;
  }
  if (off) return;

  const w = week.data?.[0] ?? {};
  $('week-sum').textContent = `${w.xp ?? 0} XP · ${plural(w.days ?? 0, 'day')} played · ${plural(w.mastered ?? 0, 'card')} mastered`
    + (w.used ? ` · ${plural(w.used, 'idea')} used` : '') + (w.place ? `. ${w.place === 1 ? '1st' : w.place === 2 ? '2nd' : w.place === 3 ? '3rd' : `${w.place}th`} of ${w.players} in the league.` : '.');
  $('quests').replaceChildren(...quests.data.map(quest));

  $('league').replaceChildren(...league.data.map((p, i) => el('li', { className: p.me ? 'me' : '' },
    el('span', { className: 'pos', textContent: i + 1 }),
    el('span', { className: 'who' }, el('b', { textContent: p.me ? `${p.name} (you)` : p.name }), title.has(p.name) ? el('small', { className: 'tag', textContent: title.get(p.name) }) : null),
    el('span', { textContent: `${p.xp} XP` }))));
  $('league-hint').textContent = !w.name ? 'Pick a name to join. Only people with a name are shown, and only their name and XP this week.'
    : league.data.length < 2 ? 'Nobody else has joined yet. Ask a friend to pick a name.' : 'Resets every Monday. After a Speed round, you can challenge someone to the same cards.';
  $('name-form').hidden = !!w.name;
  $('rename').hidden = !w.name;
  $('name-form').elements.name.value = w.name ?? '';
  $('challenges').replaceChildren(...challenges.data.map(challenge));
}
