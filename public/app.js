import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TELEGRAM_ID, LINK_WEBHOOK, VAPID_PUBLIC_KEY } from './config.js';
import { initLearn } from './learn.js';
import { initLinks, startLinks } from './links.js';
import { initRemind, loadRemind } from './remind.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

// A header number that went up (XP, streak) pops, so the reward lands where it is kept. Not on the first load.
let shown = false;
function show(id, value) {
  const b = $(id), up = shown && id !== 'due' && value > Number(b.textContent);
  b.textContent = value;
  if (up) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); } // reflow restarts the animation
}

async function loadStats() {
  // First login creates your learner profile. TELEGRAM_ID (optional) keeps the cards an old Telegram bot chat made.
  const link = await sb.rpc('lc_link_me', TELEGRAM_ID ? { p_chat: TELEGRAM_ID } : {});
  $('setup-error').hidden = !link.error;
  if (link.error) $('setup-error').textContent = `Couldn't set up your profile (${link.error.message}). Run sql/003_web.sql in Supabase, then reload.`;
  const [profile, due] = await Promise.all([
    sb.from('lc_profile').select('xp, streak, last_active, freezes').maybeSingle(),
    sb.from('lc_cards').select('id', { count: 'exact', head: true }).lte('due_at', new Date().toISOString()),
  ]);
  const p = profile.data;
  // Same rule as the database (sql/007, UTC days): the streak is alive if you played today or yesterday,
  // or missed no more days than you have freezes. Playing today then spends them.
  const missed = p?.last_active ? Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(p.last_active)) / 864e5) - 1 : Infinity;
  show('xp', p?.xp ?? 0);
  show('streak', p && missed <= (p.freezes ?? 0) ? p.streak : 0);
  show('freezes', p?.freezes ?? 0);
  const frozen = p && missed > 0 && missed <= p.freezes;
  $('streak-note').hidden = !frozen;
  if (frozen) $('streak-note').textContent = `Your ${p.streak}-day streak is frozen: you missed ${missed === 1 ? 'a day' : `${missed} days`}. `
    + `${due.count ? "Clear today's track" : 'Play any practice game'} and ${missed === 1 ? 'a freeze keeps' : `${missed} freezes keep`} it going.`;
  show('due', due.count ?? 0);
  // Due cards on the home-screen icon, a quiet reminder (Android; iOS once notifications are allowed).
  navigator.setAppBadge?.(due.count ?? 0)?.catch(() => {});
  // Today's track: one segment per card the Starter will play (it takes up to 10).
  const play = Math.min(due.count ?? 0, 10);
  $('starter-due').textContent = due.count ?? 0;
  $('starter-due-label').textContent = !due.count ? 'cards due today. Practice below keeps your streak.' : `${due.count === 1 ? 'card' : 'cards'} on today's track`;
  document.querySelector('.starter').classList.toggle('is-empty', !due.count);
  $('starter-track').replaceChildren(...Array.from({ length: play }, () => document.createElement('li')));
  shown = true;
}

async function render(session) {
  $('login').hidden = !!session;
  $('app').hidden = !session;
  if (session) { await loadStats(); startLinks(); loadRemind(); }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  $('login-error').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') });
  if (error) $('login-error').textContent = error.message;
});
$('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get('password') });
  $('password-msg').className = error ? 'error' : 'muted';
  $('password-msg').textContent = error ? error.message : 'Saved. Use it next time you log in.';
  if (!error) e.target.reset();
});
$('logout').addEventListener('click', () => sb.auth.signOut());
initLearn(sb, loadStats);
initLinks(sb, LINK_WEBHOOK, loadStats);
initRemind(sb, VAPID_PUBLIC_KEY);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
sb.auth.onAuthStateChange((_event, session) => { render(session); });
