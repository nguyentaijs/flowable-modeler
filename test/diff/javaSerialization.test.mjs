import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeJavaSerialized, JavaSerializationError } from '../../src/core/javaSerialization.mjs';
import { decodeVar } from '../../src/core/runHistory.mjs';

const bytesOf = (hex) => new Uint8Array(Buffer.from(hex, 'hex'));
// Written by a real ObjectOutputStream (JDK 7): a LinkedHashMap with strings, numbers, BigDecimal, Date, nested list/map,
// a set, an int[], a null, and the same list twice (a back reference).
const MAP = bytesOf(readFileSync(new URL('../data/javaMap.hex', import.meta.url), 'utf8').trim());
// ArrayList ["a"], the textbook example
const LIST = bytesOf('aced0005737200136a6176612e7574696c2e41727261794c6973747881d21d99c7619d03000149000473697a65787000000001770400000001740001617' + '8');

test('decodes a real LinkedHashMap with nested values', () => {
  const v = decodeJavaSerialized(MAP);
  assert.deepEqual(Object.keys(v), ['outcome', 'limit', 'count', 'big', 'ok', 'ratio', 'none', 'when', 'items', 'tags', 'nums', 'again']);
  assert.equal(v.outcome, 'APPROVED');
  assert.equal(v.limit, 2000.5); // BigDecimal
  assert.equal(v.count, 3);
  assert.equal(v.big, 12345678901);
  assert.equal(v.ok, true);
  assert.equal(v.ratio, 0.5);
  assert.equal(v.none, null);
  assert.equal(v.when, '2024-05-01T10:00:00.000Z');
  assert.deepEqual(v.items, ['x', 7, { k: 'v' }]);
  assert.deepEqual(v.tags, ['t1']);
  assert.deepEqual(v.nums, [1, 2, 3]);
  assert.deepEqual(v.again, v.items); // back reference
});

test('decodes an ArrayList', () => {
  assert.deepEqual(decodeJavaSerialized(LIST), ['a']);
});

test('rejects what is not a Java stream, and truncated streams', () => {
  assert.throws(() => decodeJavaSerialized(bytesOf('00010203')), JavaSerializationError);
  assert.throws(() => decodeJavaSerialized(MAP.subarray(0, 60)), JavaSerializationError);
});

test('a Java-serialized variable is shown as its value; a broken one keeps the recovered strings', () => {
  assert.equal(decodeVar({ var_type_: 'serializable', bytearray_id_: 'b' }, { b: MAP }).outcome, 'APPROVED');
  const broken = decodeVar({ var_type_: 'serializable', bytearray_id_: 'b' }, { b: MAP.subarray(0, 200) });
  assert.match(broken._unreadable, /could not be decoded/);
  assert.ok(broken._recovered_strings.includes('outcome'));
});
