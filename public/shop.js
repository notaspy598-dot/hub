// The XP shop (sql/011), off the header's XP counter. Prices, limits and what you own all come from lc_shop;
// buying and wearing go through lc_buy and lc_wear. Spending never touches the league or trophies.
import { el } from './links.js';
import { play, confetti } from './sound.js';
import { localDay } from './text.js';

const $ = (id) => document.getElementById(id);
const GROUPS = [['power', 'Power-ups'], ['theme', 'Themes'], ['title', 'Titles']];
let sb, refresh;

export function initShop(client, onChange) {
  sb = client; refresh = onChange;
  $('shop-open').addEventListener('click', openShop);
  $('shop-intro-open').addEventListener('click', () => { $('shop-intro').close(); openShop(); });
}

export function openShop() { $('shop-msg').textContent = ''; $('shop').showModal(); loadShop(); }

// Runs a purchase or a change of outfit, then reloads the shop and the header (balance, freezes, theme).
const act = (fn, cheer) => async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  $('shop-msg').textContent = '';
  const { error } = await fn();
  if (error) { $('shop-msg').textContent = error.message; b.disabled = false; return; }
  if (cheer) { play('done'); confetti(b, 40); }
  refresh();
  loadShop();
};

function row(r, balance) {
  const short = r.price != null && r.price > balance;
  let button = null, note = r.note;
  if (r.state === 'buy') {
    button = el('button', { type: 'button', className: 'btn btn-go btn-sm', disabled: short, textContent: `${r.price} XP`,
      ariaLabel: `Buy ${r.title} for ${r.price} XP`, onclick: act(() => sb.rpc('lc_buy', { p_item: r.item }), true) });
    if (short) note = [note, `${r.price - balance} more XP to go.`].filter(Boolean).join(' ');
  } else if (r.state === 'owned' || r.state === 'worn') {
    const on = r.state === 'owned';
    button = el('button', { type: 'button', className: `btn btn-sm ${on ? 'btn-light' : 'btn-dark'}`, textContent: on ? 'Wear' : 'Take off',
      ariaLabel: `${on ? 'Wear' : 'Take off'} ${r.title}`, onclick: act(() => sb.rpc('lc_wear', { p_item: r.item, p_on: on })) });
  }
  return el('li', { className: `shop-item is-${r.state}` },
    el('span', {}, el('b', { textContent: r.title }), r.state === 'worn' ? el('small', { className: 'tag', textContent: 'Wearing' }) : null,
      el('small', { textContent: r.blurb }), note ? el('small', { className: 'note', textContent: note }) : null),
    button);
}

export async function loadShop() {
  const { data, error } = await sb.rpc('lc_shop');
  if (error) {
    $('shop-list').replaceChildren();
    $('shop-msg').textContent = error.code ? 'The shop needs sql/011_xp_shop.sql run in Supabase.' : "You're offline. The shop needs a connection.";
    return;
  }
  const balance = data[0]?.balance ?? 0;
  $('shop-balance').textContent = balance.toLocaleString();
  $('shop-list').replaceChildren(...GROUPS.map(([kind, name]) => el('section', { className: 'account-part' },
    el('h3', { textContent: name }), el('ul', { className: 'shop' }, ...data.filter((r) => r.kind === kind).map((r) => row(r, balance))))));
}

// Nudges: a card offering one buy at the moment it helps. "Not now" hides that kind for the rest of the day,
// or for good with once. Kept on this phone only.
const kept = () => { try { return JSON.parse(localStorage.getItem('hub-nudges')) || {}; } catch { return {}; } };
export const hushed = (id, once = false) => (once ? id in kept() : kept()[id] === localDay());
export const hush = (id) => { try { localStorage.setItem('hub-nudges', JSON.stringify({ ...kept(), [id]: localDay() })); } catch { /* shows again */ } };

// The shop row for item when you could buy it right now and haven't said "Not now" today. null before sql/011.
export async function canBuy(item) {
  if (hushed(item)) return null;
  const { data, error } = await sb.rpc('lc_shop');
  const r = !error && data?.find((x) => x.item === item);
  return r && r.state === 'buy' && r.price <= r.balance ? r : null;
}
// What you can spend, or null before sql/011.
export async function spendable() {
  const { data, error } = await sb.rpc('lc_shop');
  return error ? null : data?.[0]?.balance ?? null;
}
// action returns an error or nothing; done, the card goes away (refresh redraws the header and home).
export function nudge(id, text, label, action, once = false) {
  const msg = el('small', { className: 'error', role: 'alert' });
  const go = el('button', { type: 'button', className: 'btn btn-go btn-sm', textContent: label, onclick: async () => {
    go.disabled = true; msg.textContent = '';
    const error = await action();
    if (error) { msg.textContent = error.message; go.disabled = false; return; }
    if (once) hush(id);
    card.remove();
  } });
  const card = el('div', { className: 'nudge', role: 'status' }, el('b', { textContent: text }),
    el('div', { className: 'row' }, go, el('button', { type: 'button', className: 'btn btn-light btn-sm', textContent: 'Not now', onclick: () => { hush(id); card.remove(); } })), msg);
  return card;
}
export const buy = (item) => async () => {
  const { error } = await sb.rpc('lc_buy', { p_item: item });
  if (!error) { play('done'); refresh(); }
  return error;
};

// Home: the shop's intro once, then at most one card: a streak with no freeze, or a first time you can afford a theme or title.
export async function homeNudge(p, balance, streak) {
  const slot = $('nudge');
  let card = null, freeze;
  if (p && 'xp_spent' in p) {
    if (!hushed('intro', true)) { hush('intro'); $('shop-intro').showModal(); }
    else if (streak >= 3 && !p.freezes && (freeze = await canBuy('freeze'))) {
      card = nudge('freeze', `Your ${streak}-day streak has no freeze. One covers a day you miss.`, `Buy a freeze: ${freeze.price} XP`, buy('freeze'));
    } else {
      const [n, what] = [[500, 'a theme'], [250, 'a title']].find(([x]) => balance >= x) ?? [];
      if (n && !hushed(`afford-${n}`, true)) {
        if (n === 500) hush('afford-250'); // past both at once: one card
        card = nudge(`afford-${n}`, `You have ${balance.toLocaleString()} XP, enough for ${what}.`, 'Look in the shop', async () => openShop(), true);
      }
    }
  }
  slot.replaceChildren(...(card ? [card] : []));
  slot.hidden = !card;
}
