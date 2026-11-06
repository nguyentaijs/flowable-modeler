// What the DMN editor suggests in a cell (src/core/dmnSuggestions.mjs): pure logic, no DOM. The popup itself is tested in
// test/webview/dmnEditor.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestionsFor, filterSuggestions, suggest, suggestOutput } from '../../src/core/dmnSuggestions.mjs';

const OPERATORS = ['==', '!=', '<', '<=', '>', '>='];
const labels = (list) => list.map((s) => s.label);
const texts = (list) => list.map((s) => s.text);
const selected = (s) => s.text.slice(s.from, s.to);
// the text with the caret (or the selection start/end) marked, to read what the user is left with
const withCaret = (s) => s.text.slice(0, s.from) + '|' + s.text.slice(s.to);

test('input templates per column type: operators as labels, caret placed where the value goes', () => {
  assert.deepEqual(labels(suggestionsFor('string')), ['==', '!=']);
  assert.deepEqual(suggestionsFor('string').map(withCaret), ['== "|"', '!= "|"']);
  assert.deepEqual(labels(suggestionsFor('number')), OPERATORS);
  assert.deepEqual(suggestionsFor('number').map(withCaret), ['== |', '!= |', '< |', '<= |', '> |', '>= |']);
  assert.deepEqual(texts(suggestionsFor('boolean')), ['== true', '== false', '!= true', '!= false']);
  assert.deepEqual(labels(suggestionsFor('boolean')), ['== true', '== false', '!= true', '!= false']);
  assert.deepEqual(labels(suggestionsFor('date')), OPERATORS);
  assert.equal(suggestionsFor('date')[0].text, "== date:toDate('1900-01-01')");
  assert.deepEqual(suggestionsFor('date').map(selected), Array(6).fill('1900-01-01'), 'the date is selected, ready to be overtyped');
});

test('no suggestions for an untyped or unknown column; intervals, not() and lists are never offered', () => {
  for (const type of ['', 'custom', undefined]) {
    assert.deepEqual(suggestionsFor(type), [], String(type));
    assert.deepEqual(suggestOutput(type), [], String(type));
  }
  const everything = ['string', 'number', 'boolean', 'date', 'collection'].flatMap((t) => texts(suggestionsFor(t)));
  assert.ok(everything.every((t) => !/\.\.|not\(|\[/.test(t)), 'Flowable does not support them');
});

test('typing narrows the templates; a complete cell has no suggestion left', () => {
  const string = suggestionsFor('string');
  const number = suggestionsFor('number');
  assert.equal(filterSuggestions(string, '').length, 2);
  assert.equal(filterSuggestions(string, '-').length, 2, 'the wildcard counts as empty');
  assert.deepEqual(texts(filterSuggestions(string, '!')), ['!= ""']);
  assert.deepEqual(texts(filterSuggestions(number, '>')), ['> ', '>= ']);
  assert.deepEqual(texts(filterSuggestions(number, '>=')), ['>= ']);
  assert.deepEqual(filterSuggestions(string, '== "A"'), []);
  assert.deepEqual(filterSuggestions(string, '== ""'), []);
});

test('collection: ${} is the label; picking writes the column expression, selected', () => {
  assert.deepEqual(suggestionsFor('collection').map(withCaret), ['${|}']);
  const [s] = suggest('collection', '', 0, ' orderCount ');
  assert.equal(s.label, '${}');
  assert.equal(s.text, '${orderCount}');
  assert.equal(selected(s), 'orderCount');
  assert.deepEqual(texts(filterSuggestions(suggestionsFor('collection'), '$')), ['${}']);
  assert.deepEqual(filterSuggestions(suggestionsFor('collection'), '${x}'), []);
});

test('a cell that has a value: the operator can be replaced and the value is kept', () => {
  const value = "date:toDate('1900-01-01')";
  const cell = `<= ${value}`;
  // operator deleted: every operator, caret right behind the new one
  const all = suggest('date', ` ${value}`, 0);
  assert.deepEqual(labels(all), OPERATORS);
  assert.equal(all[3].text, cell);
  assert.equal(all[3].from, 2);
  // partly deleted: the operators that start with it
  assert.deepEqual(labels(suggest('date', `< ${value}`, 1)), ['<', '<=']);
  // caret after a complete operator: that one; inside it: all of them
  assert.deepEqual(labels(suggest('date', cell, 2)), ['<=']);
  assert.equal(suggest('date', cell, 1).length, 6);
  // the same for the other types, with their own operators
  assert.deepEqual(labels(suggest('string', '== "A"', 1)), ['==', '!=']);
  assert.deepEqual(texts(suggest('string', '== "A"', 1)), ['== "A"', '!= "A"']);
  assert.deepEqual(texts(suggest('boolean', '== true', 0)), ['== true', '!= true']);
});

test('a cell that has a value: nothing is offered while the caret is in the value, or for collections', () => {
  assert.deepEqual(suggest('date', "<= date:toDate('1900-01-01')", 10), []);
  assert.deepEqual(suggest('string', '== "A"', 6), []);
  assert.deepEqual(suggest('collection', '${x}', 0), []);
  assert.deepEqual(texts(suggest('string', '!', 1)), ['!= ""'], 'an operator alone is not a value: templates');
});

test('output cells: values only, no operators', () => {
  assert.deepEqual(suggestOutput('string').map((s) => [s.label, s.text, s.from]), [['""', '""', 1]]);
  assert.deepEqual(texts(suggestOutput('boolean')), ['true', 'false']);
  assert.deepEqual(texts(suggestOutput('boolean', 't')), ['true']);
  assert.deepEqual(texts(suggestOutput('collection')), ['${}']);
  assert.equal(selected(suggestOutput('date')[0]), '1900-01-01');
  assert.deepEqual(suggestOutput('number'), [], 'numbers are typed as they are');
  assert.deepEqual(suggestOutput('string', '"A"'), [], 'a filled cell is complete');
});
