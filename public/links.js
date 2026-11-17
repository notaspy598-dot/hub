import { level, LEVELS } from './text.js';
import { play } from './sound.js';
// Add a link → lc_add_link queues it → n8n's "Learning Coach: Web Links" workflow makes the key ideas and cards.
// The OpenMAIC lesson is on demand: "Build lesson" → lc_request_lesson queues it → the same workflow builds it.
// The list shows each link's progress and, per skill, how much you've mastered (what the bot's /stats showed).
const $ = (id) => document.getElementById(id);
const BUSY = ['queued', 'reading', 'lesson_queued', 'generating'];
const opened = new Set(); // Key ideas you've expanded stay open when the list refreshes.
let sb, webhook, onCards, timer, was = new Map(); // was: each link's status at the last refresh

export function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.filter((k) => k != null));
  return node;
}
// An icon from the sprite in index.html.
export function icon(name, extra = '') {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), use = document.createElementNS(NS, 'use');
  svg.setAttribute('class', `ico ${extra}`.trim()); svg.setAttribute('aria-hidden', 'true'); use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

// The workflow only processes rows that are still 'queued' ('lesson_queued' for a lesson), so pinging twice is harmless.
// no-cors: we never read the answer, so n8n needs no CORS setup.
const ping = (id, lesson) => webhook && fetch(`${webhook}?source_id=${id}${lesson ? '&step=lesson' : ''}`, { method: 'POST', mode: 'no-cors' }).catch(() => {});
// The workflow gives up on a lesson after 40 minutes; anything still "in progress" after 2 hours got stuck.
const stuck = (s) => BUSY.includes(s.status) && Date.now() - Date.parse(s.lesson_requested_at || s.created_at) > 2 * 3600e3;

async function buildLesson(id, btn) {
  btn.disabled = true;
  $('link-error').textContent = '';
  const { error } = await sb.rpc('lc_request_lesson', { p_id: id });
  if (error) { btn.disabled = false; $('link-error').textContent = error.message; return; }
  ping(id, true);
  loadLinks();
}

// The lesson link shows as soon as its first parts exist; n8n keeps the note on how far it's got.
function status(s, cards) {
  const lesson = s.lesson_url && el('a', { href: s.lesson_url, target: '_blank', rel: 'noopener' }, 'Open lesson', icon('external'));
  // A playlist has no cards of its own: n8n queued its videos, and lc_drip lets one a day into this list.
  if (s.status === 'ready' && s.platform === 'playlist') return [el('span', { className: 'pip ready' }), el('span', { className: 'muted', textContent: s.note || 'Playlist added. One video a day.' })];
  if (s.status === 'ready' && lesson) return [el('span', { className: 'pip ready' }), lesson];
  // Cards exist but no lesson yet, or the lesson failed or got stuck: offer to build it.
  const offer = cards > 0 && (s.status === 'ready' || s.status === 'failed' || stuck(s));
  const build = !offer ? null : el('button', { type: 'button', className: 'btn btn-light btn-sm', onclick: (e) => buildLesson(s.id, e.currentTarget) },
    s.status === 'ready' ? 'Build lesson' : 'Try the lesson again');
  if (s.status === 'ready') return [el('span', { className: 'pip ready' }), el('span', { className: 'muted', textContent: `${cards} cards ready` }), build];
  let text, bad = s.status === 'failed';
  if (stuck(s)) { bad = true; text = cards ? `${cards} cards saved, but the lesson never finished.` : 'This one got stuck. Try adding it again.'; }
  else text = { queued: 'Waiting to start…', reading: 'Reading the content…', lesson_queued: 'Lesson waiting to start…', generating: lesson ? s.note || 'More parts on the way…' : 'Building the lesson…', failed: s.note || 'Something went wrong.' }[s.status] ?? s.note ?? s.status;
  // State is shape and word, not colour alone: solid dot ready, dashed spinner working, square failed.
  const pip = el('span', { className: `pip ${bad ? 'bad' : 'busy'}` });
  const msg = el('span', { className: bad ? 'bad' : 'muted', textContent: text });
  return [pip, ...(lesson ? [lesson, ' · '] : []), msg, build];
}

// A link's key ideas: the short lesson its quiz questions test. One swipeable card each, coloured like the Learn tab's.
const LANES = ['coral', 'gold', 'mint', 'blue'];
export const ideas = (list) => el('ol', { className: 'ideas', ariaLabel: `${list.length} key ideas, swipe for more` },
  ...list.map((k, i) => el('li', { className: `idea-card lane-${LANES[i % 4]}` },
    el('small', { textContent: `${i + 1} of ${list.length}` }), el('b', { textContent: k.point }), k.explain ? el('p', { textContent: k.explain }) : null)));

// Per skill: cards, mastered (box 4+) and due.
const bySkill = (cards, now = '') => {
  const skills = {};
  for (const c of cards) {
    const k = (skills[c.skill || 'Other'] ||= { total: 0, mastered: 0, due: 0 });
    k.total++; k.mastered += c.box >= 4; k.due += c.due_at <= now;
  }
  return skills;
};
// Each skill's level, so the Starter can tell when one goes up.
export async function skillLevels() {
  const { data } = await sb.from('lc_cards').select('skill, box').limit(2000);
  return Object.fromEntries(Object.entries(bySkill(data ?? [])).map(([name, k]) => [name, level(k.mastered, k.total)]));
}

