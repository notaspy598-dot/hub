// node tests/text.test.mjs
import assert from 'node:assert/strict';
import { closeEnough, shuffle } from '../public/text.js';

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
console.log('text checks passed');
