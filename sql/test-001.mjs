// Self-check for hub/sql/00*.sql against a stubbed Supabase (auth + storage).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const q = async (sql, p) => (await db.query(sql, p)).rows;

await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id serial PRIMARY KEY, bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  GRANT USAGE ON SCHEMA storage TO authenticated; GRANT ALL ON storage.objects TO authenticated; GRANT USAGE ON SEQUENCE storage.objects_id_seq TO authenticated;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
`);

for (const file of process.argv.slice(2)) {
  const sql = readFileSync(file, 'utf8');
  await db.exec(sql);
  await db.exec(sql); // must be re-runnable
}

const ME = '11111111-1111-1111-1111-111111111111', OTHER = '22222222-2222-2222-2222-222222222222';
await db.exec(`
  INSERT INTO auth.users VALUES ('${ME}', 'me@x'), ('${OTHER}', 'other@x');
  INSERT INTO lc_profile (chat_id) VALUES (200);
  INSERT INTO lc_cards (chat_id, skill, question, options, answer, explanation) VALUES
    (100, 's', 'q1', '["a","b","c","d"]', 2, 'e1'),
    (100, 's', 'q2', '["a","b","c","d"]', 0, 'e2'),
    (200, 's', 'theirs', '["a","b","c","d"]', 1, 'e3');
