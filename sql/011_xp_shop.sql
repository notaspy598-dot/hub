-- Hub: XP you can spend. The shop (streak freezes, double or nothing, extra time, extra Go deeper rounds,
-- themes and titles), the Starter boost and Legendary runs. Run after 001-010 in Supabase Studio → SQL Editor. Safe to run again.
-- It replaces 007's lc_award_mine and 008's lc_go_deeper: if you re-run 007 or 008 later, run this again after.

-- xp stays everything you ever earned: the league, quests, trophies and the activity grid never see spending.
-- What you can spend is xp - xp_spent. A won bet pays out by lowering xp_spent, so it never counts as earned XP.
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS xp_spent int NOT NULL DEFAULT 0;
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS boost_until timestamptz;            -- 2x practice XP until then
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS extra_time smallint NOT NULL DEFAULT 0; -- Speed round +15 s, held
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS unlocks text[] NOT NULL DEFAULT '{}';   -- themes and titles you own
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS theme text;                          -- the theme you wear
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS badge text;                          -- the title next to your league name
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lc_profile_xp_spent') THEN
    ALTER TABLE lc_profile ADD CONSTRAINT lc_profile_xp_spent CHECK (xp_spent <= coalesce(xp, 0)); -- never spend what you don't have
  END IF;
END $do$;

-- Every purchase, for the per-day limits and for the owner to look at in Studio.
CREATE TABLE IF NOT EXISTS lc_purchases (id bigserial PRIMARY KEY, chat_id bigint NOT NULL, item text NOT NULL, price int NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS lc_purchases_chat ON lc_purchases (chat_id, at);
ALTER TABLE lc_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lc_purchases FROM anon, authenticated;

-- Double or nothing: one open bet at a time. Won when the streak is 7 days past where it was; lost when it breaks.
CREATE TABLE IF NOT EXISTS lc_wagers (
  id serial PRIMARY KEY, chat_id bigint NOT NULL, stake int NOT NULL, start_streak int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), result text CHECK (result IN ('won', 'lost')), settled_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS lc_wagers_open ON lc_wagers (chat_id) WHERE result IS NULL;
ALTER TABLE lc_wagers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lc_wagers FROM anon, authenticated;

-- Legendary: a no-mistakes run through an Expert skill's cards. Won ones show on the skill; the page reads its own.
CREATE TABLE IF NOT EXISTS lc_legendary (id serial PRIMARY KEY, chat_id bigint NOT NULL, skill text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), won boolean);
ALTER TABLE lc_legendary ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lc_legendary FROM anon, authenticated;
GRANT SELECT ON lc_legendary TO authenticated;
DROP POLICY IF EXISTS lc_legendary_own ON lc_legendary;
CREATE POLICY lc_legendary_own ON lc_legendary FOR SELECT TO authenticated USING (chat_id = (SELECT lc_my_chat()));

-- The catalogue. Prices live only here; the page shows what lc_shop returns. A null price is not for sale.
CREATE OR REPLACE FUNCTION lc_catalog()
RETURNS TABLE (item text, kind text, title text, blurb text, price int, sort int)
LANGUAGE sql IMMUTABLE AS $f$ VALUES
  ('freeze', 'power', 'Streak freeze', 'A missed day uses it instead of ending your streak. Hold up to 2.', 200, 1),
  ('wager', 'power', 'Double or nothing', 'Bet 50 XP you keep your streak 7 more days. Win and you get 100 back.', 50, 2),
  ('time', 'power', 'Extra time', '+15 seconds on a Speed round, used when you choose. Hold up to 3.', 40, 3),
  ('deeper', 'power', 'Extra Go deeper round', 'One more Go deeper after your free 3 a day. Up to 2 a day.', 150, 4),
  ('theme:ember', 'theme', 'Ember', 'A deep, warm red stage.', 500, 10),
  ('theme:ocean', 'theme', 'Ocean', 'A deep sea-blue stage.', 500, 11),
  ('theme:forest', 'theme', 'Forest', 'A deep green stage.', 500, 12),
  ('title:scholar', 'title', 'Scholar', 'A title next to your name in the league.', 250, 20),
  ('title:owl', 'title', 'Night owl', 'A title next to your name in the league.', 250, 21),
  ('title:speedster', 'title', 'Speedster', 'A title next to your name in the league.', 250, 22),
  ('title:legend', 'title', 'Legend', 'Win a Legendary run to earn it. Not for sale.', NULL, 23)