// Go deeper: the AI writes the next layer of a skill you already have, as a new "link" in the list.
async function goDeeper(skill, btn) {
  btn.disabled = true;
  $('skills-error').textContent = '';
  const { data: id, error } = await sb.rpc('lc_go_deeper', { p_skill: skill });
  if (error) { btn.disabled = false; $('skills-error').textContent = error.message; return; }
  ping(id);
  loadLinks();
}

export async function loadLinks() {
  // The next video from an imported playlist, once a day (null when none is due, or before sql/008 is run).
  const drip = await sb.rpc('lc_drip');
  if (drip.data) ping(drip.data);
  const [src, cards] = await Promise.all([
    sb.from('lc_sources').select('id, url, title, skill, platform, status, note, lesson_url, key_ideas, created_at, lesson_requested_at').order('created_at', { ascending: false }).limit(20),
    sb.from('lc_cards').select('source_id, skill, box, due_at').limit(2000),
  ]);
  if (src.error || cards.error) return;
  // A link you were waiting on just turned into cards: the effort you put in pays off, so it gets a chime.
  if (src.data.some((s) => s.status === 'ready' && BUSY.includes(was.get(s.id)))) play('ready');
  was = new Map(src.data.map((s) => [s.id, s.status]));
  const perSource = {}, skills = bySkill(cards.data, new Date().toISOString());
  for (const c of cards.data) perSource[c.source_id] = (perSource[c.source_id] || 0) + 1;
  $('links').replaceChildren(...src.data.map((s) => el('li', {},
    el('span', { className: 'title', textContent: s.title || s.url }), s.skill ? el('span', { className: 'skill', textContent: s.skill }) : null,
    el('span', { className: 'state' }, ...status(s, perSource[s.id] || 0)),
    s.key_ideas?.length ? el('details', { open: opened.has(s.id), ontoggle: (e) => opened[e.target.open ? 'add' : 'delete'](s.id) },
      el('summary', {}, icon('chevron', 'chev'), 'Key ideas'), ideas(s.key_ideas)) : null)));
  $('links-empty').hidden = src.data.length > 0;
  // Ranked by share mastered, most first. Each skill shows its level (Novice to Expert) from that share.
  $('skills').replaceChildren(...Object.entries(skills).sort(([, a], [, b]) => b.mastered / b.total - a.mastered / a.total).map(([name, k]) => {
    const lv = level(k.mastered, k.total);
    return el('li', {}, el('span', { className: `level lv-${lv}`, textContent: LEVELS[lv] }), el('b', { textContent: name }),
      el('span', { className: 'meter', role: 'img', ariaLabel: `${k.mastered} of ${k.total} mastered` }, el('i', { style: `width:${Math.round(100 * k.mastered / k.total)}%` })),
      el('small', { textContent: `${k.mastered}/${k.total} mastered · ${k.due} due` }),
      name === 'Other' ? null : el('button', { type: 'button', className: 'btn btn-light btn-sm', onclick: (e) => goDeeper(name, e.currentTarget) }, 'Go deeper'));
  }));
  $('skills-card').hidden = !cards.data.length;

  // Keep checking while something is in progress; new cards also update the header.
  clearTimeout(timer);
  if (src.data.some((s) => BUSY.includes(s.status) && !stuck(s))) timer = setTimeout(() => { loadLinks(); onCards(); }, 15000);
  return src.data;
}

export function initLinks(client, hook, changed) {
  sb = client; webhook = hook; onCards = changed;
  if (!webhook) $('link-error').textContent = 'Adding links needs LINK_WEBHOOK set in Coolify.';
  // Shared from another app (Android share sheet → manifest share_target): fill in the first link, you tap Add.
  const shared = new URLSearchParams(location.search);
  const found = `${shared.get('url') || ''} ${shared.get('text') || ''}`.match(/https?:\/\/\S+/);
  if (found) { $('link-form').elements.url.value = found[0]; history.replaceState(null, '', location.pathname + location.hash); }
  $('link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.elements.url, btn = e.target.querySelector('button');
    $('link-error').textContent = '';
    btn.disabled = true;
    const { data: id, error } = await sb.rpc('lc_add_link', { p_url: input.value });
    btn.disabled = false;
    if (error) { $('link-error').textContent = error.message; return; }
    input.value = '';
    ping(id);
    if (!webhook) $('link-error').textContent = 'Saved, but nothing will process it until LINK_WEBHOOK is set in Coolify.';
    loadLinks();
  });
}

// After login: show the list and restart anything that never reached n8n (offline when added, n8n down, ...).
export async function startLinks() {
  const rows = await loadLinks();
  rows?.filter((s) => ['queued', 'lesson_queued'].includes(s.status) && !stuck(s)).forEach((s) => ping(s.id, s.status === 'lesson_queued'));
}
