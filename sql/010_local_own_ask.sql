-- Hub: days in your own time zone, your own text and photos, "Ask about this" and the due-cards forecast.
-- Run after 001-009 in Supabase Studio → SQL Editor. Safe to run again.
-- It replaces 007's lc_streak_step, 008's lc_week_start and 009's lc_activity: if you re-run any of those later, run this again after.

-- Local days. Every request from the page runs in its learner's time zone: PostgREST calls lc_local_time first
-- (its db-pre-request), so current_date, ::date and date_trunc in every function follow your midnight, not UTC's.
-- The bot, n8n and the reminders' Edge Function don't go through it and stay in UTC (the reminders already use lc_push.tz).
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS tz text NOT NULL DEFAULT 'UTC';

-- No SET clause on purpose: a function's own SET would undo set_config when it returns. Names are schema-qualified instead.
CREATE OR REPLACE FUNCTION public.lc_local_time() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $f$
DECLARE v text;
BEGIN
  SELECT p.tz INTO v FROM public.lc_profile p WHERE p.user_id = auth.uid();
  IF v IS NOT NULL THEN PERFORM pg_catalog.set_config('timezone', v, true); END IF; -- true: this request only
END $f$;
REVOKE ALL ON FUNCTION public.lc_local_time() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lc_local_time() TO anon, authenticated, service_role;

