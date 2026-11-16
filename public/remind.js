// Opt-in daily reminder over Web Push. Off until the person turns it on. The "remind" Edge Function sends
// at most one a day, only when cards are due and nothing was played today, and pauses after 5 ignored in a row.
// iPhone: Web Push works only once Hub is on the Home Screen (iOS 16.4+), and permission must come from a tap.
const $ = (id) => document.getElementById(id);
let sb, key, row = null;

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const iosBrowserTab = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches;
const keyBytes = (k) => Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hourText = (h) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function show() {
  const paused = row?.ignored >= 5, on = row && !paused, denied = Notification.permission === 'denied';
  $('remind-text').textContent = denied ? "Notifications are blocked for Hub. Allow them in your phone's settings, then come back here."
    : paused ? "Paused after a few days without a round. Turn them back on whenever you like."
    : on ? `On. One nudge around ${hourText(row.remind_hour)}, only on days you haven't played and cards are due.`
    : "One nudge a day, only on days you haven't played and cards are due. Off until you turn it on.";
  $('remind-toggle').textContent = on ? 'Turn off' : 'Turn on';
  $('remind-hour').value = String(row?.remind_hour ?? 19);
}

async function subscription() {
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
}

async function save() {
  const hour = Number($('remind-hour').value);
  const { error } = await sb.rpc('lc_set_reminder', { p_sub: (await subscription()).toJSON(), p_hour: hour, p_tz: tz() });
  if (error) throw error;
  row = { remind_hour: hour, ignored: 0 };
}

async function toggle() {
  if (row && row.ignored < 5) {
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    const { error } = await sb.rpc('lc_stop_reminder');
    if (error) throw error;
    row = null;
    return;
  }
  // First await in the tap, so iOS treats the permission prompt as user-initiated.
  if (await Notification.requestPermission() !== 'granted') return;
  await save();
}

// Runs a change with the button busy and any failure shown under it.
const act = (fn) => async () => {
  const b = $('remind-toggle');
  $('remind-error').textContent = '';
  b.disabled = true;
  try { await fn(); } catch (e) { $('remind-error').textContent = `Couldn't change reminders (${e.message || e}).`; }
  b.disabled = false;
  show();
};

export function initRemind(client, vapidKey) {
  sb = client; key = vapidKey;
  if (!key) return; // not set up on the server yet: the panel stays hidden
  $('remind-hour').replaceChildren(...Array.from({ length: 24 }, (_, h) => Object.assign(document.createElement('option'), { value: String(h), textContent: hourText(h) })));
  $('remind-toggle').addEventListener('click', act(toggle));
  $('remind-hour').addEventListener('change', act(async () => { if (row && row.ignored < 5) await save(); }));
}

// After login: show the panel in the state that fits this device.
export async function loadRemind() {
  if (!key) return;
  const card = $('remind-card');
  if (!supported()) {
    card.hidden = !iosBrowserTab(); // other browsers without Web Push just don't get the panel
    $('remind-controls').hidden = true;
    $('remind-text').textContent = 'To get a daily reminder on iPhone, add Hub to your Home Screen first: tap Share, then Add to Home Screen, and open Hub from there.';
    return;
  }
  const { data } = await sb.from('lc_push').select('remind_hour, ignored').maybeSingle();
  row = data;
  card.hidden = false;
  show();
}
