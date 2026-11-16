-- Hub: lessons on demand. Run after 004_lessons.sql in Supabase Studio → SQL Editor. Safe to run again.

-- Adding a link now makes only its key ideas and cards (status 'ready'). Tapping "Build lesson" calls this,
-- and n8n claims the row (status 'lesson_queued' → 'generating'), the same way it claims a queued link,
-- so the webhook still needs no secret.
ALTER TABLE lc_sources ADD COLUMN IF NOT EXISTS lesson_requested_at timestamptz;

CREATE OR REPLACE FUNCTION lc_request_lesson(p_id int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_chat bigint := lc_my_chat();
BEGIN
  IF v_chat IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  -- Each lesson is a paid OpenMAIC run.
  IF (SELECT count(*) FROM lc_sources WHERE chat_id = v_chat AND lesson_requested_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'That''s 10 lessons today. Try again tomorrow';
  END IF;
  -- Your own link, once its cards exist (the transcript is saved with them), with no lesson yet, a failed one,
  -- or one stuck for 2 hours (n8n gives up after 40 minutes, so it died part way).
  UPDATE lc_sources SET status = 'lesson_queued', note = NULL, lesson_url = NULL, lesson_requested_at = now()
  WHERE id = p_id AND chat_id = v_chat AND transcript IS NOT NULL
    AND (status = 'failed' OR (status = 'ready' AND lesson_url IS NULL)
      OR (status IN ('lesson_queued', 'generating') AND lesson_requested_at < now() - interval '2 hours'));
  IF NOT FOUND THEN RAISE EXCEPTION 'That lesson is already built or on its way'; END IF;
END $f$;

REVOKE ALL ON FUNCTION lc_request_lesson(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lc_request_lesson(int) TO authenticated;

SELECT 'Hub lesson-on-demand setup ready' AS result;
