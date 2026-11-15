import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

function showTab() {
  const tab = location.hash === '#style' ? 'style' : 'learn';
  for (const name of ['learn', 'style']) $(`tab-${name}`).hidden = name !== tab;
  document.querySelectorAll('[data-tab]').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function loadStats() {
  const [profile, due, style] = await Promise.all([
    sb.from('lc_profile').select('xp, streak, last_active').maybeSingle(),
    sb.from('lc_cards').select('id', { count: 'exact', head: true }).lte('due_at', new Date().toISOString()),
    sb.from('style_items').select('id', { count: 'exact', head: true }),
  ]);
  const p = profile.data;
  // Same rule as the bot: the streak only counts if you were active today or yesterday (UTC, like the database).
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  $('xp').textContent = p?.xp ?? 0;
  $('streak').textContent = p && p.last_active >= yesterday ? p.streak : 0;
  $('not-linked').hidden = !!p;
  $('due').textContent = due.count ?? 0;
  $('style-count').textContent = style.count ?? 0;
}

async function render(session) {
  $('login').hidden = !!session;
  $('app').hidden = !session;
  if (session) { showTab(); await loadStats(); }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  $('login-error').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') });
  if (error) $('login-error').textContent = error.message;
});
$('logout').addEventListener('click', () => sb.auth.signOut());
addEventListener('hashchange', showTab);
sb.auth.onAuthStateChange((_event, session) => { render(session); });
