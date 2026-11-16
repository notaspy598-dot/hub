-- Hub: key ideas per link. Run after 003_web.sql in Supabase Studio → SQL Editor. Safe to run again.

-- n8n writes a short lesson with each link's cards: [{ "point": "...", "explain": "..." }, ...].
-- The page shows it before that link's cards are first quizzed. The existing SELECT grant and policy cover the new column.
ALTER TABLE lc_sources ADD COLUMN IF NOT EXISTS key_ideas jsonb;

SELECT 'Hub lessons setup ready' AS result;
