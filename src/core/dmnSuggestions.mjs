// Suggestions for an input cell of a decision table, by the column's typeRef. Flowable evaluates JUEL: a cell is
// "<operator> <value>" (the engine puts the column's input expression in front of it), or ${...} for a pure expression.
// Each suggestion: { label, text, from, to } - the text to put in the cell and the selection to leave in it (the caret when
// from === to), so the user types the value straight away. No intervals, not(...) or lists: Flowable does not support them.

const EQ = ['==', '!='];
const CMP = ['==', '!=', '<', '<=', '>', '>='];

const at = (text, from, to = from) => ({ text, from, to });

const BUILDERS = {
  string: () => EQ.map((op) => ({ label: op, ...at(`${op} ""`, op.length + 2) })),
  number: () => CMP.map((op) => ({ label: op, ...at(`${op} `, op.length + 1) })),
  boolean: () => EQ.flatMap((op) => ['true', 'false'].map((v) => ({ label: `${op} ${v}`, ...at(`${op} ${v}`, `${op} ${v}`.length) }))),
  date: () => CMP.map((op) => {
    const text = `${op} date:toDate('1900-01-01')`;
    const from = text.indexOf('1900');
    return { label: op, ...at(text, from, from + '1900-01-01'.length) };
  }),
  // the label is ${}; picking it writes the column's own input expression (e.g. ${orderCount}) and selects it
  collection: (expression) => [{ label: '${}', ...at('${' + expression + '}', 2, 2 + expression.length) }],
};

export const suggestionsFor = (typeRef, expression = '') => (BUILDERS[typeRef] ? BUILDERS[typeRef](expression.trim()) : []);

// The suggestions that still fit what is typed in the cell: an empty cell (or the "-" wildcard) shows all of them, otherwise
// the typed text must be the start of a suggestion, so "!" leaves the != ones and a complete cell leaves none.
export function filterSuggestions(list, typed) {
  const t = typed.trim();
  if (t === '' || t === '-') return list;
  return list.filter((s) => s.text.startsWith(t) && s.text !== t);
}

// ---- editing the operator of a cell that already has a value ----------------------------------------------------------
const OPERATORS = { string: EQ, number: CMP, boolean: EQ, date: CMP };
const OPERATOR_PREFIX = /^\s*(==|!=|<=|>=|<|>|=|!)?/;

// What to offer for a cell holding `text` with the caret at `caret`. When the cell has a value after its operator and the caret is
// in the operator (e.g.  <=| date:toDate('1900-01-01')  or  | date:toDate('1900-01-01')  after the operator was deleted),
// only the operators are offered and picking one replaces the operator and keeps the value. Otherwise the templates of
// `suggestionsFor`, filtered by what is typed.
export function suggest(typeRef, text, caret = text.length, expression = '') {
  const ops = OPERATORS[typeRef];
  const t = text.trim();
  if (ops && t !== '' && t !== '-') {
    const m = OPERATOR_PREFIX.exec(text);
    const rest = text.slice(m[0].length);
    if (rest.trim() !== '' && caret <= m[0].length) {
      const typed = m[1] ?? '';
      // caret at the end of what is typed: the operators that continue it; inside it (or before it): all of them
      const fit = caret < m[0].length ? ops : ops.filter((o) => o.startsWith(typed));
      return fit.map((op) => ({ label: op, ...at(`${op} ${rest.trimStart()}`, op.length) }));
    }
  }
  return filterSuggestions(suggestionsFor(typeRef, expression), text);
}

// ---- output cells -------------------------------------------------------------------------------------------------------
// An output cell is a value, not a test: no operator. Numbers are typed as they are, so they get no suggestion.
const OUTPUT = {
  string: () => [{ label: '""', ...at('""', 1) }],
  boolean: () => ['true', 'false'].map((v) => ({ label: v, ...at(v, v.length) })),
  date: () => {
    const text = "date:toDate('1900-01-01')";
    const from = text.indexOf('1900');
    return [{ label: "date:toDate('')", ...at(text, from, from + '1900-01-01'.length) }];
  },
  collection: () => [{ label: '${}', ...at('${}', 2) }],
};

export const suggestOutput = (typeRef, text = '') => filterSuggestions(OUTPUT[typeRef] ? OUTPUT[typeRef]() : [], text);