`);

const as = async (uid, fn) => {
  await db.exec(`SET test.uid = '${uid}'; SET ROLE authenticated;`);
  try { return await fn(); } finally { await db.exec('RESET ROLE; RESET test.uid;'); }
};

// Linking: my first login claims chat 100 (no profile yet); nobody can take a claimed chat or move a link.
await as(ME, async () => {
  assert.equal((await q('SELECT lc_link_me(100) AS ok'))[0].ok, true);
  assert.equal((await q('SELECT lc_link_me(999) AS ok'))[0].ok, true, 'already linked: no-op');
});
assert.deepEqual((await q('SELECT chat_id::int AS c FROM lc_profile WHERE user_id IS NOT NULL')).map(r => r.c), [100]);
await db.exec('SET ROLE anon;');
await assert.rejects(q('SELECT lc_link_me(200)'), /permission denied/);
await db.exec('RESET ROLE;');

// Bot path (n8n's role bypasses RLS): grade card 1 correctly for chat 100.
let [g] = await q('SELECT * FROM lc_grade(1, 2, 100)');
assert.equal(g.is_correct, true); assert.equal(g.answer_text, 'c'); assert.equal(g.new_xp, 10); assert.equal(g.new_streak, 1);
assert.equal((await q('SELECT box FROM lc_cards WHERE id = 1'))[0].box, 1);
assert.equal((await q('SELECT * FROM lc_grade(1, 2, 100)')).length, 0, 'not due any more');
assert.equal((await q('SELECT * FROM lc_grade(3, 1, 100)')).length, 0, 'other chat card');

// The exact query the n8n "Grade Answer" node runs (card 3, wrong answer, chat 200).
const [bot] = await q(`SELECT g.is_correct AS correct, format(E'%s\\n\\n%s <b>%s</b>\\n%s\\n\\n🔥 %s-day streak · ⭐ %s XP', lc_esc(g.q_text), CASE WHEN g.is_correct THEN '✅ Correct:' ELSE '❌ Answer:' END, lc_esc(g.answer_text), lc_esc(g.expl), g.new_streak, g.new_xp) AS result_msg
FROM lc_grade($1::int, $2::int, $3::bigint) g;`, [3, 0, 200]);
assert.equal(bot.correct, false);
assert.equal(bot.result_msg, 'theirs\n\n❌ Answer: <b>b</b>\ne3\n\n🔥 1-day streak · ⭐ 2 XP');

await as(ME, async () => {
  assert.deepEqual((await q('SELECT chat_id FROM lc_profile')).map(r => Number(r.chat_id)), [100]);
  assert.equal((await q('SELECT id FROM lc_cards')).length, 2, 'only my cards');
  const [w] = await q('SELECT * FROM lc_grade_mine(2, 3)');
  assert.equal(w.is_correct, false); assert.equal(w.new_xp, 12);
  assert.equal((await q('SELECT * FROM lc_grade_mine(3, 1)')).length, 0, 'cannot grade others');
  await assert.rejects(q('SELECT * FROM lc_grade(3, 1, 200)'), /permission denied/);
  await assert.rejects(q('UPDATE lc_profile SET xp = 9999'), /permission denied/);
  await q(`INSERT INTO style_items (path) VALUES ('${ME}/a.jpg')`);
  assert.equal((await q('SELECT user_id FROM style_items'))[0].user_id, ME);
  await assert.rejects(q(`INSERT INTO style_items (path, user_id) VALUES ('x', '${OTHER}')`), /row-level security/);
  await q(`INSERT INTO storage.objects (bucket_id, name) VALUES ('style-images', '${ME}/a.jpg')`);
  await assert.rejects(q(`INSERT INTO storage.objects (bucket_id, name) VALUES ('style-images', '${OTHER}/a.jpg')`), /row-level security/);

  // Phase 2: games give XP only; finishing the Starter also counts the day. Neither touches the schedule.
  const before = await q('SELECT box, due_at FROM lc_cards ORDER BY id');
  let [a] = await q('SELECT * FROM lc_award_mine(5, false)');
  assert.deepEqual([a.new_xp, a.new_streak], [17, 1]);
  [a] = await q('SELECT * FROM lc_award_mine(9999, false)');
  assert.equal(a.new_xp, 117, 'capped at 100 per call');
  [a] = await q('SELECT * FROM lc_award_mine(-50, false)');
  assert.equal(a.new_xp, 117, 'no negative XP');
  assert.deepEqual(await q('SELECT box, due_at FROM lc_cards ORDER BY id'), before, 'schedule untouched');
});
await db.exec("UPDATE lc_profile SET last_active = current_date - 1, streak = 4 WHERE chat_id = 100");
await as(ME, async () => {
  let [a] = await q('SELECT * FROM lc_award_mine(0, false)');
  assert.equal(a.new_streak, 4, 'a game alone does not count the day');
  [a] = await q('SELECT * FROM lc_award_mine(10, true)');
  assert.equal(a.new_streak, 5, 'finishing the Starter does');
  [a] = await q('SELECT * FROM lc_award_mine(10, true)');
  assert.equal(a.new_streak, 5, 'only once per day');
});

// 007 (when passed): a missed day uses a freeze instead of resetting; one is earned every 7 days, at most 2.
if (process.argv.some((f) => f.includes('007'))) {
  const day = async (sets) => {
    await db.exec(`UPDATE lc_profile SET ${sets} WHERE chat_id = 100`);
    return as(ME, async () => (await q('SELECT * FROM lc_award_mine(0, true)'))[0]);
  };
  let a = await day('last_active = current_date - 2, streak = 4, freezes = 1');
  assert.deepEqual([a.new_streak, a.freezes, a.saved, a.earned], [5, 0, true, false], 'one missed day, one freeze: streak kept');
  a = await day('last_active = current_date - 2, streak = 5, freezes = 0, freeze_used_on = NULL');
  assert.deepEqual([a.new_streak, a.freezes, a.saved], [1, 0, false], 'no freeze left: back to 1');
  a = await day('last_active = current_date - 3, streak = 9, freezes = 1');
  assert.deepEqual([a.new_streak, a.freezes], [1, 1], 'two missed days, one freeze: reset, freeze kept');
  a = await day('last_active = current_date - 3, streak = 9, freezes = 2');
  assert.deepEqual([a.new_streak, a.freezes, a.saved], [10, 0, true], 'two missed days, two freezes');
  a = await day('last_active = current_date - 1, streak = 6, freezes = 1, freeze_earned_on = NULL');
  assert.deepEqual([a.new_streak, a.freezes, a.earned], [7, 2, true], 'day 7 earns one');
  a = await day('last_active = current_date - 1, streak = 13, freezes = 2, freeze_earned_on = NULL');
  assert.deepEqual([a.new_streak, a.freezes, a.earned], [14, 2, false], 'never more than 2');
  // The bot path shares the rule: grading a due card after a missed day uses the freeze too.
  await db.exec("UPDATE lc_profile SET last_active = current_date - 2, streak = 3, freezes = 1 WHERE chat_id = 100; UPDATE lc_cards SET due_at = now() WHERE id = 1");
  assert.equal((await q('SELECT * FROM lc_grade(1, 2, 100)'))[0].new_streak, 4);
  assert.equal((await q('SELECT freezes FROM lc_profile WHERE chat_id = 100'))[0].freezes, 0);
}
await as(OTHER, async () => {
  assert.equal((await q('SELECT * FROM lc_award_mine(10, true)')).length, 0, 'unlinked: nothing to award');
});

// 003: a login without Telegram gets its own learner (a negative ID), even if it asks for a chat that's taken.
await as(OTHER, async () => {
  assert.equal((await q('SELECT lc_link_me(100) AS ok'))[0].ok, true);
  assert.equal((await q('SELECT lc_link_me() AS ok'))[0].ok, true, 'second call is a no-op');
  const mine = await q('SELECT chat_id FROM lc_profile');
  assert.equal(mine.length, 1); assert.ok(Number(mine[0].chat_id) < 0, 'web-only learner ID');
  assert.equal((await q('SELECT id FROM lc_cards')).length, 0, 'still none of my cards');
  const id = (await q("SELECT lc_add_link('  https://example.com/a  ') AS id"))[0].id;
  const [src] = await q('SELECT url, status, chat_id FROM lc_sources WHERE id = $1', [id]);
  assert.deepEqual([src.url, src.status, src.chat_id], ['https://example.com/a', 'queued', mine[0].chat_id]);
  await assert.rejects(q("SELECT lc_add_link('javascript:alert(1)')"), /look like a link/);
  await assert.rejects(q("SELECT lc_add_link('https://a b')"), /look like a link/);
  await assert.rejects(q("INSERT INTO lc_sources (chat_id, url) VALUES (1, 'x')"), /permission denied/);
});
await as(ME, async () => {
  assert.equal((await q('SELECT id FROM lc_sources')).length, 0, 'cannot see their links');
});
await as(OTHER, async () => {
  for (let i = 1; i < 20; i++) await q("SELECT lc_add_link('https://example.com/b')");
  await assert.rejects(q("SELECT lc_add_link('https://example.com/c')"), /20 links this hour/);
});

// 005: a lesson is built only when asked, for your own link once its cards exist (n8n saves the transcript with them).
const [l1, l2, l3] = (await q("SELECT id FROM lc_sources WHERE url = 'https://example.com/b' ORDER BY id LIMIT 3")).map(r => r.id);
await db.exec(`UPDATE lc_sources SET status = 'ready', transcript = 't' WHERE id IN (${l1}, ${l2});
  UPDATE lc_sources SET status = 'failed', transcript = 't', lesson_url = 'https://old/part' WHERE id = ${l3};`);
await as(ME, async () => {
  await assert.rejects(q('SELECT lc_request_lesson($1)', [l1]), /already built or on its way/, 'not my link');
});
await as(OTHER, async () => {
  await q('SELECT lc_request_lesson($1)', [l1]);
  await assert.rejects(q('SELECT lc_request_lesson($1)', [l1]), /already built or on its way/, 'already queued');
  const queued = (await q("SELECT id FROM lc_sources WHERE status = 'queued' LIMIT 1"))[0].id;
  await assert.rejects(q('SELECT lc_request_lesson($1)', [queued]), /already built or on its way/, 'no cards yet');
  await q('SELECT lc_request_lesson($1)', [l3]);
});
assert.deepEqual(await q(`SELECT status, lesson_url, lesson_requested_at IS NOT NULL AS asked FROM lc_sources WHERE id IN (${l1}, ${l3}) ORDER BY id`),
  [{ status: 'lesson_queued', lesson_url: null, asked: true }, { status: 'lesson_queued', lesson_url: null, asked: true }], 'a failed lesson can be retried');
await db.exec(`UPDATE lc_sources SET status = 'generating', lesson_requested_at = now() - interval '3 hours' WHERE id = ${l1}`);
await as(OTHER, async () => { await q('SELECT lc_request_lesson($1)', [l1]); }); // stuck: retry allowed
await db.exec(`UPDATE lc_sources SET lesson_requested_at = now() WHERE url = 'https://example.com/b'`);
await as(OTHER, async () => {
  await assert.rejects(q('SELECT lc_request_lesson($1)', [l2]), /10 lessons today/);
});

await as(OTHER, async () => {
  assert.equal((await q('SELECT id FROM lc_cards')).length, 0, 'other user sees none of my cards');
  assert.equal((await q('SELECT id FROM style_items')).length, 0, 'cannot see my images');
  assert.equal((await q('SELECT id FROM storage.objects')).length, 0);
});

await db.exec('SET ROLE anon;');
await assert.rejects(q('SELECT * FROM lc_cards'), /permission denied/);
await assert.rejects(q('SELECT * FROM lc_grade_mine(1, 1)'), /permission denied/);
await assert.rejects(q('SELECT * FROM lc_award_mine(1, true)'), /permission denied/);
await assert.rejects(q("SELECT lc_add_link('https://example.com')"), /permission denied/);
await assert.rejects(q('SELECT lc_request_lesson(1)'), /permission denied/);
await db.exec('RESET ROLE;');

assert.equal((await q("SELECT count(*)::int AS n FROM storage.buckets WHERE id = 'style-images' AND NOT public"))[0].n, 1);
console.log('all checks passed');
