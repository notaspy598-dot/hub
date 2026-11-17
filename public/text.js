// Pure helpers for the Learn tab (no DOM, no network), so tests/text.test.mjs can check them in Node.

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();

// Edit distance where swapping two neighbouring letters counts as one typo.
function distance(a, b) {
  let older = [], prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], older[j - 2] + 1);
    }
    older = prev; prev = cur;
  }
  return prev[b.length];
}

// Fill the blank: ignores case, accents and punctuation, and allows about one typo per 5 letters.
// Short answers (4 letters or fewer) and any digits must be exact, so "1990" never passes for "1991".
export function closeEnough(guess, answer) {
  const g = norm(guess), a = norm(answer);
  if (!g || !a) return false;
  if (g.replace(/\D/g, '') !== a.replace(/\D/g, '')) return false;
  return distance(g, a) <= (a.length <= 4 ? 0 : Math.floor(a.length / 5));
}

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Skill level from the share of a skill's cards mastered (box 4+): 0 Novice, 1 Learner, 2 Solid, 3 Expert.
export const LEVELS = ['Novice', 'Learner', 'Solid', 'Expert'];
export const level = (mastered, total) => Math.min(3, Math.floor(4 * (total ? mastered / total : 0)));

// Rank letter from a share of right answers: all of them is S.
export const grade = (right, total) => {
  const r = total ? right / total : 0;
  return r >= 1 ? 'S' : r >= 0.8 ? 'A' : r >= 0.6 ? 'B' : 'C';
};
