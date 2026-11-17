-- Hub: reasons to come back. Weekly league, challenges, quests, recap, "Did you use it?", Go deeper and playlists.
-- Run after 001-007 in Supabase Studio → SQL Editor. Safe to run again.

-- A week is Monday to Sunday in UTC, the same UTC days as the streak.
CREATE OR REPLACE FUNCTION lc_week_start() RETURNS timestamptz
LANGUAGE sql STABLE AS $f$ SELECT date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' $f$;

-- One log of what happened when. Triggers fill it, so lc_grade, lc_award_mine and n8n stay as they are.
-- kinds: xp (n = XP gained), day (a day counted for the streak), review (a Starter answer), mastered (a card reached box 4).
CREATE TABLE IF NOT EXISTS lc_events (id bigserial PRIMARY KEY, chat_id bigint NOT NULL, kind text NOT NULL, n int NOT NULL DEFAULT 1, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS lc_events_chat ON lc_events (chat_id, at);
ALTER TABLE lc_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lc_events FROM anon, authenticated; -- read only through the functions below

CREATE OR REPLACE FUNCTION lc_log_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE old_xp int := 0; old_day date;
BEGIN
  IF TG_OP = 'UPDATE' THEN old_xp := coalesce(OLD.xp, 0); old_day := OLD.last_active; END IF;
  IF coalesce(NEW.xp, 0) > old_xp THEN INSERT INTO lc_events (chat_id, kind, n) VALUES (NEW.chat_id, 'xp', NEW.xp - old_xp); END IF;
  IF NEW.last_active IS NOT NULL AND NEW.last_active IS DISTINCT FROM old_day THEN INSERT INTO lc_events (chat_id, kind) VALUES (NEW.chat_id, 'day'); END IF;
  RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS lc_log_profile ON lc_profile;
CREATE TRIGGER lc_log_profile AFTER INSERT OR UPDATE ON lc_profile FOR EACH ROW EXECUTE FUNCTION lc_log_profile();

CREATE OR REPLACE FUNCTION lc_log_card() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  IF NEW.reviews > OLD.reviews THEN INSERT INTO lc_events (chat_id, kind) VALUES (NEW.chat_id, 'review'); END IF;
  IF NEW.box >= 4 AND OLD.box < 4 THEN INSERT INTO lc_events (chat_id, kind) VALUES (NEW.chat_id, 'mastered'); END IF;
  RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS lc_log_card ON lc_cards;
CREATE TRIGGER lc_log_card AFTER UPDATE OF box, reviews ON lc_cards FOR EACH ROW EXECUTE FUNCTION lc_log_card();
REVOKE ALL ON FUNCTION lc_log_profile(), lc_log_card() FROM PUBLIC, anon, authenticated;

-- "Did you use it?": the day after you study a link's key ideas, Hub asks about one of them, at most once a day.
ALTER TABLE lc_sources ADD COLUMN IF NOT EXISTS studied_at timestamptz;
UPDATE lc_sources s SET studied_at = s.created_at
WHERE s.studied_at IS NULL AND EXISTS (SELECT 1 FROM lc_cards c WHERE c.source_id = s.id AND c.reviews > 0);
CREATE TABLE IF NOT EXISTS lc_applied (
  source_id int REFERENCES lc_sources(id) ON DELETE CASCADE, idea int, chat_id bigint NOT NULL,
  used boolean NOT NULL, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (source_id, idea));
ALTER TABLE lc_applied ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lc_applied FROM anon, authenticated;

-- Playlists: n8n lists a playlist's videos here, and lc_drip lets one a day into your links.
CREATE TABLE IF NOT EXISTS lc_queue (
  id serial PRIMARY KEY, chat_id bigint NOT NULL, playlist_id int REFERENCES lc_sources(id) ON DELETE CASCADE,
  url text NOT NULL, title text, pos int, source_id int, released_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS lc_queue_url ON lc_queue (chat_id, url);
ALTER TABLE lc_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lc_queue FROM anon, authenticated;

-- What you did in a stretch of time. The league, quests and the recap all count from here.
CREATE OR REPLACE FUNCTION lc_summary(p_chat bigint, p_from timestamptz)
RETURNS TABLE (xp int, days int, reviews int, mastered int, used int, links int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT coalesce(sum(n) FILTER (WHERE kind = 'xp'), 0)::int, count(*) FILTER (WHERE kind = 'day')::int,
    count(*) FILTER (WHERE kind = 'review')::int, count(*) FILTER (WHERE kind = 'mastered')::int,
    (SELECT count(*) FROM lc_applied a WHERE a.chat_id = p_chat AND a.used AND a.at >= p_from)::int,
    -- Links you added yourself: not Go deeper rounds, not playlist videos let in by lc_drip.
    (SELECT count(*) FROM lc_sources s WHERE s.chat_id = p_chat AND s.created_at >= p_from AND s.url ~ '^https?://'
       AND NOT EXISTS (SELECT 1 FROM lc_queue q WHERE q.source_id = s.id))::int
  FROM lc_events WHERE chat_id = p_chat AND at >= p_from
$f$;
REVOKE ALL ON FUNCTION lc_summary(bigint, timestamptz) FROM PUBLIC, anon, authenticated;

-- Weekly league: opt-in. Only people who picked a name show up, and only their name and XP are shown.
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS display_name text;
CREATE UNIQUE INDEX IF NOT EXISTS lc_profile_name ON lc_profile (lower(display_name));

CREATE OR REPLACE FUNCTION lc_set_name(p_name text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  p_name := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ''); -- empty leaves the league
  IF length(p_name) > 24 THEN RAISE EXCEPTION 'Keep the name to 24 characters'; END IF;
  IF EXISTS (SELECT 1 FROM lc_profile WHERE lower(display_name) = lower(p_name) AND user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Someone already has that name';
  END IF;
  UPDATE lc_profile SET display_name = p_name WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Not signed in'; END IF;
  RETURN p_name;
END $f$;

-- Everyone in the league, most XP this week first. Only for signed-in learners.
CREATE OR REPLACE FUNCTION lc_league(p_from timestamptz DEFAULT NULL)
RETURNS TABLE (name text, xp int, me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT p.display_name, (SELECT s.xp FROM lc_summary(p.chat_id, coalesce(p_from, lc_week_start())) s), p.user_id IS NOT DISTINCT FROM auth.uid()
  FROM lc_profile p WHERE p.display_name IS NOT NULL AND (lc_my_chat() IS NOT NULL OR auth.uid() IS NULL)
  ORDER BY 2 DESC, 1
$f$;

-- Your week so far and your place in the league (place is null until you have a name).
CREATE OR REPLACE FUNCTION lc_my_week()
RETURNS TABLE (xp int, days int, reviews int, mastered int, used int, links int, name text, place int, players int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  WITH l AS (SELECT row_number() OVER (ORDER BY xp DESC, name) AS place, * FROM lc_league())
  SELECT s.*, p.display_name, (SELECT place::int FROM l WHERE l.me), (SELECT count(*)::int FROM l)
  FROM lc_profile p, lc_summary(p.chat_id, lc_week_start()) s WHERE p.user_id = auth.uid()
$f$;

-- Challenge a friend: you send the cards from your Speed round and your score; they play the same cards.
CREATE TABLE IF NOT EXISTS lc_challenges (
  id serial PRIMARY KEY, from_chat bigint NOT NULL, to_chat bigint NOT NULL, cards int[] NOT NULL,
  score int NOT NULL, their_score int, created_at timestamptz NOT NULL DEFAULT now(), played_at timestamptz);
ALTER TABLE lc_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lc_challenges FROM anon, authenticated;

CREATE OR REPLACE FUNCTION lc_challenge(p_to text, p_cards int[], p_score int) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_me bigint := lc_my_chat(); v_to bigint; v_cards int[]; v_id int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF (SELECT display_name FROM lc_profile WHERE chat_id = v_me) IS NULL THEN RAISE EXCEPTION 'Pick a league name first, so they know who it is from'; END IF;
  SELECT chat_id INTO v_to FROM lc_profile WHERE lower(display_name) = lower(btrim(p_to));
  IF v_to IS NULL THEN RAISE EXCEPTION 'No one in the league has that name'; END IF;
  IF v_to = v_me THEN RAISE EXCEPTION 'Pick someone other than yourself'; END IF;
  IF (SELECT count(*) FROM lc_challenges WHERE from_chat = v_me AND created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'That''s 10 challenges today. Try again tomorrow';
  END IF;
  -- Only your own playable cards, at most 40.
  v_cards := ARRAY(SELECT id FROM lc_cards WHERE chat_id = v_me AND id = ANY (p_cards) AND jsonb_array_length(options) >= 2 ORDER BY id LIMIT 40);
  IF cardinality(v_cards) < 2 THEN RAISE EXCEPTION 'Not enough cards for a challenge'; END IF;
  INSERT INTO lc_challenges (from_chat, to_chat, cards, score) VALUES (v_me, v_to, v_cards, LEAST(GREATEST(coalesce(p_score, 0), 0), 200))
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- Challenges waiting for you, and results from the last 7 days either way.
-- score is the sender's, their_score the receiver's; other is the other person's league name.
CREATE OR REPLACE FUNCTION lc_my_challenges()
RETURNS TABLE (id int, incoming boolean, other text, score int, their_score int, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT c.id, c.to_chat = me.chat, coalesce(o.display_name, 'Someone'), c.score, c.their_score, c.created_at
  FROM (SELECT lc_my_chat() AS chat) me
  JOIN lc_challenges c ON me.chat IN (c.from_chat, c.to_chat)
  LEFT JOIN lc_profile o ON o.chat_id = CASE WHEN c.to_chat = me.chat THEN c.from_chat ELSE c.to_chat END
  WHERE (c.to_chat = me.chat AND c.their_score IS NULL) OR c.played_at > now() - interval '7 days'
     OR (c.from_chat = me.chat AND c.their_score IS NULL AND c.created_at > now() - interval '7 days')
  ORDER BY c.their_score IS NULL DESC, coalesce(c.played_at, c.created_at) DESC
  LIMIT 10
$f$;

-- The cards of a challenge sent to you that you haven't played yet.
CREATE OR REPLACE FUNCTION lc_challenge_cards(p_id int)
RETURNS TABLE (id int, question text, options jsonb, answer int, explanation text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT k.id, k.question, k.options, k.answer, k.explanation
  FROM lc_challenges c JOIN lc_cards k ON k.id = ANY (c.cards) AND k.chat_id = c.from_chat
  WHERE c.id = p_id AND c.to_chat = lc_my_chat() AND c.their_score IS NULL
$f$;

CREATE OR REPLACE FUNCTION lc_finish_challenge(p_id int, p_score int)
RETURNS TABLE (score int, their_score int, other text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  RETURN QUERY
  UPDATE lc_challenges c SET their_score = LEAST(GREATEST(coalesce(p_score, 0), 0), 200), played_at = now()
  WHERE c.id = p_id AND c.to_chat = lc_my_chat() AND c.their_score IS NULL
  RETURNING c.score, c.their_score, coalesce((SELECT display_name FROM lc_profile WHERE chat_id = c.from_chat), 'Someone');
  IF NOT FOUND THEN RAISE EXCEPTION 'That challenge is already played'; END IF;
END $f$;

-- Weekly quests: three of six, a different mix each week, progress counted from the log.
CREATE TABLE IF NOT EXISTS lc_quest_claims (chat_id bigint, week date, quest text, PRIMARY KEY (chat_id, week, quest));
ALTER TABLE lc_quest_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lc_quest_claims FROM anon, authenticated;

CREATE OR REPLACE FUNCTION lc_quests()
RETURNS TABLE (quest text, title text, progress int, goal int, xp int, claimed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  WITH w AS (SELECT lc_week_start() AS start, lc_my_chat() AS me, (extract(epoch FROM lc_week_start()) / 604800)::int AS n),
  catalog (i, quest, title, goal, xp) AS (VALUES
    (0, 'days', 'Play 5 days', 5, 50), (1, 'xp', 'Earn 250 XP', 250, 30), (2, 'mastered', 'Master 5 cards', 5, 50),
    (3, 'links', 'Add 2 links', 2, 30), (4, 'review', 'Answer 40 Starter cards', 40, 40), (5, 'used', 'Use 2 ideas in real life', 2, 40)),
  s AS (SELECT * FROM w, lc_summary(w.me, w.start))
  SELECT c.quest, c.title,
    LEAST(CASE c.quest WHEN 'days' THEN s.days WHEN 'xp' THEN s.xp WHEN 'mastered' THEN s.mastered
      WHEN 'links' THEN s.links WHEN 'review' THEN s.reviews ELSE s.used END, c.goal),
    c.goal, c.xp,
    EXISTS (SELECT 1 FROM lc_quest_claims q WHERE q.chat_id = s.me AND q.week = s.start::date AND q.quest = c.quest)
  FROM catalog c, s
  -- offsets 0, 1 and 3 give six different sets of three over six weeks
  WHERE s.me IS NOT NULL AND c.i IN (s.n % 6, (s.n + 1) % 6, (s.n + 3) % 6)
  ORDER BY c.i
$f$;

CREATE OR REPLACE FUNCTION lc_claim_quest(p_quest text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE q record;
BEGIN
  SELECT * INTO q FROM lc_quests() WHERE quest = p_quest;
  IF NOT FOUND THEN RAISE EXCEPTION 'That quest isn''t on this week''s list'; END IF;
  IF q.claimed THEN RAISE EXCEPTION 'Already claimed'; END IF;
  IF q.progress < q.goal THEN RAISE EXCEPTION 'Not done yet'; END IF;
  INSERT INTO lc_quest_claims VALUES (lc_my_chat(), lc_week_start()::date, p_quest);
  UPDATE lc_profile SET xp = xp + q.xp WHERE user_id = auth.uid();
  RETURN q.xp;
END $f$;

-- "Did you use it?"
CREATE OR REPLACE FUNCTION lc_studied(p_id int) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE lc_sources SET studied_at = now() WHERE id = p_id AND chat_id = lc_my_chat() AND studied_at IS NULL
$f$;

-- One idea from the link you studied most recently (at least a day ago) that hasn't been asked about yet.
-- Nothing once you've answered one today.
CREATE OR REPLACE FUNCTION lc_use_prompt()
RETURNS TABLE (source_id int, idea int, point text, title text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT s.id, (i.ord - 1)::int, i.k->>'point', s.title
  FROM lc_sources s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.key_ideas) = 'array' THEN s.key_ideas ELSE '[]' END) WITH ORDINALITY i(k, ord)
  WHERE s.chat_id = lc_my_chat() AND s.studied_at <= now() - interval '1 day' AND coalesce(i.k->>'point', '') <> ''
    AND NOT EXISTS (SELECT 1 FROM lc_applied a WHERE a.source_id = s.id AND a.idea = i.ord - 1)
    AND NOT EXISTS (SELECT 1 FROM lc_applied a WHERE a.chat_id = s.chat_id AND a.at::date = current_date)
  ORDER BY s.studied_at DESC, i.ord
  LIMIT 1
$f$;

-- A yes is worth 5 XP. Returns the XP given.
CREATE OR REPLACE FUNCTION lc_answer_use(p_source int, p_idea int, p_used boolean) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lc_use_prompt() u WHERE u.source_id = p_source AND u.idea = p_idea) THEN
    RAISE EXCEPTION 'That one isn''t up today';
  END IF;
  INSERT INTO lc_applied (source_id, idea, chat_id, used) VALUES (p_source, p_idea, lc_my_chat(), coalesce(p_used, false));
  IF p_used THEN UPDATE lc_profile SET xp = xp + 5 WHERE user_id = auth.uid(); RETURN 5; END IF;
  RETURN 0;
END $f$;

-- Go deeper: a new set of key ideas and cards on a skill you already have, made by the AI without a link.
-- n8n's "Learning Coach: Web Links" sees url 'hub:deeper' and writes the next layer from the skill's existing ideas.
CREATE OR REPLACE FUNCTION lc_go_deeper(p_skill text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_me bigint := lc_my_chat(); v_id int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lc_cards WHERE chat_id = v_me AND skill = p_skill) THEN RAISE EXCEPTION 'That isn''t one of your skills'; END IF;
  IF EXISTS (SELECT 1 FROM lc_sources WHERE chat_id = v_me AND url = 'hub:deeper' AND skill = p_skill AND status IN ('queued', 'reading')) THEN
    RAISE EXCEPTION 'Already going deeper on that one';
  END IF;
  IF (SELECT count(*) FROM lc_sources WHERE chat_id = v_me AND url = 'hub:deeper' AND created_at > now() - interval '1 day') >= 3 THEN
    RAISE EXCEPTION 'That''s 3 deeper rounds today. Try again tomorrow';
  END IF;
  INSERT INTO lc_sources (chat_id, url, skill, title, status) VALUES (v_me, 'hub:deeper', p_skill, 'Deeper: ' || p_skill, 'queued')
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- Lets in the next playlist video, once a (UTC) day. Returns its new link id for the page to send to n8n, or null.
CREATE OR REPLACE FUNCTION lc_drip() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_me bigint := lc_my_chat(); q record; v_id int;
BEGIN
  IF v_me IS NULL OR EXISTS (SELECT 1 FROM lc_queue WHERE chat_id = v_me AND released_at::date = current_date) THEN RETURN NULL; END IF;
  SELECT * INTO q FROM lc_queue l WHERE l.chat_id = v_me AND l.released_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM lc_sources s WHERE s.chat_id = v_me AND s.url = l.url) -- already added by hand
  ORDER BY l.playlist_id, l.pos LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO lc_sources (chat_id, url, title, status) VALUES (v_me, q.url, q.title, 'queued') RETURNING id INTO v_id;
  UPDATE lc_queue SET released_at = now(), source_id = v_id WHERE id = q.id;
  RETURN v_id;
END $f$;

-- Weekly recap over Web Push (the "remind" Edge Function): Sunday at your reminder hour, your last 7 days.
-- Only if you did something; recaps never count toward pausing reminders.
ALTER TABLE lc_push ADD COLUMN IF NOT EXISTS recap_sent date;
CREATE OR REPLACE FUNCTION lc_claim_recaps()
RETURNS TABLE (user_id uuid, sub jsonb, xp int, days int, mastered int, used int, place int, players int)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  WITH league AS (SELECT row_number() OVER (ORDER BY l.xp DESC, l.name)::int AS place, l.name FROM lc_league(now() - interval '7 days') l),
  picked AS (
    SELECT p.user_id, (now() AT TIME ZONE p.tz)::date AS today, s.xp, s.days, s.mastered, s.used,
      (SELECT place FROM league WHERE league.name = pr.display_name) AS place
    FROM lc_push p
    JOIN lc_profile pr ON pr.user_id = p.user_id
    CROSS JOIN LATERAL lc_summary(pr.chat_id, now() - interval '7 days') s
    WHERE extract(dow FROM now() AT TIME ZONE p.tz) = 0 AND extract(hour FROM now() AT TIME ZONE p.tz) = p.remind_hour
      AND (p.recap_sent IS NULL OR p.recap_sent < (now() AT TIME ZONE p.tz)::date)
      AND p.ignored < 5 AND s.xp > 0
    FOR UPDATE OF p SKIP LOCKED
  )
  UPDATE lc_push p SET recap_sent = picked.today FROM picked WHERE p.user_id = picked.user_id
  RETURNING p.user_id, p.sub, picked.xp, picked.days, picked.mastered, picked.used, picked.place, (SELECT count(*)::int FROM league)
$f$;

REVOKE ALL ON FUNCTION lc_week_start(), lc_set_name(text), lc_league(timestamptz), lc_my_week(), lc_challenge(text, int[], int),
  lc_my_challenges(), lc_challenge_cards(int), lc_finish_challenge(int, int), lc_quests(), lc_claim_quest(text), lc_studied(int),
  lc_use_prompt(), lc_answer_use(int, int, boolean), lc_go_deeper(text), lc_drip(), lc_claim_recaps() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION lc_claim_recaps() FROM authenticated;
GRANT EXECUTE ON FUNCTION lc_week_start(), lc_set_name(text), lc_league(timestamptz), lc_my_week(), lc_challenge(text, int[], int),
  lc_my_challenges(), lc_challenge_cards(int), lc_finish_challenge(int, int), lc_quests(), lc_claim_quest(text), lc_studied(int),
  lc_use_prompt(), lc_answer_use(int, int, boolean), lc_go_deeper(text), lc_drip() TO authenticated;
GRANT EXECUTE ON FUNCTION lc_claim_recaps() TO service_role;

SELECT 'Hub engage ready' AS result;
