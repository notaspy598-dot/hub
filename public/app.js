import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TELEGRAM_ID, LINK_WEBHOOK } from './config.js';
import { initLearn } from './learn.js';
import { initLinks, startLinks } from './links.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

async function loadStats() {
  // First login creates your learner profile. TELEGRAM_ID (optional) keeps the cards an old Telegram bot chat made.
  const link = await sb.rpc('lc_link_me', TELEGRAM_ID ? { p_chat: TELEGRAM_ID } : {});
  $('setup-error').hidden = !link.error;
  if (link.error) $('setup-error').textContent = `Couldn't set up your profile (${link.error.message}). Run sql/003_web.sql in Supabase, then reload.`;
  const [profile, due] = await Promise.all([
    sb.from('lc_profile').select('xp, streak, last_active').maybeSingle(),
    sb.from('lc_cards').select('id', { count: 'exact', head: true }).lte('due_at', new Date().toISOString()),
  ]);
  const p = profile.data;
  // Same rule as the bot: the streak only counts if you were active today or yesterday (UTC, like the database).
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  $('xp').textContent = p?.xp ?? 0;
  $('streak').textContent = p && p.last_active >= yesterday ? p.streak : 0;
  $('due').textContent = due.count ?? 0;
  // Today's track: one segment per card the Starter will play (it takes up to 10).
  const play = Math.min(due.count ?? 0, 10);
  $('starter-due').textContent = due.count ?? 0;
  $('starter-due-label').textContent = !due.count ? 'cards due today. Practice below keeps your streak.' : `${due.count === 1 ? 'card' : 'cards'} on today's track`;
  document.querySelector('.starter').classList.toggle('is-empty', !due.count);
  $('starter-track').replaceChildren(...Array.from({ length: play }, () => document.createElement('li')));
}

async function render(session) {
  $('login').hidden = !!session;
  $('app').hidden = !session;
  if (session) { await loadStats(); startLinks(); }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  $('login-error').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') });
  if (error) $('login-error').textContent = error.message;
});
$('logout').addEventListener('click', () => sb.auth.signOut());
initLearn(sb, loadStats);
initLinks(sb, LINK_WEBHOOK, loadStats);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
sb.auth.onAuthStateChange((_event, session) => { render(session); });