$f$;

-- The shop as you see it: each item's state (buy, max, active, locked, owned, worn), a note, and your balance.
-- It also settles a bet whose streak has died since the last play (the next play would reset it anyway).
CREATE OR REPLACE FUNCTION lc_shop()
RETURNS TABLE (item text, kind text, title text, blurb text, price int, state text, note text, balance int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
#variable_conflict use_column
DECLARE p lc_profile; w lc_wagers; prev lc_wagers; v_deeper int;
BEGIN
  SELECT * INTO p FROM lc_profile WHERE user_id = auth.uid();
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE lc_wagers SET result = 'lost', settled_at = now()
  WHERE chat_id = p.chat_id AND result IS NULL AND (p.last_active IS NULL OR current_date - p.last_active - 1 > p.freezes);
  SELECT * INTO w FROM lc_wagers WHERE chat_id = p.chat_id AND result IS NULL;
  SELECT * INTO prev FROM lc_wagers WHERE chat_id = p.chat_id AND settled_at > now() - interval '3 days' ORDER BY settled_at DESC LIMIT 1;
  v_deeper := (SELECT count(*) FROM lc_purchases WHERE chat_id = p.chat_id AND item = 'deeper' AND at > now() - interval '1 day');
  RETURN QUERY
  SELECT c.item, c.kind, c.title, c.blurb, c.price, s.state, s.note, coalesce(p.xp, 0) - p.xp_spent
  FROM lc_catalog() c CROSS JOIN LATERAL (SELECT
    CASE c.item
      WHEN 'freeze' THEN CASE WHEN p.freezes >= 2 THEN 'max' ELSE 'buy' END
      WHEN 'wager' THEN CASE WHEN w.id IS NOT NULL THEN 'active' WHEN p.last_active IS NULL OR p.last_active < current_date - 1 THEN 'locked' ELSE 'buy' END
      WHEN 'time' THEN CASE WHEN p.extra_time >= 3 THEN 'max' ELSE 'buy' END
      WHEN 'deeper' THEN CASE WHEN v_deeper >= 2 THEN 'max' ELSE 'buy' END
      ELSE CASE WHEN c.item IN (p.theme, p.badge) THEN 'worn' WHEN c.item = ANY (p.unlocks) THEN 'owned' WHEN c.price IS NULL THEN 'locked' ELSE 'buy' END
    END AS state,
    CASE c.item
      WHEN 'freeze' THEN format('You hold %s of 2.', p.freezes)
      WHEN 'wager' THEN CASE
        WHEN w.id IS NOT NULL THEN format('Bet on: %s of 7 days done.', LEAST(GREATEST(p.streak - w.start_streak, 0), 7))
        WHEN prev.result = 'won' THEN format('You won your last bet: +%s XP.', 2 * prev.stake)
        WHEN prev.result = 'lost' THEN 'Your last bet was lost when the streak ended.'
        WHEN p.last_active IS NULL OR p.last_active < current_date - 1 THEN 'Needs a streak going: play today first.' END
      WHEN 'time' THEN format('You hold %s of 3.', p.extra_time)
      WHEN 'deeper' THEN CASE WHEN v_deeper > 0 THEN format('%s bought today.', v_deeper) END
    END AS note) s
  ORDER BY c.sort;
END $f$;

CREATE OR REPLACE FUNCTION lc_buy(p_item text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE p lc_profile; c record; v_bal int;
BEGIN
  SELECT * INTO p FROM lc_profile WHERE user_id = auth.uid() FOR UPDATE; -- one purchase at a time: no double spending
  IF NOT FOUND THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO c FROM lc_catalog() k WHERE k.item = p_item;
  IF NOT FOUND OR c.price IS NULL THEN RAISE EXCEPTION 'That isn''t for sale'; END IF;
  IF coalesce(p.xp, 0) - p.xp_spent < c.price THEN RAISE EXCEPTION 'Not enough XP: that costs %, you have %', c.price, coalesce(p.xp, 0) - p.xp_spent; END IF;
  IF p_item = 'freeze' THEN
    IF p.freezes >= 2 THEN RAISE EXCEPTION 'You already hold 2 freezes, the most'; END IF;
    UPDATE lc_profile SET freezes = freezes + 1 WHERE chat_id = p.chat_id;
  ELSIF p_item = 'time' THEN
    IF p.extra_time >= 3 THEN RAISE EXCEPTION 'You already hold 3, the most'; END IF;
    UPDATE lc_profile SET extra_time = extra_time + 1 WHERE chat_id = p.chat_id;
  ELSIF p_item = 'deeper' THEN
    IF (SELECT count(*) FROM lc_purchases WHERE chat_id = p.chat_id AND item = 'deeper' AND at > now() - interval '1 day') >= 2 THEN
      RAISE EXCEPTION 'That''s 2 extra rounds today. Try again tomorrow';
    END IF;
  ELSIF p_item = 'wager' THEN
    IF EXISTS (SELECT 1 FROM lc_wagers WHERE chat_id = p.chat_id AND result IS NULL) THEN RAISE EXCEPTION 'You already have a bet going'; END IF;
    IF p.last_active IS NULL OR p.last_active < current_date - 1 THEN RAISE EXCEPTION 'Start a streak first: play today, then bet on it'; END IF;
    INSERT INTO lc_wagers (chat_id, stake, start_streak) VALUES (p.chat_id, c.price, p.streak);
  ELSE -- a theme or a title: yours for good
    IF p_item = ANY (p.unlocks) THEN RAISE EXCEPTION 'You already have it'; END IF;
    UPDATE lc_profile SET unlocks = unlocks || p_item WHERE chat_id = p.chat_id;
  END IF;
  UPDATE lc_profile SET xp_spent = xp_spent + c.price WHERE chat_id = p.chat_id RETURNING coalesce(xp, 0) - xp_spent INTO v_bal;
  INSERT INTO lc_purchases (chat_id, item, price) VALUES (p.chat_id, p_item, c.price);
  RETURN v_bal;
END $f$;

-- Wear (or take off, with p_on false) a theme or title you own. One of each at a time.
CREATE OR REPLACE FUNCTION lc_wear(p_item text, p_on boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  IF p_item !~ '^(theme|title):' THEN RAISE EXCEPTION 'Only themes and titles can be worn'; END IF;
  UPDATE lc_profile SET
    theme = CASE WHEN p_item LIKE 'theme:%' THEN CASE WHEN p_on THEN p_item WHEN theme = p_item THEN NULL ELSE theme END ELSE theme END,
    badge = CASE WHEN p_item LIKE 'title:%' THEN CASE WHEN p_on THEN p_item WHEN badge = p_item THEN NULL ELSE badge END ELSE badge END
  WHERE user_id = auth.uid() AND p_item = ANY (unlocks);
  IF NOT FOUND THEN RAISE EXCEPTION 'You don''t have that one yet'; END IF;
END $f$;

-- Spends one held Extra time. Returns how many are left.
CREATE OR REPLACE FUNCTION lc_use_time() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v int;
BEGIN
  UPDATE lc_profile SET extra_time = extra_time - 1 WHERE user_id = auth.uid() AND extra_time > 0 RETURNING extra_time INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'No extra time left'; END IF;
  RETURN v;
END $f$;

-- Titles of everyone in the league who wears one.
CREATE OR REPLACE FUNCTION lc_league_titles() RETURNS TABLE (name text, title text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT p.display_name, c.title FROM lc_profile p JOIN lc_catalog() c ON c.item = p.badge
  WHERE p.display_name IS NOT NULL AND lc_my_chat() IS NOT NULL
$f$;

-- Settles a bet whenever the streak moves, on the page's path and the bot's alike.
CREATE OR REPLACE FUNCTION lc_settle_wager() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE w lc_wagers;
BEGIN
  IF NEW.streak IS NOT DISTINCT FROM OLD.streak AND NEW.last_active IS NOT DISTINCT FROM OLD.last_active THEN RETURN NEW; END IF;
  SELECT * INTO w FROM lc_wagers WHERE chat_id = NEW.chat_id AND result IS NULL;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- A break: the streak went down, or a new day started it over at 1.
  IF NEW.streak < OLD.streak OR (NEW.last_active IS DISTINCT FROM OLD.last_active AND OLD.last_active IS NOT NULL AND NEW.streak <= 1) THEN
    UPDATE lc_wagers SET result = 'lost', settled_at = now() WHERE id = w.id;
  ELSIF NEW.streak >= w.start_streak + 7 THEN
    UPDATE lc_wagers SET result = 'won', settled_at = now() WHERE id = w.id;
    NEW.xp_spent := NEW.xp_spent - 2 * w.stake;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS lc_settle_wager ON lc_profile;
CREATE TRIGGER lc_settle_wager BEFORE UPDATE ON lc_profile FOR EACH ROW EXECUTE FUNCTION lc_settle_wager();

-- 007's award, plus the Starter boost: the call that first counts today starts 15 minutes of 2x XP,
-- and any award inside that window is doubled (after the 100 cap). It now also says what it gave.
DROP FUNCTION IF EXISTS lc_award_mine(int, boolean);
CREATE FUNCTION lc_award_mine(p_xp int, p_day_done boolean)
RETURNS TABLE (new_xp int, new_streak int, freezes int, saved boolean, earned boolean, gained int, boost_until timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE lc_profile p SET
    xp = p.xp + LEAST(GREATEST(coalesce(p_xp, 0), 0), 100) * CASE WHEN p.boost_until > now() THEN 2 ELSE 1 END,
    (streak, freezes, freeze_used_on, freeze_earned_on) =
      (SELECT * FROM lc_streak_step(p.last_active, p.streak, p.freezes, p.freeze_used_on, p.freeze_earned_on, coalesce(p_day_done, false))),
    last_active = CASE WHEN coalesce(p_day_done, false) THEN current_date ELSE p.last_active END,
    boost_until = CASE WHEN coalesce(p_day_done, false) AND (p.last_active IS NULL OR p.last_active < current_date)
                       THEN now() + interval '15 minutes' ELSE p.boost_until END
  FROM (SELECT chat_id, boost_until AS was FROM lc_profile WHERE user_id = auth.uid()) o -- the boost before this call
  WHERE p.chat_id = o.chat_id
  RETURNING p.xp, p.streak, p.freezes::int, coalesce(p.freeze_used_on = current_date, false), coalesce(p.freeze_earned_on = current_date, false),
    LEAST(GREATEST(coalesce(p_xp, 0), 0), 100) * CASE WHEN o.was > now() THEN 2 ELSE 1 END, p.boost_until
$f$;

-- 008's Go deeper, plus the extra rounds bought in the shop in the same 24 hours. Unchanged otherwise.
CREATE OR REPLACE FUNCTION lc_go_deeper(p_skill text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_me bigint := lc_my_chat(); v_id int; v_cap int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lc_cards WHERE chat_id = v_me AND skill = p_skill) THEN RAISE EXCEPTION 'That isn''t one of your skills'; END IF;
  IF EXISTS (SELECT 1 FROM lc_sources WHERE chat_id = v_me AND url = 'hub:deeper' AND skill = p_skill AND status IN ('queued', 'reading')) THEN
    RAISE EXCEPTION 'Already going deeper on that one';
  END IF;
  v_cap := 3 + (SELECT count(*) FROM lc_purchases WHERE chat_id = v_me AND item = 'deeper' AND at > now() - interval '1 day');
  IF (SELECT count(*) FROM lc_sources WHERE chat_id = v_me AND url = 'hub:deeper' AND created_at > now() - interval '1 day') >= v_cap THEN
    RAISE EXCEPTION 'That''s % deeper rounds today. Buy an extra one with XP, or try again tomorrow', v_cap;
  END IF;
  INSERT INTO lc_sources (chat_id, url, skill, title, status) VALUES (v_me, 'hub:deeper', p_skill, 'Deeper: ' || p_skill, 'queued')
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- Legendary: 100 XP a try, only on a skill at Expert (3 in 4 of its cards mastered, like the page's levels).
CREATE OR REPLACE FUNCTION lc_legendary_start(p_skill text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE p lc_profile; v_total int; v_mastered int; v_id int;
BEGIN
  SELECT * INTO p FROM lc_profile WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT count(*), count(*) FILTER (WHERE box >= 4) INTO v_total, v_mastered FROM lc_cards WHERE chat_id = p.chat_id AND skill = p_skill AND hidden IS NULL;
  IF v_total = 0 THEN RAISE EXCEPTION 'That isn''t one of your skills'; END IF;
  IF 4 * v_mastered < 3 * v_total THEN RAISE EXCEPTION 'Get this skill to Expert first'; END IF;
  IF EXISTS (SELECT 1 FROM lc_legendary WHERE chat_id = p.chat_id AND skill = p_skill AND won) THEN RAISE EXCEPTION 'That skill is already Legendary'; END IF;
  IF coalesce(p.xp, 0) - p.xp_spent < 100 THEN RAISE EXCEPTION 'Not enough XP: a Legendary run costs 100'; END IF;
  UPDATE lc_profile SET xp_spent = xp_spent + 100 WHERE chat_id = p.chat_id;
  INSERT INTO lc_purchases (chat_id, item, price) VALUES (p.chat_id, 'legendary', 100);
  INSERT INTO lc_legendary (chat_id, skill) VALUES (p.chat_id, p_skill) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- Ends a run, once, within the hour. A win is 40 XP and, the first time, the Legend title. Returns the XP given.
CREATE OR REPLACE FUNCTION lc_legendary_finish(p_id int, p_won boolean) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  UPDATE lc_legendary SET won = coalesce(p_won, false)
  WHERE id = p_id AND chat_id = lc_my_chat() AND won IS NULL AND started_at > now() - interval '1 hour';
  IF NOT FOUND THEN RAISE EXCEPTION 'That run is already over'; END IF;
  IF NOT coalesce(p_won, false) THEN RETURN 0; END IF;
  UPDATE lc_profile SET xp = xp + 40,
    unlocks = CASE WHEN 'title:legend' = ANY (unlocks) THEN unlocks ELSE unlocks || 'title:legend'::text END
  WHERE user_id = auth.uid();
  RETURN 40;
END $f$;

REVOKE ALL ON FUNCTION lc_catalog(), lc_settle_wager() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lc_shop(), lc_buy(text), lc_wear(text, boolean), lc_use_time(), lc_league_titles(), lc_award_mine(int, boolean),
  lc_go_deeper(text), lc_legendary_start(text), lc_legendary_finish(int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lc_shop(), lc_buy(text), lc_wear(text, boolean), lc_use_time(), lc_league_titles(), lc_award_mine(int, boolean),
  lc_go_deeper(text), lc_legendary_start(text), lc_legendary_finish(int, boolean) TO authenticated;

SELECT 'Hub XP shop ready' AS result;
