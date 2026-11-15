-- Hub, phase 1. Run once in Supabase Studio → SQL Editor. Safe to run again.

-- Learning Coach tables (same as the n8n "Run Once: Setup"; here so the order doesn't matter).
CREATE TABLE IF NOT EXISTS lc_sources (id serial PRIMARY KEY, chat_id bigint NOT NULL, url text, platform text, title text, skill text, transcript text, lesson_url text, job_id text, status text DEFAULT 'generating', created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS lc_cards (id serial PRIMARY KEY, source_id int REFERENCES lc_sources(id) ON DELETE CASCADE, chat_id bigint NOT NULL, skill text, question text, options jsonb, answer int, explanation text, box int DEFAULT 0, due_at timestamptz DEFAULT now(), last_result boolean, reviews int DEFAULT 0);
CREATE INDEX IF NOT EXISTS lc_cards_due ON lc_cards (chat_id, due_at);
CREATE TABLE IF NOT EXISTS lc_profile (chat_id bigint PRIMARY KEY, xp int DEFAULT 0, streak int DEFAULT 0, last_active date);
ALTER TABLE lc_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE lc_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE lc_profile ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION lc_esc(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $f$;

-- Your web login ↔ your Telegram chat.
ALTER TABLE lc_profile ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION lc_my_chat() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT chat_id FROM lc_profile WHERE user_id = auth.uid()
$f$;

-- The page calls this on login with the TELEGRAM_ID env var. It only claims a chat nobody owns yet,
-- and never moves a login that is already linked.
CREATE OR REPLACE FUNCTION lc_link_me(p_chat bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM lc_profile WHERE user_id = auth.uid()) THEN
    INSERT INTO lc_profile (chat_id, user_id) VALUES (p_chat, auth.uid())
    ON CONFLICT (chat_id) DO UPDATE SET user_id = auth.uid() WHERE lc_profile.user_id IS NULL;
  END IF;
  RETURN EXISTS (SELECT 1 FROM lc_profile WHERE user_id = auth.uid());
END $f$;

-- One grading rule for the bot and the page: Leitner boxes (1,2,4,8,16,32 days), +10 XP right, +2 wrong, daily streak.
-- Only cards that are due can be graded, so re-answering a card gives nothing.
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
           streak = CASE WHEN p.last_active = current_date THEN p.streak WHEN p.last_active = current_date - 1 THEN p.streak + 1 ELSE 1 END,
           last_active = current_date
         RETURNING xp, streak)
SELECT ok.correct, ok.question, ok.options->>ok.answer, ok.explanation, prof.streak, prof.xp FROM ok, prof
$f$;

-- The page's entry point: grades only your own cards.
CREATE OR REPLACE FUNCTION lc_grade_mine(p_card int, p_choice int)
RETURNS TABLE (is_correct boolean, q_text text, answer_text text, expl text, new_streak int, new_xp int)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  SELECT * FROM lc_grade(p_card, p_choice, lc_my_chat())
$f$;

REVOKE ALL ON FUNCTION lc_grade(int, int, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lc_grade_mine(int, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION lc_my_chat() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION lc_link_me(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lc_grade_mine(int, int), lc_my_chat(), lc_link_me(bigint) TO authenticated;
-- The Telegram bot calls lc_grade through n8n's Postgres credential. If that credential uses
-- a user other than postgres, add it here: GRANT EXECUTE ON FUNCTION lc_grade(int, int, bigint) TO <user>;
GRANT EXECUTE ON FUNCTION lc_grade(int, int, bigint) TO postgres;

-- The page can read your learning data; every change goes through the functions above.
REVOKE ALL ON lc_profile, lc_cards, lc_sources FROM anon, authenticated;
GRANT SELECT ON lc_profile, lc_cards, lc_sources TO authenticated;
DROP POLICY IF EXISTS lc_profile_own ON lc_profile;
DROP POLICY IF EXISTS lc_cards_own ON lc_cards;
DROP POLICY IF EXISTS lc_sources_own ON lc_sources;
CREATE POLICY lc_profile_own ON lc_profile FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY lc_cards_own ON lc_cards FOR SELECT TO authenticated USING (chat_id = (SELECT lc_my_chat()));
CREATE POLICY lc_sources_own ON lc_sources FOR SELECT TO authenticated USING (chat_id = (SELECT lc_my_chat()));

-- Style board. Generated outfits are items too (source = 'generated').
CREATE TABLE IF NOT EXISTS style_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  path text NOT NULL,            -- object path in the style-images bucket: <user id>/<file>
  source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'generated')),
  notes text,
  colors text[] NOT NULL DEFAULT '{}',
  pieces text[] NOT NULL DEFAULT '{}',
  styles text[] NOT NULL DEFAULT '{}',
  tags jsonb NOT NULL DEFAULT '{}',   -- the AI's full answer (fabrics, silhouette, ...)
  tagged_at timestamptz,
  prompt text,                   -- generated only
  based_on uuid[],               -- generated only: the items it was inspired by
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS style_items_user ON style_items (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS style_profile (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  summary text,
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE style_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE style_profile ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON style_items, style_profile FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON style_items TO authenticated;
GRANT SELECT ON style_profile TO authenticated;
DROP POLICY IF EXISTS style_items_own ON style_items;
DROP POLICY IF EXISTS style_profile_own ON style_profile;
CREATE POLICY style_items_own ON style_items FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY style_profile_own ON style_profile FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Private image bucket (10 MB per file); each user only touches their own folder.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('style-images', 'style-images', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS style_images_own ON storage.objects;
CREATE POLICY style_images_own ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'style-images' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'style-images' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

SELECT 'Hub phase 1 ready' AS result;
