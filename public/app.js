import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TELEGRAM_ID, LINK_WEBHOOK, VAPID_PUBLIC_KEY } from './config.js';
import { initLearn, setGoal, saveToday, savedToday, syncOffline } from './learn.js';
import { initLinks, startLinks, loadHistory } from './links.js';
import { initRemind, loadRemind } from './remind.js';
import { initWeek, loadWeek, loadProgress } from './week.js';
import { initExport } from './export.js';
import { localDay } from './text.js';

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
  if (link.error && !link.error.code) return offlineStats(); // no connection: the track saved on this phone
  $('setup-error').hidden = !link.error;
  if (link.error) $('setup-error').textContent = `Couldn't set up your profile (${link.error.message}). Run sql/003_web.sql in Supabase, then reload.`;
  // Days follow this phone's time zone (sql/010). It only takes effect from the next request, so it goes first.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const zone = await sb.rpc('lc_set_tz', { p_tz: tz });
  const [profile, due] = await Promise.all([
    sb.from('lc_profile').select('xp, streak, last_active, freezes, daily_goal').maybeSingle(),
    sb.from('lc_cards').select('id', { count: 'exact', head: true }).lte('due_at', new Date().toISOString()),
  ]);
  // Saved before and still not what the request ran in: PostgREST isn't calling lc_local_time, so days are still UTC.
  const z = zone.data?.[0];
  if (!link.error && z && !z.changed && z.ran_in !== tz) {
    $('setup-error').hidden = false;
    $('setup-error').textContent = "Days still end at midnight UTC: Supabase's API isn't running sql/010's time-zone step. See README, Local days.";
  }
  const p = profile.data;
  setGoal(p?.daily_goal ?? 10);
  $('goal').value = String(p?.daily_goal ?? 10);
  $('goal-text').textContent = p?.daily_goal ?? 10;
  // Same rule as the database (sql/007, your days since sql/010): the streak is alive if you played today or yesterday,
  // or missed no more days than you have freezes. Playing today then spends them.
  const missed = p?.last_active ? Math.round((Date.parse(localDay()) - Date.parse(p.last_active)) / 864e5) - 1 : Infinity;
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
  track(due.count ?? 0, p?.daily_goal ?? 10);
  shown = true;
}

// Today's track: one segment per card the Starter will play (it takes up to the daily goal).
function track(count, goal) {
  $('starter-due').textContent = count;
  $('starter-due-label').textContent = !count ? 'cards due today. Practice below keeps your streak.' : `${count === 1 ? 'card' : 'cards'} on today's track`;
  document.querySelector('.starter').classList.toggle('is-empty', !count);
  $('starter-track').replaceChildren(...Array.from({ length: Math.min(count, goal) }, () => document.createElement('li')));
}

// Offline: the header keeps its last numbers and the Starter offers the track saved when Hub last had a connection.
function offlineStats() {
  const n = savedToday()?.cards?.length ?? 0;
  $('setup-error').hidden = false;
  $('setup-error').textContent = n ? "You're offline. Today's track is saved on this phone: play it now and it syncs when you're back."
    : "You're offline, and no track was saved on this phone. Open Hub once with a connection to keep one for later.";
  track(n, n);
}

async function render(session) {
  $('login').hidden = !!session;
  $('app').hidden = !session;
  if (!session) return;
  await syncOffline(); // a round played offline counts first
  await loadStats(); startLinks(); loadRemind(); loadWeek();
  saveToday(); // keep today's track on the phone for a round without a connection

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
// The offline track belongs to whoever saved it, so it goes with them (an unsynced offline round too).
$('logout').addEventListener('click', () => {
  $('account').close();
  try { localStorage.removeItem('hub-today'); localStorage.removeItem('hub-pending'); } catch { /* nothing kept */ }
  sb.auth.signOut();
});
// Reminder, password and log out live in a dialog off the header, out of the way of the day's work.
$('account-open').addEventListener('click', () => $('account').showModal());
// Tabs: plain show/hide, no URL change, so the games' back-button handling (learn.js) is untouched.
// Games play in #learn-stage, outside the tabs, so a challenge started from Progress still shows.
const tabs = document.querySelectorAll('.tabs button');
tabs.forEach((t) => t.addEventListener('click', () => {
  tabs.forEach((b) => { b === t ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); $(b.dataset.tab).hidden = b !== t; });
  if (t.dataset.tab === 'history') loadHistory();
  if (t.dataset.tab === 'progress') loadProgress();
}));
// Back on Learn after a run, or after a claim or answer: the header and This week both move.
const refresh = () => { loadStats(); loadWeek(); if (!$('progress').hidden) loadProgress(); };
addEventListener('online', async () => { if (await syncOffline()) refresh(); else loadStats(); });
$('goal').addEventListener('change', async (e) => {
  e.target.disabled = true;
  const { error } = await sb.rpc('lc_set_goal', { p_goal: Number(e.target.value) });
  e.target.disabled = false;
  $('goal-msg').className = error ? 'error' : 'muted';
  $('goal-msg').textContent = error ? error.message : `Saved: ${e.target.value} cards a day.`;
  if (!error) { await loadStats(); saveToday(); }
});
initLearn(sb, refresh);
initWeek(sb, refresh);
initLinks(sb, LINK_WEBHOOK, loadStats);
initRemind(sb, VAPID_PUBLIC_KEY);
initExport(sb);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
sb.auth.onAuthStateChange((_event, session) => { render(session); });
