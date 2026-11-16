-- Hub daily reminders (opt-in Web Push). Run after 005 in Supabase Studio → SQL Editor. Safe to run again.
-- The page subscribes and saves here through lc_set_reminder; the "remind" Edge Function, called hourly,
-- claims who is due a reminder with lc_claim_reminders and sends them.

-- One reminder setting per login. sub is the browser's PushSubscription (endpoint + keys).
-- shortcut: one device per login (the last one to turn reminders on); add a device column if people want several.
CREATE TABLE IF NOT EXISTS lc_push (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  sub jsonb NOT NULL,
  remind_hour smallint NOT NULL DEFAULT 19 CHECK (remind_hour BETWEEN 0 AND 23),
  tz text NOT NULL DEFAULT 'UTC',
  last_sent date,                          -- local date of the last reminder
  ignored smallint NOT NULL DEFAULT 0,     -- reminders in a row with no practice after them; 5 pauses them
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lc_push ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lc_push FROM anon, authenticated;
GRANT SELECT ON lc_push TO authenticated;
DROP POLICY IF EXISTS lc_push_own ON lc_push;
CREATE POLICY lc_push_own ON lc_push FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Turn reminders on, or change the hour. Also un-pauses them.
CREATE OR REPLACE FUNCTION lc_set_reminder(p_sub jsonb, p_hour int, p_tz text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_sub->>'endpoint' !~ '^https://[^\s]+$' OR length(p_sub::text) > 4000
     OR coalesce(p_sub->'keys'->>'p256dh', '') = '' OR coalesce(p_sub->'keys'->>'auth', '') = '' THEN
    RAISE EXCEPTION 'That push subscription looks wrong';
  END IF;
  IF p_hour NOT BETWEEN 0 AND 23 THEN RAISE EXCEPTION 'Pick an hour from 0 to 23'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN p_tz := 'UTC'; END IF;
  INSERT INTO lc_push (user_id, sub, remind_hour, tz) VALUES (auth.uid(), p_sub, p_hour, p_tz)
  ON CONFLICT (user_id) DO UPDATE SET sub = EXCLUDED.sub, remind_hour = EXCLUDED.remind_hour, tz = EXCLUDED.tz,
    ignored = 0, updated_at = now();
END $f$;

CREATE OR REPLACE FUNCTION lc_stop_reminder() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  DELETE FROM lc_push WHERE user_id = auth.uid()
$f$;

-- Called by the Edge Function each hour. Returns everyone whose reminder hour it is now, in their own time zone,
-- who hasn't practised today, has cards due, wasn't reminded today and isn't paused, and marks them sent.
-- ignored counts earlier reminders in a row that weren't followed by practice. At 5 the sender says reminders
-- are pausing, and none go out after that until the person turns them on again.
CREATE OR REPLACE FUNCTION lc_claim_reminders()
RETURNS TABLE (user_id uuid, sub jsonb, due int, streak int, ignored smallint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  WITH picked AS (
    SELECT p.user_id, d.due, pr.streak, (now() AT TIME ZONE p.tz)::date AS today,
      CASE WHEN p.last_sent IS NOT NULL AND (pr.last_active IS NULL OR pr.last_active < p.last_sent)
        THEN p.ignored + 1 ELSE 0 END AS ignored
    FROM lc_push p
    JOIN lc_profile pr ON pr.user_id = p.user_id
    CROSS JOIN LATERAL (SELECT count(*)::int AS due FROM lc_cards c WHERE c.chat_id = pr.chat_id AND c.due_at <= now()) d
    WHERE extract(hour FROM now() AT TIME ZONE p.tz) = p.remind_hour
      AND (p.last_sent IS NULL OR p.last_sent < (now() AT TIME ZONE p.tz)::date)
      AND (pr.last_active IS NULL OR pr.last_active < (now() AT TIME ZONE p.tz)::date)
      AND d.due > 0 AND p.ignored < 5
    FOR UPDATE OF p SKIP LOCKED
  )
  UPDATE lc_push p SET last_sent = picked.today, ignored = picked.ignored
  FROM picked WHERE p.user_id = picked.user_id
  RETURNING p.user_id, p.sub, picked.due, coalesce(picked.streak, 0), picked.ignored
$f$;

REVOKE ALL ON FUNCTION lc_set_reminder(jsonb, int, text), lc_stop_reminder(), lc_claim_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lc_set_reminder(jsonb, int, text), lc_stop_reminder() TO authenticated;
GRANT EXECUTE ON FUNCTION lc_claim_reminders() TO service_role;
GRANT SELECT, DELETE ON lc_push TO service_role;

SELECT 'Hub reminders setup ready' AS result;
