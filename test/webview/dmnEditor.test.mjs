// The DMN editor webview (src/webview/dmnMain.js) run in jsdom: the real source, bundled like the extension does and fed the
// way the extension feeds it. It covers what the user sees and does in the grid: the header line, "-" for wildcard cells, the
// type dropdown and the type-based suggestion popup. Pure logic (what is suggested, how text is stored) is tested in test/diff.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const FIXTURE = fs.readFileSync(new URL('../data/typedColumns.dmn', import.meta.url), 'utf8');
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../../src/webview/dmnMain.js', import.meta.url))],
  bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent',
});
const BUNDLE = outputFiles[0].text;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cells of a data row, in the order of the fixture: 6 input cells, then 5 output cells, then the description.
const IN = { string: 0, number: 1, boolean: 2, date: 3, collection: 4, untyped: 5 };
const OUT = { string: 6, number: 7, boolean: 8, date: 9, collection: 10 };
const EMPTY_ROW = 0; // every cell empty
const VALUES_ROW = 1; // every cell filled
const HEADER_ROWS = 4; // group, label, type + expression, allowed values

function openEditor(xml = FIXTURE) {
  const dom = new JSDOM('<div id="error" hidden></div><div id="app"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const posted = [];
  w.scrollTo = () => {}; // jsdom has no layout
  w.Element.prototype.scrollIntoView = () => {};
  w.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m) });
  w.eval(BUNDLE);
  w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'load', xml } }));
  const all = (selector) => [...w.document.querySelectorAll(selector)];
  const editor = {
    w, posted,
    error: () => w.document.getElementById('error').textContent,
    rows: () => all('.dmn-grid tr').slice(HEADER_ROWS),
    cell: (row, col) => editor.rows()[row].querySelectorAll('td input')[col],
    // texts of the open popup (empty when it is closed)
    popup: () => all('.suggest').filter((p) => !p.hidden).flatMap((p) => [...p.children].map((c) => c.textContent)),
    highlighted: () => all('.suggest-item.active')[0]?.textContent,
    typeSelect: (col) => all('.col-expr select')[col], // inputs first, then outputs
    expressionInput: (col) => all('.col-expr input')[col],
    // focuses a cell; with `text` the user has typed it, the caret at `caret` (default: the end)
    focus(row, col, text, caret = text?.length) {
      const input = editor.cell(row, col);
      input.focus();
      if (text !== undefined) {
        input.value = text;
        input.setSelectionRange(caret, caret);
        input.dispatchEvent(new w.Event('input'));
      }
      return input;
    },
    key: (input, key) => input.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
    change: (input, value) => {
      input.value = value;
      input.dispatchEvent(new w.Event('change'));
    },
    // the last document the editor sent to the extension (it sends changes after a short pause)
    async savedXml() {
      await sleep(250);
      return posted.filter((m) => m.type === 'changed').at(-1)?.xml;
    },
  };
  return editor;
}

test('the file opens without an error, with one grid row per rule', () => {
  const ed = openEditor();
  assert.equal(ed.error(), '');
  assert.equal(ed.rows().length, 2);
});

test('decision id, name, hit policy and aggregation share one line', () => {
  const heads = [...openEditor().w.document.querySelectorAll('.decision-head')];
  assert.equal(heads.length, 1);
  assert.deepEqual([...heads[0].querySelectorAll('label')].map((l) => l.textContent), ['Decision id', 'Name', 'Hit policy', 'Aggregation']);
});

test('the type dropdown offers string, number, boolean, date and collection', () => {
  assert.deepEqual([...openEditor().typeSelect(IN.string).options].map((o) => o.value), ['', 'string', 'number', 'boolean', 'date', 'collection']);
});

// ---- the "-" wildcard ---------------------------------------------------------------------------------------------

test('a "-" input cell is shown empty with "-" as the placeholder; output cells have none', () => {
  const ed = openEditor();
  assert.equal(ed.cell(VALUES_ROW, IN.number).value, '');
  assert.equal(ed.cell(VALUES_ROW, IN.number).placeholder, '-');
  assert.equal(ed.cell(EMPTY_ROW, IN.string).placeholder, '-');
  assert.equal(ed.cell(EMPTY_ROW, OUT.string).placeholder, '');
});

test('emptying an input cell stores the CDATA wildcard, emptying an output cell stores nothing', async () => {
  const ed = openEditor();
  ed.change(ed.cell(VALUES_ROW, IN.string), '');
  ed.change(ed.cell(VALUES_ROW, OUT.string), '');
  const xml = await ed.savedXml();
  assert.match(xml, /<inputEntry id="i2_s">\s*<text><!\[CDATA\[-\]\]><\/text>/);
  assert.match(xml, /<outputEntry id="o2_s">\s*<text><\/text>/);
  assert.equal(ed.cell(VALUES_ROW, IN.string).value, '', 'shown empty, the placeholder is the "-"');
});

// ---- suggestions for input cells ----------------------------------------------------------------------------------

test('input cells: the popup follows the column type', () => {
  const ed = openEditor();
  const OPERATORS = ['==', '!=', '<', '<=', '>', '>='];
  const expected = {
    string: ['==', '!='],
    number: OPERATORS,
    boolean: ['== true', '== false', '!= true', '!= false'],
    date: OPERATORS,
    collection: ['${}'],
    untyped: [],
  };
  for (const [type, labels] of Object.entries(expected)) {
    ed.focus(EMPTY_ROW, IN[type]);
    assert.deepEqual(ed.popup(), labels, type);
  }
});

