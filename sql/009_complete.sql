-- Hub: flag a bad card, archive a link, a daily goal, the activity grid, trophies and a starter deck for new people.
-- Run after 001-008 in Supabase Studio → SQL Editor. Safe to run again.
-- It replaces 001's lc_cards policy and 008's lc_use_prompt and lc_drip: if you re-run 001 or 008 later, run this again after.

-- A hidden card ('flagged' by you, or 'archived' with its link) is gone from the page and never due again:
-- due_at 'infinity' keeps it out of lc_grade, the reminders' due count and the bot without changing them.
ALTER TABLE lc_cards ADD COLUMN IF NOT EXISTS hidden text CHECK (hidden IN ('flagged', 'archived'));
ALTER TABLE lc_sources ADD COLUMN IF NOT EXISTS archived_at timestamptz;
DROP POLICY IF EXISTS lc_cards_own ON lc_cards;
CREATE POLICY lc_cards_own ON lc_cards FOR SELECT TO authenticated USING (chat_id = (SELECT lc_my_chat()) AND hidden IS NULL);

-- A wrong or confusing card: it stops coming back. The row stays, so the owner can look at flagged cards in Studio.
CREATE OR REPLACE FUNCTION lc_flag_card(p_card int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  UPDATE lc_cards SET hidden = 'flagged', due_at = 'infinity' WHERE id = p_card AND chat_id = lc_my_chat() AND hidden IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That card isn''t one of yours'; END IF;
END $f$;

-- Archive a link: it leaves Today and its cards stop coming back. History keeps it, with Restore.
CREATE OR REPLACE FUNCTION lc_archive_link(p_id int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  UPDATE lc_sources SET archived_at = now() WHERE id = p_id AND chat_id = lc_my_chat() AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That link isn''t one of yours, or it''s already archived'; END IF;
  UPDATE lc_cards SET hidden = 'archived', due_at = 'infinity' WHERE source_id = p_id AND hidden IS NULL;
END $f$;

-- shortcut: restored cards are all due now (their old dates aren't kept); keep the old due_at if that floods anyone.
CREATE OR REPLACE FUNCTION lc_restore_link(p_id int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  UPDATE lc_sources SET archived_at = NULL WHERE id = p_id AND chat_id = lc_my_chat() AND archived_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That link isn''t archived'; END IF;
  UPDATE lc_cards SET hidden = NULL, due_at = now() WHERE source_id = p_id AND hidden = 'archived';
END $f$;

-- Cards n8n writes for a link archived while it was still being read are hidden from the start.
CREATE OR REPLACE FUNCTION lc_hide_archived() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  IF EXISTS (SELECT 1 FROM lc_sources WHERE id = NEW.source_id AND archived_at IS NOT NULL) THEN
    NEW.hidden := 'archived'; NEW.due_at := 'infinity';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS lc_hide_archived ON lc_cards;
CREATE TRIGGER lc_hide_archived BEFORE INSERT ON lc_cards FOR EACH ROW EXECUTE FUNCTION lc_hide_archived();

-- 008's "Did you use it?", now skipping archived links. Unchanged otherwise.
CREATE OR REPLACE FUNCTION lc_use_prompt()
RETURNS TABLE (source_id int, idea int, point text, title text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT s.id, (i.ord - 1)::int, i.k->>'point', s.title
  FROM lc_sources s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.key_ideas) = 'array' THEN s.key_ideas ELSE '[]' END) WITH ORDINALITY i(k, ord)
  WHERE s.chat_id = lc_my_chat() AND s.studied_at <= now() - interval '1 day' AND coalesce(i.k->>'point', '') <> '' AND s.archived_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM lc_applied a WHERE a.source_id = s.id AND a.idea = i.ord - 1)
    AND NOT EXISTS (SELECT 1 FROM lc_applied a WHERE a.chat_id = s.chat_id AND a.at::date = current_date)
  ORDER BY s.studied_at DESC, i.ord
  LIMIT 1
$f$;

-- 008's playlist drip, now stopping for an archived playlist. Unchanged otherwise.
CREATE OR REPLACE FUNCTION lc_drip() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_me bigint := lc_my_chat(); q record; v_id int;
BEGIN
  IF v_me IS NULL OR EXISTS (SELECT 1 FROM lc_queue WHERE chat_id = v_me AND released_at::date = current_date) THEN RETURN NULL; END IF;
  SELECT * INTO q FROM lc_queue l WHERE l.chat_id = v_me AND l.released_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM lc_sources s WHERE s.chat_id = v_me AND s.url = l.url) -- already added by hand
    AND NOT EXISTS (SELECT 1 FROM lc_sources p WHERE p.id = l.playlist_id AND p.archived_at IS NOT NULL)
  ORDER BY l.playlist_id, l.pos LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO lc_sources (chat_id, url, title, status) VALUES (v_me, q.url, q.title, 'queued') RETURNING id INTO v_id;
  UPDATE lc_queue SET released_at = now(), source_id = v_id WHERE id = q.id;
  RETURN v_id;
END $f$;

-- Daily goal: how many due cards the Starter takes. Same XP and streak whatever the size.
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS daily_goal smallint NOT NULL DEFAULT 10;
CREATE OR REPLACE FUNCTION lc_set_goal(p_goal int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  IF p_goal IS NULL OR p_goal NOT IN (5, 10, 20) THEN RAISE EXCEPTION 'Pick 5, 10 or 20 cards a day'; END IF;
  UPDATE lc_profile SET daily_goal = p_goal WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Not signed in'; END IF;
END $f$;

-- Best streak ever, for the trophies. Kept by a trigger, so lc_grade and lc_award_mine stay as they are.
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS best_streak int NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION lc_keep_best() RETURNS trigger
LANGUAGE plpgsql AS $f$
BEGIN
  NEW.best_streak := GREATEST(coalesce(NEW.best_streak, 0), coalesce(NEW.streak, 0));
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS lc_keep_best ON lc_profile;
CREATE TRIGGER lc_keep_best BEFORE INSERT OR UPDATE ON lc_profile FOR EACH ROW EXECUTE FUNCTION lc_keep_best();
UPDATE lc_profile SET best_streak = streak WHERE best_streak < coalesce(streak, 0);
REVOKE ALL ON FUNCTION lc_keep_best(), lc_hide_archived() FROM PUBLIC, anon, authenticated;

-- The activity grid: XP and whether the day counted for the streak, per UTC day, from 008's log.
CREATE OR REPLACE FUNCTION lc_activity(p_days int DEFAULT 84)
RETURNS TABLE (day date, xp int, played boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT (at AT TIME ZONE 'UTC')::date, coalesce(sum(n) FILTER (WHERE kind = 'xp'), 0)::int, bool_or(kind = 'day')
  FROM lc_events
  WHERE chat_id = lc_my_chat()
    AND at >= ((now() AT TIME ZONE 'UTC')::date - LEAST(GREATEST(coalesce(p_days, 84), 1), 400))::timestamp AT TIME ZONE 'UTC'
  GROUP BY 1 ORDER BY 1
$f$;

-- Lifetime totals the trophies are earned from. The page decides the tiers.
CREATE OR REPLACE FUNCTION lc_lifetime()
RETURNS TABLE (best_streak int, xp int, mastered int, links int, used int, won int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT p.best_streak, p.xp,
    -- Cards mastered before 008's log existed only show as box 4+ now.
    GREATEST((SELECT count(*) FROM lc_events e WHERE e.chat_id = p.chat_id AND e.kind = 'mastered'),
             (SELECT count(*) FROM lc_cards c WHERE c.chat_id = p.chat_id AND c.box >= 4))::int,
    (SELECT count(*) FROM lc_sources s WHERE s.chat_id = p.chat_id AND s.url ~ '^https?://')::int,
    (SELECT count(*) FROM lc_applied a WHERE a.chat_id = p.chat_id AND a.used)::int,
    (SELECT count(*) FROM lc_challenges c WHERE (c.to_chat = p.chat_id AND c.their_score > c.score)
                                             OR (c.from_chat = p.chat_id AND c.their_score < c.score))::int
  FROM lc_profile p WHERE p.user_id = auth.uid()
$f$;

-- Starter deck: someone with no links at all gets "How Hub works", so day one has a track to play.
-- Its key ideas double as the transcript, so Build lesson works on it too. Returns the new link's id, or null.
CREATE OR REPLACE FUNCTION lc_starter_deck() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_me bigint := lc_my_chat(); v_id int; v_ideas jsonb := $j$[
  {"point": "Test yourself instead of rereading", "explain": "Pulling an answer out of memory is one of the two most effective ways to study. Rereading feels productive but barely helps."},
  {"point": "Space it out", "explain": "Each card comes back after 1, 2, 4, 8, 16 and 32 days. Growing gaps beat cramming."},
  {"point": "Recall before you recognise", "explain": "Think of the answer before the options appear. Producing it from memory makes it stick better than picking it from a list."},
  {"point": "Relearn until it's right", "explain": "A card you miss comes back in the same session until you get it right, then again on later days."},
  {"point": "Mix your topics", "explain": "Shuffling topics in a session, called interleaving, helps you tell similar ideas apart."},
  {"point": "Confident mistakes are the easiest to fix", "explain": "When you were sure and still wrong, the correction sticks best. Hub points those out."},
  {"point": "Explain it in your own words", "explain": "After a miss, saying why the answer is right helps it make sense, not just stick."}
]$j$;
BEGIN
  IF v_me IS NULL OR EXISTS (SELECT 1 FROM lc_sources WHERE chat_id = v_me) THEN RETURN NULL; END IF;
  INSERT INTO lc_sources (chat_id, url, title, skill, status, key_ideas, transcript)
  VALUES (v_me, 'hub:starter', 'How Hub works', 'Learning', 'ready', v_ideas,
    (SELECT string_agg((k->>'point') || '. ' || (k->>'explain'), E'\n') FROM jsonb_array_elements(v_ideas) k))
  RETURNING id INTO v_id;
  INSERT INTO lc_cards (source_id, chat_id, skill, question, options, answer, explanation) VALUES
    (v_id, v_me, 'Learning', 'Which study habit helps memory the most?', '["Rereading your notes", "Testing yourself", "Highlighting key lines", "Listening at double speed"]', 1,
      'Practice testing beats rereading: pulling the answer out of memory is what makes it stick.'),
    (v_id, v_me, 'Learning', 'Why does Hub bring a card back after 1, then 2, 4 and 8 days?', '["To keep you busy", "Spaced reviews with growing gaps beat cramming", "Older cards matter less", "It is random"]', 1,
      'Spacing reviews out, with the gap growing as the card sticks, beats cramming.'),
    (v_id, v_me, 'Learning', 'Why think of the answer before the options appear?', '["Producing an answer from memory strengthens it more than recognising it", "The options load slowly", "It saves time", "It makes the quiz harder for no reason"]', 0,
      'Recall is harder than recognition, and that effort is what strengthens the memory.'),
    (v_id, v_me, 'Learning', 'What happens to a card you miss in the Daily Starter?', '["It is deleted", "It comes back until you get it right", "You lose your streak", "Nothing"]', 1,
      'Successive relearning: retrieve it to a right answer every session, across spaced sessions.'),
    (v_id, v_me, 'Learning', 'Why are topics mixed in a session?', '["Interleaving helps you tell similar ideas apart", "It is an accident", "Mixed topics are easier", "To make sessions longer"]', 0,
      'Mixing topics, interleaving, makes you notice what sets similar ideas apart.'),
    (v_id, v_me, 'Learning', 'Which mistakes are most likely to be fixed after feedback?', '["Ones you made while unsure", "Ones you made while confident", "Typos", "Ones you skipped"]', 1,
      'The hypercorrection effect: high-confidence errors are the most likely to be corrected.'),
    (v_id, v_me, 'Learning', 'After a miss, what does Hub ask you to do?', '["Explain the answer in your own words", "Start the round again", "Wait a minute", "Spend a streak freeze"]', 0,
      'Self-explanation helps the answer make sense, not just stick.'),
    (v_id, v_me, 'Learning', 'What does a streak freeze do?', '["Doubles your XP", "Saves your streak when you miss a day", "Pauses reminders", "Skips a hard card"]', 1,
      'A missed day uses a freeze instead of ending your streak. You earn one every 7 days and hold up to 2.');
  RETURN v_id;
END $f$;

REVOKE ALL ON FUNCTION lc_flag_card(int), lc_archive_link(int), lc_restore_link(int), lc_set_goal(int), lc_activity(int),
  lc_lifetime(), lc_starter_deck(), lc_use_prompt(), lc_drip() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lc_flag_card(int), lc_archive_link(int), lc_restore_link(int), lc_set_goal(int), lc_activity(int),
  lc_lifetime(), lc_starter_deck(), lc_use_prompt(), lc_drip() TO authenticated;

SELECT 'Hub complete ready' AS result;
