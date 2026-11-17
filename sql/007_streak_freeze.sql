-- Hub: streak freezes. A missed day uses up a freeze instead of resetting the streak to 1.
-- Everyone starts with 1, earns 1 more every 7 days of streak, and holds at most 2 (like Duolingo, which found that
-- letting people miss a day keeps more of them coming back). Run after 001-006. Safe to run again.
-- It replaces lc_grade (001) and lc_award_mine (002): if you re-run either of those later, run this again after.

ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS freezes smallint NOT NULL DEFAULT 1;
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS freeze_used_on date;   -- the day a freeze last saved the streak
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS freeze_earned_on date; -- the day one was last earned

-- The one streak rule, for the bot and the page. p_play false means "not counting today": nothing changes.
-- missed = days skipped since last_active (-1: already played today, 0: played yesterday).
CREATE OR REPLACE FUNCTION lc_streak_step(p_last date, p_streak int, p_freezes int, p_used date, p_earned date, p_play boolean)
RETURNS TABLE (streak int, freezes int, used_on date, earned_on date)
LANGUAGE sql STABLE SET search_path = public AS $f$
WITH m AS (SELECT CASE WHEN NOT p_play THEN -1 WHEN p_last IS NULL THEN NULL ELSE current_date - p_last - 1 END AS missed),
s AS (SELECT missed,
        CASE WHEN missed = -1 THEN p_streak WHEN missed <= p_freezes THEN p_streak + 1 ELSE 1 END AS streak,
        CASE WHEN missed > 0 AND missed <= p_freezes THEN p_freezes - missed ELSE p_freezes END AS freezes,
        CASE WHEN missed > 0 AND missed <= p_freezes THEN current_date ELSE p_used END AS used_on
      FROM m),
e AS (SELECT s.*, (missed >= 0 AND s.streak % 7 = 0 AND s.freezes < 2) AS earn FROM s)
SELECT e.streak, e.freezes + CASE WHEN e.earn THEN 1 ELSE 0 END, e.used_on, CASE WHEN e.earn THEN current_date ELSE p_earned END FROM e
$f$;

-- 001's grading, with the streak step above. Unchanged otherwise.
CREATE OR REPLACE FUNCTION lc_grade(p_card int, p_choice int, p_chat bigint)
RETURNS TABLE (is_correct boolean, q_text text, answer_text text, expl text, new_streak int, new_xp int)
LANGUAGE sql SET search_path = public AS $f$
WITH c AS (SELECT * FROM lc_cards WHERE id = p_card AND chat_id = p_chat AND due_at <= now() + interval '1 minute'),
ok AS (SELECT c.*, (c.answer = p_choice) AS correct FROM c),
upd AS (UPDATE lc_cards l SET box = CASE WHEN ok.correct THEN LEAST(ok.box + 1, 6) ELSE 0 END,
          due_at = now() + make_interval(days => CASE WHEN ok.correct THEN (ARRAY[1,2,4,8,16,32])[LEAST(ok.box + 1, 6)] ELSE 1 END),
          last_result = ok.correct, reviews = ok.reviews + 1
        FROM ok WHERE l.id = ok.id RETURNING l.id),
prof AS (INSERT INTO lc_profile AS p (chat_id, xp, streak, last_active)
         SELECT p_chat, CASE WHEN correct THEN 10 ELSE 2 END, 1, current_date FROM ok
         ON CONFLICT (chat_id) DO UPDATE SET xp = p.xp + EXCLUDED.xp,
           (streak, freezes, freeze_used_on, freeze_earned_on) =
             (SELECT * FROM lc_streak_step(p.last_active, p.streak, p.freezes, p.freeze_used_on, p.freeze_earned_on, true)),
           last_active = current_date
         RETURNING xp, streak)
SELECT ok.correct, ok.question, ok.options->>ok.answer, ok.explanation, prof.streak, prof.xp FROM ok, prof
$f$;

-- 002's award, with the streak step, and it now says what happened to the freezes today (for the Day done screen).
DROP FUNCTION IF EXISTS lc_award_mine(int, boolean);
CREATE FUNCTION lc_award_mine(p_xp int, p_day_done boolean)
RETURNS TABLE (new_xp int, new_streak int, freezes int, saved boolean, earned boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE lc_profile p SET
    xp = p.xp + LEAST(GREATEST(coalesce(p_xp, 0), 0), 100),
    (streak, freezes, freeze_used_on, freeze_earned_on) =
      (SELECT * FROM lc_streak_step(p.last_active, p.streak, p.freezes, p.freeze_used_on, p.freeze_earned_on, coalesce(p_day_done, false))),
    last_active = CASE WHEN coalesce(p_day_done, false) THEN current_date ELSE p.last_active END
  WHERE p.user_id = auth.uid()
  RETURNING p.xp, p.streak, p.freezes::int, coalesce(p.freeze_used_on = current_date, false), coalesce(p.freeze_earned_on = current_date, false)
$f$;

-- lc_streak_step stays callable by everyone: it reads no data, and the bot's role needs it through lc_grade.
REVOKE ALL ON FUNCTION lc_award_mine(int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lc_award_mine(int, boolean) TO authenticated;

SELECT 'Hub streak freeze ready' AS result;
