-- Hub, phase 2 (Learn tab). Run after 001_hub.sql in Supabase Studio → SQL Editor. Safe to run again.

-- Mini-games and finishing the Daily Starter give XP but never touch when a card comes back:
-- only lc_grade moves cards between boxes. p_day_done (finishing the Starter) also counts today for the streak.
-- XP is capped per call so a bad request can't inflate it.
CREATE OR REPLACE FUNCTION lc_award_mine(p_xp int, p_day_done boolean)
RETURNS TABLE (new_xp int, new_streak int)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE lc_profile p SET
    xp = p.xp + LEAST(GREATEST(coalesce(p_xp, 0), 0), 100),
    streak = CASE WHEN NOT coalesce(p_day_done, false) OR p.last_active = current_date THEN p.streak
                  WHEN p.last_active = current_date - 1 THEN p.streak + 1 ELSE 1 END,
    last_active = CASE WHEN coalesce(p_day_done, false) THEN current_date ELSE p.last_active END
  WHERE p.user_id = auth.uid()
  RETURNING p.xp, p.streak
$f$;

REVOKE ALL ON FUNCTION lc_award_mine(int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lc_award_mine(int, boolean) TO authenticated;

SELECT 'Hub phase 2 ready' AS result;
