-- Hub, no-Telegram setup. Run after 002_learn.sql in Supabase Studio → SQL Editor. Safe to run again.

-- A login without a Telegram chat gets its own learner ID. Telegram user IDs are positive, so negative IDs never collide.
CREATE SEQUENCE IF NOT EXISTS lc_web_chat;
ALTER TABLE lc_sources ADD COLUMN IF NOT EXISTS note text;

-- Now called with no argument (or with TELEGRAM_ID to keep using an existing bot chat's cards).
DROP FUNCTION IF EXISTS lc_link_me(bigint);
CREATE OR REPLACE FUNCTION lc_link_me(p_chat bigint DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM lc_profile WHERE user_id = auth.uid()) THEN
    IF p_chat IS NOT NULL THEN
      INSERT INTO lc_profile (chat_id, user_id) VALUES (p_chat, auth.uid())
      ON CONFLICT (chat_id) DO UPDATE SET user_id = auth.uid() WHERE lc_profile.user_id IS NULL;
    END IF;
    -- No Telegram chat, or it belongs to someone else: start fresh.
    IF NOT EXISTS (SELECT 1 FROM lc_profile WHERE user_id = auth.uid()) THEN
      INSERT INTO lc_profile (chat_id, user_id) VALUES (-nextval('lc_web_chat'), auth.uid());
    END IF;
  END IF;
  RETURN true;
END $f$;

-- The page queues a link; n8n's "Learning Coach: Web Links" workflow claims it (status 'queued' → 'reading')
-- and turns it into cards and a lesson. Only links queued here can be processed, so the webhook needs no secret.
CREATE OR REPLACE FUNCTION lc_add_link(p_url text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_chat bigint := lc_my_chat(); v_id int;
BEGIN
  IF v_chat IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  p_url := btrim(p_url);
  IF p_url !~ '^https?://[^\s]+$' OR length(p_url) > 2000 THEN RAISE EXCEPTION 'That doesn''t look like a link'; END IF;
  IF (SELECT count(*) FROM lc_sources WHERE chat_id = v_chat AND created_at > now() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'That''s 20 links this hour. Try again later';
  END IF;
  INSERT INTO lc_sources (chat_id, url, status) VALUES (v_chat, p_url, 'queued') RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

REVOKE ALL ON FUNCTION lc_link_me(bigint), lc_add_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lc_link_me(bigint), lc_add_link(text) TO authenticated;

SELECT 'Hub web setup ready' AS result;