test('the popup narrows as the user types and closes once the cell is complete', () => {
  const ed = openEditor();
  ed.focus(EMPTY_ROW, IN.string, '!');
  assert.deepEqual(ed.popup(), ['!=']);
  ed.focus(EMPTY_ROW, IN.number, '>');
  assert.deepEqual(ed.popup(), ['>', '>=']);
  ed.focus(EMPTY_ROW, IN.string, '== "A"');
  assert.deepEqual(ed.popup(), []);
});

test('Enter picks the highlighted suggestion: inserted, caret inside the quotes, stored as CDATA', async () => {
  const ed = openEditor();
  const input = ed.focus(EMPTY_ROW, IN.string);
  ed.key(input, 'ArrowDown');
  assert.equal(ed.highlighted(), '!=');
  ed.key(input, 'Enter');
  assert.equal(input.value, '!= ""');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [4, 4]);
  assert.deepEqual(ed.popup(), [], 'closed after picking');
  assert.match(await ed.savedXml(), /<inputEntry id="i1_s">\s*<text><!\[CDATA\[!= ""\]\]><\/text>/);
});

test('clicking a suggestion picks it; Escape and leaving the cell close the popup', () => {
  const ed = openEditor();
  const input = ed.focus(EMPTY_ROW, IN.number);
  const items = ed.w.document.querySelectorAll('.suggest-item');
  items[3].dispatchEvent(new ed.w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert.equal(input.value, '<= ');

  ed.focus(EMPTY_ROW, IN.number, '');
  ed.key(input, 'Escape');
  assert.deepEqual(ed.popup(), []);

  ed.focus(EMPTY_ROW, IN.number, '');
  input.blur();
  assert.deepEqual(ed.popup(), []);
});

test('date suggestions insert date:toDate with the date selected', () => {
  const ed = openEditor();
  const input = ed.focus(EMPTY_ROW, IN.date);
  ed.key(input, 'Enter');
  assert.equal(input.value, "== date:toDate('1900-01-01')");
  assert.equal(input.value.slice(input.selectionStart, input.selectionEnd), '1900-01-01');
});

test('collection suggestion shows ${} and inserts the column expression, also after the expression was edited', () => {
  const ed = openEditor();
  const input = ed.focus(EMPTY_ROW, IN.collection);
  assert.deepEqual(ed.popup(), ['${}']);
  ed.key(input, 'Enter');
  assert.equal(input.value, '${orderCount}');
  assert.equal(input.value.slice(input.selectionStart, input.selectionEnd), 'orderCount');

  ed.change(ed.expressionInput(IN.collection), 'items');
  ed.focus(EMPTY_ROW, IN.collection, '');
  ed.key(input, 'Enter');
  assert.equal(input.value, '${items}');
});

test('a cell with a value: the operator can be replaced and the value is kept', () => {
  const ed = openEditor();
  const input = ed.focus(VALUES_ROW, IN.date, " date:toDate('1900-01-01')", 0); // operator deleted
  assert.deepEqual(ed.popup(), ['==', '!=', '<', '<=', '>', '>=']);
  ed.key(input, 'ArrowDown');
  ed.key(input, 'ArrowDown');
  ed.key(input, 'Enter');
  assert.equal(input.value, "< date:toDate('1900-01-01')");
  assert.equal(input.selectionStart, 1);

  ed.focus(VALUES_ROW, IN.date, "<= date:toDate('1900-01-01')", 12); // caret in the value
  assert.deepEqual(ed.popup(), []);
});

// ---- suggestions for output cells ---------------------------------------------------------------------------------

test('output cells: values only, no operators', () => {
  const ed = openEditor();
  const expected = { string: ['""'], number: [], boolean: ['true', 'false'], date: ["date:toDate('')"], collection: ['${}'] };
  for (const [type, labels] of Object.entries(expected)) {
    ed.focus(EMPTY_ROW, OUT[type]);
    assert.deepEqual(ed.popup(), labels, type);
  }
  ed.focus(VALUES_ROW, OUT.string);
  assert.deepEqual(ed.popup(), [], 'a filled cell is complete');
});

// ---- changing the type of a column --------------------------------------------------------------------------------

test('changing the type of a column changes its suggestions and is written to the file', async () => {
  const ed = openEditor();
  ed.focus(EMPTY_ROW, IN.string);
  assert.deepEqual(ed.popup(), ['==', '!=']);
  ed.change(ed.typeSelect(IN.string), 'collection');
  ed.focus(EMPTY_ROW, IN.string);
  assert.deepEqual(ed.popup(), ['${}'], 'the cells were rebuilt for the new type');
  assert.match(await ed.savedXml(), /<inputExpression id="ie_s" typeRef="collection">/);
});

test('a column whose type is cleared gets no popup', () => {
  const ed = openEditor();
  ed.change(ed.typeSelect(IN.number), '');
  ed.focus(EMPTY_ROW, IN.number);
  assert.deepEqual(ed.popup(), []);
});

// ---- the last edit is never lost ----------------------------------------------------------------------------------

test('a change still waiting is sent at once when the editor is closed or hidden', () => {
  for (const close of [(w) => w.dispatchEvent(new w.Event('pagehide')), (w) => {
    Object.defineProperty(w.document, 'visibilityState', { value: 'hidden', configurable: true });
    w.document.dispatchEvent(new w.Event('visibilitychange'));
  }]) {
    const ed = openEditor();
    ed.change(ed.cell(VALUES_ROW, OUT.string), '"changed just now"');
    assert.equal(ed.posted.filter((m) => m.type === 'changed').length, 0, 'still waiting for the pause');
    close(ed.w);
    const sent = ed.posted.filter((m) => m.type === 'changed');
    assert.equal(sent.length, 1);
    assert.ok(sent[0].xml.includes('changed just now'));
    close(ed.w);
    assert.equal(ed.posted.filter((m) => m.type === 'changed').length, 1, 'nothing pending: nothing sent twice');
  }
});
