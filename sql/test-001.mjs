// Self-check for hub/sql/00*.sql against a stubbed Supabase (auth + storage).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const q = async (sql, p) => (await db.query(sql, p)).rows;

await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
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

// 008 (when passed, after 006): event log, league, challenges, quests, "Did you use it?", Go deeper, playlists, recap.
const has008 = process.argv.some((f) => f.includes('008'));
if (has008) {
  const kinds = async () => Object.fromEntries((await q('SELECT kind, sum(n)::int AS n FROM lc_events WHERE chat_id = 100 GROUP BY kind')).map((r) => [r.kind, r.n]));
  const k = await kinds();
  assert.ok(k.xp > 0 && k.day > 0 && k.review > 0, 'grading and awards are logged');
  await db.exec('UPDATE lc_cards SET box = 3, due_at = now() WHERE id = 1');
  await q('SELECT * FROM lc_grade(1, 2, 100)');
  assert.equal((await kinds()).mastered, 1, 'reaching box 4 logs mastered');
  await db.exec('UPDATE lc_cards SET box = 5 WHERE id = 1'); // box 4 to 5 is not a new mastery
  assert.equal((await kinds()).mastered, 1);

  // League: opt-in by name, unique whatever the case.
  await as(ME, async () => {
    assert.equal((await q('SELECT * FROM lc_league()')).length, 0, 'nobody named yet');
    assert.equal((await q("SELECT lc_set_name('  Ama   K ') AS n"))[0].n, 'Ama K');
    const l = await q('SELECT * FROM lc_league()');
    assert.equal(l.length, 1); assert.equal(l[0].name, 'Ama K'); assert.equal(l[0].me, true); assert.ok(l[0].xp > 0);
    await assert.rejects(q('SELECT lc_set_name($1)', ['x'.repeat(25)]), /24 characters/);
    await assert.rejects(q('SELECT * FROM lc_events'), /permission denied/);
  });
  await as(OTHER, async () => {
    await assert.rejects(q("SELECT lc_set_name('ama k')"), /already has that name/);
    await assert.rejects(q("SELECT lc_challenge('Ama K', ARRAY[1,2], 5)"), /league name first/);
    await q("SELECT lc_set_name('Bo')");
    assert.deepEqual((await q('SELECT name, me FROM lc_league()')).map((r) => [r.name, r.me]), [['Ama K', false], ['Bo', true]]);
    await assert.rejects(q("SELECT lc_challenge('Ama K', ARRAY[1,2], 5)"), /Not enough cards/, 'cannot send cards that are not mine');
  });

  // Challenge: the receiver plays only that challenge's cards, once.
  const cid = await as(ME, async () => {
    await assert.rejects(q("SELECT lc_challenge('Ama K', ARRAY[1,2], 5)"), /other than yourself/);
    await assert.rejects(q("SELECT lc_challenge('Nobody', ARRAY[1,2], 5)"), /No one/);
    return (await q("SELECT lc_challenge('bo', ARRAY[1,2,3,2], 999) AS id"))[0].id;
  });
  assert.deepEqual((await q('SELECT cards, score FROM lc_challenges WHERE id = $1', [cid]))[0], { cards: [1, 2], score: 200 }, 'own cards only, score capped');
  await as(ME, async () => { assert.equal((await q('SELECT * FROM lc_challenge_cards($1)', [cid])).length, 0, 'the sender cannot open it'); });
  await as(OTHER, async () => {
    assert.deepEqual((await q('SELECT id FROM lc_challenge_cards($1) ORDER BY id', [cid])).map((r) => r.id), [1, 2]);
    const [c] = await q('SELECT * FROM lc_my_challenges()');
    assert.deepEqual([c.incoming, c.other, c.score, c.their_score], [true, 'Ama K', 200, null]);
    const [f] = await q('SELECT * FROM lc_finish_challenge($1, 12)', [cid]);
    assert.deepEqual([f.score, f.their_score, f.other], [200, 12, 'Ama K']);
    await assert.rejects(q('SELECT * FROM lc_finish_challenge($1, 13)', [cid]), /already played/);
    assert.equal((await q('SELECT * FROM lc_challenge_cards($1)', [cid])).length, 0);
  });
  await as(ME, async () => {
    const [c] = await q('SELECT * FROM lc_my_challenges()');
    assert.deepEqual([c.incoming, c.other, c.their_score], [false, 'Bo', 12]);
  });

  // Quests: three a week; a claim needs the goal reached and works once.
  const qs = await as(ME, () => q('SELECT * FROM lc_quests()'));
  assert.equal(qs.length, 3);
  const KIND = { days: 'day', xp: 'xp', mastered: 'mastered', review: 'review' };
  const target = qs.find((x) => KIND[x.quest]);
  await as(ME, async () => {
    await assert.rejects(q("SELECT lc_claim_quest('nope')"), /this week/);
    if (target.progress < target.goal) await assert.rejects(q('SELECT lc_claim_quest($1)', [target.quest]), /Not done yet/);
  });
  const big = target.quest === 'xp';
  await q(`INSERT INTO lc_events (chat_id, kind, n) SELECT 100, $1, ${big ? 250 : 1} FROM generate_series(1, ${big ? 1 : target.goal})`, [KIND[target.quest]]);
  await as(ME, async () => {
    const xp = (await q('SELECT xp FROM lc_profile'))[0].xp;
    assert.equal((await q('SELECT lc_claim_quest($1) AS x', [target.quest]))[0].x, target.xp);
    assert.equal((await q('SELECT xp FROM lc_profile'))[0].xp, xp + target.xp);
    await assert.rejects(q('SELECT lc_claim_quest($1)', [target.quest]), /Already claimed/);
    assert.equal((await q('SELECT claimed FROM lc_quests() WHERE quest = $1', [target.quest]))[0].claimed, true);
  });

  // "Did you use it?": one idea a day from a link studied at least a day ago; a yes is 5 XP.
  const sid = (await q(`INSERT INTO lc_sources (chat_id, url, title, status, key_ideas, studied_at) VALUES
    (100, 'https://x/y', 'T', 'ready', '[{"point":"P1","explain":"e"},{"point":"P2","explain":"e"}]', now() - interval '2 days') RETURNING id`))[0].id;
  await as(ME, async () => {
    const [u] = await q('SELECT * FROM lc_use_prompt()');
    assert.deepEqual([u.source_id, u.idea, u.point], [sid, 0, 'P1']);
    await assert.rejects(q('SELECT lc_answer_use($1, 1, true)', [sid]), /isn't up today/);
    const xp = (await q('SELECT xp FROM lc_profile'))[0].xp;
    assert.equal((await q('SELECT lc_answer_use($1, 0, true) AS x', [sid]))[0].x, 5);
    assert.equal((await q('SELECT xp FROM lc_profile'))[0].xp, xp + 5);
    assert.equal((await q('SELECT * FROM lc_use_prompt()')).length, 0, 'once a day');
  });
  await db.exec("UPDATE lc_applied SET at = now() - interval '1 day'");
  await as(ME, async () => { assert.equal((await q('SELECT idea FROM lc_use_prompt()'))[0].idea, 1, 'tomorrow, the next idea'); });
  await as(OTHER, async () => {
    assert.equal((await q('SELECT * FROM lc_use_prompt()')).length, 0);
    await q('SELECT lc_studied($1)', [sid]); // not theirs: no effect
  });
  await as(ME, async () => {
    const [w] = await q('SELECT * FROM lc_my_week()');
    assert.deepEqual([w.used, w.name, w.players], [1, 'Ama K', 2]);
    assert.ok(w.place >= 1);
  });

  // Go deeper: your own skill, one at a time, 3 a day.
  await as(OTHER, async () => { await assert.rejects(q("SELECT lc_go_deeper('s')"), /isn't one of your skills/); });
  const readyDeeper = () => db.exec("UPDATE lc_sources SET status = 'ready' WHERE url = 'hub:deeper'");
  const d = await as(ME, async () => {
    await assert.rejects(q("SELECT lc_go_deeper('nope')"), /isn't one of your skills/);
    const id = (await q("SELECT lc_go_deeper('s') AS id"))[0].id;
    await assert.rejects(q("SELECT lc_go_deeper('s')"), /Already going deeper/);
    return id;
  });
  assert.deepEqual((await q('SELECT url, skill, title, status FROM lc_sources WHERE id = $1', [d]))[0], { url: 'hub:deeper', skill: 's', title: 'Deeper: s', status: 'queued' });
  for (let i = 0; i < 2; i++) { await readyDeeper(); await as(ME, () => q("SELECT lc_go_deeper('s')")); }
  await readyDeeper();
  await as(ME, async () => { await assert.rejects(q("SELECT lc_go_deeper('s')"), /3 deeper rounds/); });

  // Playlists: one video a day, skipping any already added by hand; they don't count as links you added.
  const pl = (await q("INSERT INTO lc_sources (chat_id, url, status, platform) VALUES (100, 'https://www.youtube.com/playlist?list=X', 'ready', 'playlist') RETURNING id"))[0].id;
  await q("INSERT INTO lc_queue (chat_id, playlist_id, url, title, pos) VALUES (100, $1, 'https://x/y', 'dup', 0), (100, $1, 'https://youtu.be/a', 'A', 1), (100, $1, 'https://youtu.be/b', 'B', 2)", [pl]);
  const drip = () => as(ME, async () => (await q('SELECT lc_drip() AS id'))[0].id);
  const links = () => as(ME, async () => (await q('SELECT links FROM lc_my_week()'))[0].links);
  const before = await links();
  const d1 = await drip();
  assert.deepEqual((await q('SELECT url, title, status FROM lc_sources WHERE id = $1', [d1]))[0], { url: 'https://youtu.be/a', title: 'A', status: 'queued' });
  assert.equal(await drip(), null, 'one a day');
  await db.exec("UPDATE lc_queue SET released_at = released_at - interval '1 day'");
  assert.equal((await q('SELECT url FROM lc_sources WHERE id = $1', [await drip()]))[0].url, 'https://youtu.be/b');
  await db.exec("UPDATE lc_queue SET released_at = released_at - interval '1 day'");
  assert.equal(await drip(), null, 'nothing left');
  assert.equal(await links(), before, 'playlist videos are not links you added');
  await as(OTHER, async () => { assert.equal((await q('SELECT lc_drip() AS id'))[0].id, null, 'not my queue'); });

  // Recap: needs a time zone where it's Sunday right now, so it only runs when there is one.
  const sunday = (await q("SELECT name, extract(hour FROM now() AT TIME ZONE name)::int AS h FROM pg_timezone_names WHERE extract(dow FROM now() AT TIME ZONE name) = 0 LIMIT 1"))[0];
  if (sunday) {
    await as(ME, () => q('SELECT lc_set_reminder($1, $2, $3)', [{ endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } }, sunday.h, sunday.name]));
    const recap = async () => { await db.exec('SET ROLE service_role;'); try { return await q('SELECT * FROM lc_claim_recaps()'); } finally { await db.exec('RESET ROLE;'); } };
    const [r] = await recap();
    assert.equal(r.user_id, ME); assert.ok(r.xp > 0); assert.equal(r.used, 1); assert.equal(r.players, 2); assert.ok(r.place >= 1);
    assert.equal((await recap()).length, 0, 'once a week');
    assert.equal((await q('SELECT ignored FROM lc_push'))[0].ignored, 0, 'recaps never count toward pausing');
    await as(ME, async () => { await assert.rejects(q('SELECT * FROM lc_claim_recaps()'), /permission denied/); });
  } else console.log('recap check skipped: no time zone is on Sunday right now');
}

// 009 (when passed, after 008): flag, archive, daily goal, best streak, activity, lifetime totals, starter deck.
const has009 = process.argv.some((f) => f.includes('009'));
if (has009) {
  await db.exec('UPDATE lc_cards SET due_at = now() WHERE chat_id = 100');
  await as(ME, async () => {
    const n = (await q('SELECT id FROM lc_cards')).length;
    await q('SELECT lc_flag_card(2)');
    assert.equal((await q('SELECT id FROM lc_cards')).length, n - 1, 'a flagged card leaves the page');
    assert.equal((await q('SELECT * FROM lc_grade_mine(2, 0)')).length, 0, 'and is never graded');
    await assert.rejects(q('SELECT lc_flag_card(2)'), /isn't one of yours/, 'once');
    await assert.rejects(q('SELECT lc_flag_card(3)'), /isn't one of yours/);
  });
  assert.equal((await q("SELECT count(*)::int AS n FROM lc_cards WHERE chat_id = 100 AND due_at <= now() AND hidden IS NOT NULL"))[0].n, 0, 'hidden cards are never due');

  // Archive: the link stays readable for History, its cards go, late cards from n8n are hidden too, Restore brings them back.
  const src = (await q("INSERT INTO lc_sources (chat_id, url, status, title) VALUES (100, 'https://x/arch', 'ready', 'A') RETURNING id"))[0].id;
  const card = (sql) => q(`INSERT INTO lc_cards (source_id, chat_id, question, options, answer) VALUES ($1, 100, '${sql}', '["a","b"]', 0)`, [src]);
  await card('qa');
  const mine = () => as(ME, async () => (await q('SELECT count(*)::int AS n FROM lc_cards WHERE source_id = $1', [src]))[0].n);
  assert.equal(await mine(), 1);
  await as(OTHER, async () => { await assert.rejects(q('SELECT lc_archive_link($1)', [src]), /isn't one of yours/); });
  await as(ME, async () => {
    await q('SELECT lc_archive_link($1)', [src]);
    await assert.rejects(q('SELECT lc_archive_link($1)', [src]), /already archived/);
    assert.ok((await q('SELECT archived_at FROM lc_sources WHERE id = $1', [src]))[0].archived_at, 'History still sees it');
  });
  assert.equal(await mine(), 0, 'its cards are hidden');
  await card('late');
  assert.equal((await q("SELECT hidden FROM lc_cards WHERE question = 'late'"))[0].hidden, 'archived', 'late cards arrive hidden');
  await as(OTHER, async () => { await assert.rejects(q('SELECT lc_restore_link($1)', [src]), /isn't archived/); });
  await as(ME, async () => { await q('SELECT lc_restore_link($1)', [src]); });
  assert.equal(await mine(), 2, 'Restore brings both back');
  assert.equal((await q("SELECT hidden FROM lc_cards WHERE id = 2"))[0].hidden, 'flagged', 'a flagged card stays flagged');

  await as(ME, async () => {
    await q('SELECT lc_set_goal(20)');
    assert.equal((await q('SELECT daily_goal FROM lc_profile'))[0].daily_goal, 20);
    await assert.rejects(q('SELECT lc_set_goal(7)'), /5, 10 or 20/);
  });

  await db.exec('UPDATE lc_profile SET streak = 50 WHERE chat_id = 100; UPDATE lc_profile SET streak = 2 WHERE chat_id = 100;');
  await as(ME, async () => {
    assert.equal((await q('SELECT best_streak FROM lc_profile'))[0].best_streak, 50, 'best streak survives a reset');
    const today = (await q('SELECT * FROM lc_activity()')).at(-1);
    assert.equal(today.day.toISOString().slice(0, 10), (await q("SELECT ((now() AT TIME ZONE 'UTC')::date)::text AS d"))[0].d);
    assert.ok(today.xp > 0); assert.equal(today.played, true);
    const [life] = await q('SELECT * FROM lc_lifetime()');
    assert.deepEqual([life.best_streak, life.used, life.won], [50, 1, 1], 'Bo scored 12 against 200');
    assert.ok(life.mastered >= 1 && life.links >= 1 && life.xp > 0);
  });

  // Starter deck: only for someone with no links at all, once.
  const NEW = '33333333-3333-3333-3333-333333333333';
  await db.exec(`INSERT INTO auth.users VALUES ('${NEW}', 'new@x')`);
  await as(OTHER, async () => { assert.equal((await q('SELECT lc_starter_deck() AS id'))[0].id, null, 'already has links'); });
  await as(NEW, async () => {
    await q('SELECT lc_link_me()');
    const id = (await q('SELECT lc_starter_deck() AS id'))[0].id;
    assert.ok(id);
    assert.equal((await q('SELECT lc_starter_deck() AS id'))[0].id, null, 'once');
    const due = await q('SELECT options, answer FROM lc_cards WHERE due_at <= now()');
    assert.equal(due.length, 8);
    assert.ok(due.every((c) => c.options.length === 4 && c.answer >= 0 && c.answer < 4));
    const [s] = await q('SELECT key_ideas, status, transcript FROM lc_sources');
    assert.equal(s.status, 'ready'); assert.equal(s.key_ideas.length, 7); assert.ok(s.transcript.includes('Space it out'));
  });
}

await db.exec('SET ROLE anon;');
await assert.rejects(q('SELECT * FROM lc_cards'), /permission denied/);
if (has009) for (const f of ['lc_flag_card(1)', 'lc_archive_link(1)', 'lc_restore_link(1)', 'lc_set_goal(5)', 'lc_activity()', 'lc_lifetime()', 'lc_starter_deck()'])
  await assert.rejects(q(`SELECT * FROM ${f}`), /permission denied/);
await assert.rejects(q('SELECT * FROM lc_grade_mine(1, 1)'), /permission denied/);
await assert.rejects(q('SELECT * FROM lc_award_mine(1, true)'), /permission denied/);
await assert.rejects(q("SELECT lc_add_link('https://example.com')"), /permission denied/);
await assert.rejects(q('SELECT lc_request_lesson(1)'), /permission denied/);
if (has008) for (const f of ['lc_league()', 'lc_quests()', 'lc_drip()', "lc_go_deeper('s')", 'lc_my_challenges()', 'lc_use_prompt()'])
  await assert.rejects(q(`SELECT * FROM ${f}`), /permission denied/);
await db.exec('RESET ROLE;');

assert.equal((await q("SELECT count(*)::int AS n FROM storage.buckets WHERE id = 'style-images' AND NOT public"))[0].n, 1);
console.log('all checks passed');
