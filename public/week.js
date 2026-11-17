// This week: your numbers, three quests, the league and friends' challenges (sql/008), plus the daily
// "Did you use it?" card. Every number comes from the database. Before sql/008 is run, both cards stay hidden.
import { el } from './links.js';
import { playChallenge } from './learn.js';
import { play, confetti } from './sound.js';

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

export async function loadWeek() {
  const [week, quests, league, challenges, prompt] = await Promise.all(
    ['lc_my_week', 'lc_quests', 'lc_league', 'lc_my_challenges', 'lc_use_prompt'].map((fn) => sb.rpc(fn)));
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
    el('span', { className: 'pos', textContent: i + 1 }), el('b', { textContent: p.me ? `${p.name} (you)` : p.name }), el('span', { textContent: `${p.xp} XP` }))));
  $('league-hint').textContent = !w.name ? 'Pick a name to join. Only people with a name are shown, and only their name and XP this week.'
    : league.data.length < 2 ? 'Nobody else has joined yet. Ask a friend to pick a name.' : 'Resets every Monday. After a Speed round, you can challenge someone to the same cards.';
  $('name-form').hidden = !!w.name;
  $('rename').hidden = !w.name;
  $('name-form').elements.name.value = w.name ?? '';
  $('challenges').replaceChildren(...challenges.data.map(challenge));
}