-- The page sends the phone's time zone on every load. Returns the zone this request ran in and whether it changed,
-- so the page can tell when PostgREST isn't calling lc_local_time.
CREATE OR REPLACE FUNCTION lc_set_tz(p_tz text) RETURNS TABLE (ran_in text, changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_ran text := current_setting('timezone'); v_n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN RAISE EXCEPTION 'Unknown time zone'; END IF;
  UPDATE lc_profile SET tz = p_tz WHERE user_id = auth.uid() AND tz IS DISTINCT FROM p_tz;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN QUERY SELECT v_ran, v_n > 0;
END $f$;
REVOKE ALL ON FUNCTION lc_set_tz(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lc_set_tz(text) TO authenticated;

-- Turn the pre-request on, unless PostgREST already has a different one (then add a call to lc_local_time inside it).
DO $do$
DECLARE v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN RETURN; END IF; -- not Supabase (the self-check)
  SELECT split_part(c, '=', 2) INTO v FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole, unnest(s.setconfig) c
  WHERE r.rolname = 'authenticator' AND c LIKE 'pgrst.db_pre_request=%';
  IF v IS NOT NULL AND v <> 'public.lc_local_time' THEN
    RAISE WARNING 'PostgREST already runs % before each request; add PERFORM public.lc_local_time(); to it for local days', v;
    RETURN;
  END IF;
  ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.lc_local_time';
  NOTIFY pgrst, 'reload config';
END $do$;

-- 007's streak rule, plus: a last_active that is "tomorrow" (it was saved in UTC, or you flew west) counts as today.
CREATE OR REPLACE FUNCTION lc_streak_step(p_last date, p_streak int, p_freezes int, p_used date, p_earned date, p_play boolean)
RETURNS TABLE (streak int, freezes int, used_on date, earned_on date)
LANGUAGE sql STABLE SET search_path = public AS $f$
WITH m AS (SELECT CASE WHEN NOT p_play THEN -1 WHEN p_last IS NULL THEN NULL ELSE GREATEST(current_date - p_last - 1, -1) END AS missed),
s AS (SELECT missed,
        CASE WHEN missed = -1 THEN p_streak WHEN missed <= p_freezes THEN p_streak + 1 ELSE 1 END AS streak,
        CASE WHEN missed > 0 AND missed <= p_freezes THEN p_freezes - missed ELSE p_freezes END AS freezes,
        CASE WHEN missed > 0 AND missed <= p_freezes THEN current_date ELSE p_used END AS used_on
      FROM m),
e AS (SELECT s.*, (missed >= 0 AND s.streak % 7 = 0 AND s.freezes < 2) AS earn FROM s)
SELECT e.streak, e.freezes + CASE WHEN e.earn THEN 1 ELSE 0 END, e.used_on, CASE WHEN e.earn THEN current_date ELSE p_earned END FROM e
$f$;

-- 008's week, now Monday midnight where you are. Quest claims stay keyed by that Monday's date.
CREATE OR REPLACE FUNCTION lc_week_start() RETURNS timestamptz
LANGUAGE sql STABLE AS $f$ SELECT date_trunc('week', now()) $f$;

-- 009's activity grid, in your days.
CREATE OR REPLACE FUNCTION lc_activity(p_days int DEFAULT 84)
RETURNS TABLE (day date, xp int, played boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT at::date, coalesce(sum(n) FILTER (WHERE kind = 'xp'), 0)::int, bool_or(kind = 'day')
  FROM lc_events
  WHERE chat_id = lc_my_chat() AND at >= (current_date - LEAST(GREATEST(coalesce(p_days, 84), 1), 400))::timestamptz
  GROUP BY 1 ORDER BY 1
$f$;

-- Forecast: cards due per day for the next p_days days. Overdue cards count as today.
CREATE OR REPLACE FUNCTION lc_forecast(p_days int DEFAULT 7)
RETURNS TABLE (day date, due int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT GREATEST(due_at::date, current_date), count(*)::int
  FROM lc_cards
  WHERE chat_id = lc_my_chat() AND hidden IS NULL
    AND due_at < (current_date + LEAST(GREATEST(coalesce(p_days, 7), 1), 60))::timestamptz
  GROUP BY 1 ORDER BY 1
$f$;

-- Your own material: pasted text (or a PDF's text, read in the browser), or photos of pages and slides.
-- url says which ('hub:text' or 'hub:photos'); transcript holds the text, or the photos' links, one per line,
-- then a blank line and any notes. n8n's "Learning Coach: Web Links" reads it and replaces transcript with what it read.
CREATE OR REPLACE FUNCTION lc_add_own(p_title text, p_text text, p_files text[] DEFAULT NULL) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_chat bigint := lc_my_chat(); v_id int; v_text text := btrim(coalesce(p_text, '')); v_files text[] := coalesce(p_files, '{}');
BEGIN
  IF v_chat IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF cardinality(v_files) > 10 THEN RAISE EXCEPTION 'Up to 10 photos at a time'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_files) f WHERE f !~ '^https://[^\s]+$' OR length(f) > 2000) THEN RAISE EXCEPTION 'A photo link looks wrong'; END IF;
  IF cardinality(v_files) = 0 AND length(v_text) < 150 THEN RAISE EXCEPTION 'Paste a bit more: at least a few sentences'; END IF;
  IF length(v_text) > 60000 THEN RAISE EXCEPTION 'That''s too long. Keep it under 60,000 characters'; END IF;
  IF (SELECT count(*) FROM lc_sources WHERE chat_id = v_chat AND created_at > now() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'That''s 20 links this hour. Try again later';
  END IF;
  INSERT INTO lc_sources (chat_id, url, title, status, transcript)
  VALUES (v_chat, CASE WHEN cardinality(v_files) > 0 THEN 'hub:photos' ELSE 'hub:text' END,
    coalesce(left(nullif(btrim(coalesce(p_title, '')), ''), 150), CASE WHEN cardinality(v_files) > 0 THEN 'Your photos' ELSE 'Your notes' END), 'queued',
    CASE WHEN cardinality(v_files) > 0 THEN array_to_string(v_files, E'\n') || E'\n\n' || v_text ELSE v_text END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;
REVOKE ALL ON FUNCTION lc_add_own(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lc_add_own(text, text, text[]) TO authenticated;

-- Photos go to a private bucket, each learner in their own folder. The page hands n8n signed links to them.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('hub-uploads', 'hub-uploads', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS hub_uploads_own ON storage.objects;
CREATE POLICY hub_uploads_own ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'hub-uploads' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'hub-uploads' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- Ask about this: a question on one of your links, answered by n8n from that link's text.
-- The page asks with lc_ask, pings n8n (?step=ask&ask_id=), then reads the answer from this table when it lands.
CREATE TABLE IF NOT EXISTS lc_asks (
  id serial PRIMARY KEY, chat_id bigint NOT NULL, source_id int NOT NULL REFERENCES lc_sources(id) ON DELETE CASCADE,
  question text NOT NULL, answer text, status text NOT NULL DEFAULT 'queued', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS lc_asks_source ON lc_asks (source_id, id);
ALTER TABLE lc_asks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lc_asks FROM anon, authenticated;
GRANT SELECT ON lc_asks TO authenticated;
DROP POLICY IF EXISTS lc_asks_own ON lc_asks;
CREATE POLICY lc_asks_own ON lc_asks FOR SELECT TO authenticated USING (chat_id = (SELECT lc_my_chat()));

CREATE OR REPLACE FUNCTION lc_ask(p_source int, p_question text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_chat bigint := lc_my_chat(); v_id int;
BEGIN
  p_question := btrim(coalesce(p_question, ''));
  IF v_chat IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF length(p_question) < 3 THEN RAISE EXCEPTION 'Type a question first'; END IF;
  IF length(p_question) > 500 THEN RAISE EXCEPTION 'Keep the question under 500 characters'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lc_sources WHERE id = p_source AND chat_id = v_chat
                 AND jsonb_typeof(key_ideas) = 'array' AND jsonb_array_length(key_ideas) > 0) THEN
    RAISE EXCEPTION 'That link isn''t ready to ask about';
  END IF;
  IF (SELECT count(*) FROM lc_asks WHERE chat_id = v_chat AND created_at > now() - interval '1 day') >= 30 THEN
    RAISE EXCEPTION 'That''s 30 questions today. Try again tomorrow';
  END IF;
  INSERT INTO lc_asks (chat_id, source_id, question) VALUES (v_chat, p_source, p_question) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

REVOKE ALL ON FUNCTION lc_ask(int, text), lc_forecast(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lc_ask(int, text), lc_forecast(int) TO authenticated;

SELECT 'Hub local days, own material and ask ready' AS result;
