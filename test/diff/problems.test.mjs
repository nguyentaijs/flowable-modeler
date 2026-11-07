import test from 'node:test';
import assert from 'node:assert/strict';
import { toProblemItems } from '../../src/core/problems.mjs';

const diag = (severity, line, message, code, character = 0) => ({ severity, message, code, range: { start: { line, character }, end: { line, character: character + 3 } } });

test('toProblemItems: plain data with names for the severities', () => {
  const [item] = toProblemItems([diag(1, 4, 'msg', 'unique-ids', 7)]);
  assert.deepEqual(item, { severity: 'warning', message: 'msg', code: 'unique-ids', line: 4, character: 7, endLine: 4, endCharacter: 10 });
  assert.deepEqual(toProblemItems([diag(0, 0, 'a'), diag(2, 0, 'b'), diag(3, 0, 'c')]).map((i) => i.severity), ['error', 'information', 'hint']);
});

test('toProblemItems: the code can be a string, a number, {value} or missing', () => {
  const codes = [diag(0, 0, 'm', 'a'), diag(0, 1, 'm', 12), diag(0, 2, 'm', { value: 'v', target: {} }), diag(0, 3, 'm', undefined)];
  assert.deepEqual(toProblemItems(codes).map((i) => i.code), ['a', '12', 'v', '']);
});

test('toProblemItems: errors first, then by position; limited', () => {
  const list = [diag(1, 1, 'w1'), diag(0, 9, 'e9'), diag(1, 0, 'w0'), diag(0, 2, 'e2', 'x', 5), diag(0, 2, 'e2b', 'x', 1)];
  assert.deepEqual(toProblemItems(list).map((i) => i.message), ['e2b', 'e2', 'e9', 'w0', 'w1']);
  assert.equal(toProblemItems(list, 2).length, 2);
  assert.deepEqual(toProblemItems([]), []);
});
