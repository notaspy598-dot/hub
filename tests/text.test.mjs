// node tests/text.test.mjs
import assert from 'node:assert/strict';
import { closeEnough, shuffle, grade, level, toMastery } from '../public/text.js';

assert.ok(closeEnough('Paris', 'paris'));
assert.ok(closeEnough('  café!', 'Cafe'));
assert.ok(closeEnough('confirmation bais', 'Confirmation bias'), 'one typo in a long answer');
assert.ok(closeEnough('parsi', 'Paris') && closeEnough('jupitr', 'Jupiter'), 'a swap or a missing letter is one typo');
assert.ok(!closeEnough('prsi', 'Paris'), 'two typos in a short word is too many');
assert.ok(!closeEnough('confirmaton bais', 'bias'), 'unrelated');
assert.ok(!closeEnough('cat', 'car'), 'short answers are exact');
assert.ok(!closeEnough('1991', '1990'), 'digits are exact');
assert.ok(!closeEnough('in 1991 AD', 'in 1990 AD'), 'digits are exact in longer answers too');
assert.ok(!closeEnough('', 'x') && !closeEnough('!!', '??'), 'empty never passes');
assert.ok(closeEnough('Москва', 'москва'), 'non-Latin text is kept, not stripped');
assert.ok(!closeEnough('Лондон', 'Москва'));
assert.deepEqual(shuffle([1, 2, 3, 4]).sort(), [1, 2, 3, 4]);
assert.deepEqual([grade(4, 4), grade(4, 5), grade(3, 5), grade(1, 2), grade(0, 0)], ['S', 'A', 'B', 'C', 'C']);
assert.deepEqual([level(0, 0), level(2, 10), level(1, 4), level(5, 10), level(3, 4), level(4, 4)], [0, 0, 1, 2, 3, 3], 'Novice <25%, Learner, Solid from 50%, Expert from 75%');
assert.deepEqual([toMastery(0, 0), toMastery(0, 10), toMastery(1, 10), toMastery(3, 1), toMastery(40, 10)], [0, 0, 3, 75, 100], 'one correct answer already moves the meter');
console.log('text checks passed');

// localDay and ankiTsv (sql/010's local days, the Anki export).
{
  const { localDay, ankiTsv } = await import('../public/text.js');
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05', 'the device calendar, not UTC');
  const tsv = ankiTsv([{ question: 'Why\tthis?', options: ['a', 'b\nc'], answer: 1, explanation: 'Because.', skill: 'Colour theory' }]);
  assert.equal(tsv, '#separator:tab\n#html:false\n#tags column:3\nWhy this? (A) a (B) b c\tb c — Because.\tColour_theory\n');
  assert.equal(ankiTsv([{ question: 'q', options: null, answer: 0 }]).split('\n')[3], 'q\t\t', 'a broken card still makes one row');
}
