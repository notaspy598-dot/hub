// Supabase Edge Function "remind": sends Hub's opt-in daily reminders over Web Push.
// Call it once an hour (n8n Schedule → HTTP Request, see README). It asks lc_claim_reminders (sql/006) who is due,
// sends each one, and forgets subscriptions the browser has thrown away.
// Needs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Supabase sets both), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (mailto: or https: contact for push services), REMIND_SECRET (any long random string).
// scripts/setup-reminders.sh installs this and writes the last four to keys.json.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// Settings come from env vars, or from this line, which scripts/setup-reminders.sh fills in on the server only
// (the runtime compiles functions elsewhere, so a keys file next to this one can't be read at run time).
const KEYS: Record<string, string> = {};
const env = (k: string) => Deno.env.get(k) || KEYS[k] || '';
webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

// Kind, short, rotated by day so the same words don't repeat. No guilt trips, no streak threats.
const LINES: ((due: number, streak: number) => [string, string])[] = [
  (d) => [`${d} ${d === 1 ? 'card is' : 'cards are'} on today's track`, 'A couple of minutes and the day is done.'],
  (d, s) => ['Today\'s track is ready', s > 1 ? `${d} to play. Day ${s + 1} of your streak is waiting.` : `${d} to play, about two minutes.`],
  (d) => ['Quick round?', `${d} ${d === 1 ? 'card is' : 'cards are'} due. Hit them while they're fresh.`],
  (d) => ['New day, new track', `${d} ${d === 1 ? 'card' : 'cards'} from your saved links.`],
  (d, s) => ['Keep the combo going', s > 1 ? `${s}-day streak. ${d} ${d === 1 ? 'card' : 'cards'} today.` : `${d} ${d === 1 ? 'card' : 'cards'} today.`],
];
const PAUSE: [string, string] = ['Pausing reminders', "These haven't been landing, so they're off for now. Turn them back on in Hub any time."];

Deno.serve(async (req) => {
  // Edge Functions may also check the Authorization JWT; this header is what proves the caller is your scheduler.
  if (!env('REMIND_SECRET') || req.headers.get('x-remind-secret') !== env('REMIND_SECRET')) return new Response('Forbidden', { status: 403 });
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data, error } = await db.rpc('lc_claim_reminders');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const day = Math.floor(Date.now() / 864e5);
  let sent = 0, gone = 0, failed = 0;
  for (const r of data ?? []) {
    const [title, body] = r.ignored >= 5 ? PAUSE : LINES[(day + sent) % LINES.length](r.due, r.streak);
    try {
      await webpush.sendNotification(r.sub, JSON.stringify({ title, body, badge: r.due, url: './#learn' }), { TTL: 4 * 3600, urgency: 'normal' });
      sent++;
    } catch (e: any) {
      // 404/410: the subscription is gone (app removed, permission revoked). Anything else: try again tomorrow.
      if (e?.statusCode === 404 || e?.statusCode === 410) { await db.from('lc_push').delete().eq('user_id', r.user_id); gone++; } else failed++;
    }
  }
  return Response.json({ sent, gone, failed });
});
