// Self-check for sql/006_reminders.sql: node sql/test-006.mjs (needs @electric-sql/pglite, like test-001.mjs).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const q = async (sql, p) => (await db.query(sql, p)).rows;
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
  CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  -- Just the tables 006 reads, as 001-003 create them.
  CREATE TABLE lc_profile (chat_id bigint PRIMARY KEY, user_id uuid, xp int DEFAULT 0, streak int DEFAULT 0, last_active date);
  CREATE TABLE lc_cards (id serial PRIMARY KEY, chat_id bigint NOT NULL, due_at timestamptz DEFAULT now());
`);
const sql = readFileSync(new URL('./006_reminders.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql); // must be re-runnable

const ME = '11111111-1111-1111-1111-111111111111', OTHER = '22222222-2222-2222-2222-222222222222';
const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };
const hourNow = (await q(`SELECT extract(hour FROM now() AT TIME ZONE 'UTC')::int AS h`))[0].h;
await db.exec(`
  INSERT INTO auth.users VALUES ('${ME}'), ('${OTHER}');
  INSERT INTO lc_profile (chat_id, user_id, streak, last_active) VALUES (1, '${ME}', 4, current_date - 1), (2, '${OTHER}', 2, current_date - 1);
  INSERT INTO lc_cards (chat_id, due_at) VALUES (1, now() - interval '1 hour'), (1, now() - interval '1 hour'), (2, now() + interval '1 day');
`);
const as = async (uid, fn) => {
  await db.exec(`SET test.uid = '${uid}'; SET ROLE authenticated;`);
  try { return await fn(); } finally { await db.exec('RESET ROLE; RESET test.uid;'); }
};
const claim = async () => { await db.exec('SET ROLE service_role;'); try { return await q('SELECT * FROM lc_claim_reminders()'); } finally { await db.exec('RESET ROLE;'); } };

// Saving: bad subscriptions and hours are refused; an unknown time zone falls back to UTC.
await as(ME, async () => {
  await assert.rejects(q('SELECT lc_set_reminder($1, 19, $2)', [{ endpoint: 'http://x' }, 'UTC']), /looks wrong/);
  await assert.rejects(q('SELECT lc_set_reminder($1, 24, $2)', [SUB, 'UTC']), /hour/);
  await q('SELECT lc_set_reminder($1, $2, $3)', [SUB, hourNow, 'Not/AZone']);
  assert.equal((await q('SELECT tz FROM lc_push'))[0].tz, 'UTC');
  await assert.rejects(q('SELECT * FROM lc_claim_reminders()'), /permission denied/, 'only the sender may claim');
});
await as(OTHER, async () => {
  await q('SELECT lc_set_reminder($1, $2, $3)', [SUB, hourNow, 'UTC']);
  assert.equal((await q('SELECT * FROM lc_push')).length, 1, 'each login sees only its own row');
});

// Claiming: ME has 2 cards due and hasn't practised today; OTHER has nothing due.
let got = await claim();
assert.deepEqual(got.map((r) => [r.user_id, r.due, r.streak, r.ignored]), [[ME, 2, 4, 0]]);
assert.equal((await claim()).length, 0, 'once a day');

// Ignored reminders count up and stop after the 5th; practising resets the count.
await db.exec(`UPDATE lc_profile SET last_active = current_date - 3 WHERE user_id = '${ME}'`);
for (let i = 1; i <= 6; i++) {
  await db.exec(`UPDATE lc_push SET last_sent = current_date - 1 WHERE user_id = '${ME}'`);
  got = await claim();
  if (i <= 5) assert.equal(got[0].ignored, i); // at 5 the sender says it's pausing
  else assert.equal(got.length, 0, 'paused after 5 ignored reminders in a row');
}
await as(ME, () => q('SELECT lc_set_reminder($1, $2, $3)', [SUB, hourNow, 'UTC'])); // turning them on again un-pauses
await db.exec(`UPDATE lc_push SET last_sent = current_date - 1 WHERE user_id = '${ME}'; UPDATE lc_profile SET last_active = current_date - 1 WHERE user_id = '${ME}'`);
assert.equal((await claim())[0].ignored, 0, 'practice since the last reminder resets the count');

// Practised today: no reminder.
await db.exec(`UPDATE lc_push SET last_sent = NULL; UPDATE lc_profile SET last_active = current_date WHERE user_id = '${ME}'`);
assert.equal((await claim()).length, 0);

await as(ME, () => q('SELECT lc_stop_reminder()'));
assert.equal((await q(`SELECT count(*)::int AS n FROM lc_push WHERE user_id = '${ME}'`))[0].n, 0);
console.log('reminder checks passed');
