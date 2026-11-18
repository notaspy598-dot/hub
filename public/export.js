// Your data, to take elsewhere: cards as an Anki import file, or everything as JSON. Built in the browser from what
// the page can already read (your own rows only), so nothing new on the server. Flagged and archived cards are left out.
import { ankiTsv, localDay } from './text.js';

const $ = (id) => document.getElementById(id);
let sb;

// PostgREST returns at most 1000 rows a request, so read in pages until a short one comes back.
async function all(table, cols) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function save(name, text, type) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const run = (fn) => async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  $('export-msg').className = 'muted';
  $('export-msg').textContent = 'Getting your data…';
  try { $('export-msg').textContent = await fn(); } catch (err) {
    $('export-msg').className = 'error';
    $('export-msg').textContent = `Couldn't export (${err.message || err}).`;
  }
  b.disabled = false;
};

export function initExport(client) {
  sb = client;
  $('export-anki').addEventListener('click', run(async () => {
    const cards = await all('lc_cards', 'id, skill, question, options, answer, explanation');
    save(`hub-cards-${localDay()}.txt`, ankiTsv(cards), 'text/plain');
    return `Saved ${cards.length} cards. In Anki: File → Import, pick the file, choose a deck.`;
  }));
  $('export-json').addEventListener('click', run(async () => {
    const [sources, cards] = await Promise.all([
      all('lc_sources', 'id, url, title, skill, platform, key_ideas, lesson_url, created_at, archived_at'),
      all('lc_cards', 'id, source_id, skill, question, options, answer, explanation, box, due_at, reviews, last_result'),
    ]);
    save(`hub-backup-${localDay()}.json`, JSON.stringify({ exported_at: new Date().toISOString(), sources, cards }, null, 1), 'application/json');
    return `Saved ${sources.length} links and ${cards.length} cards.`;
  }));
}
