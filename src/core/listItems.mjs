// Editable lists of repeated child elements inside <extensionElements> (e.g. <flowable:field>, <flowable:in>).
// An item spec, taken from the panel field, describes one row:
//
//   { type: 'flowable:field',                       // element name as written in the XML
//     columns: [
//       { key: 'name', label: 'Key', as: 'attr' },                            // XML attribute
//       { key: 'value', label: 'Value', as: 'child',                          // text of a child element
//         childTypes: ['string', 'expression'] },                             // which child element holds it
//       { key: 'src', label: 'Source', as: 'attrChoice',                      // ONE of several attributes
//         choices: [{ key: 'source', label: 'variable' },
//                   { key: 'sourceExpression', label: 'expression', expression: true, wins: true }] },
//     ] }
//
// A row is a plain object {name, value, valueType, src, srcType, __extra, __children}. `child` and `attrChoice`
// columns store which child element / attribute is used in `<key>Type`. Anything the spec does not describe
// (other attributes such as transient=, other child elements) is carried in __extra / __children, so
// rewriting a list never drops data. Generic (descriptor-less) moddle elements keep their attributes as direct
// properties and their child elements in $children.
const FLOWABLE_NS = 'http://flowable.org/bpmn';

const local = (type) => type.slice(type.indexOf(':') + 1);
const MODDLE_KEYS = new Set(['$type', '$children', '$attrs', '$parent', '$body', '$instanceOf']);

const known = (spec) => new Set(spec.columns.flatMap((c) => (c.as === 'attrChoice' ? c.choices.map((x) => x.key) : c.as === 'attr' ? [c.key] : c.childTypes.includes('string') ? ['stringValue', ...c.childTypes] : c.childTypes)));

// Attribute choice used by an existing element: the one the engine would use ("wins"), else the first set one.
function chosen(el, col) {
  const set = col.choices.filter((c) => el[c.key] !== undefined && el[c.key] !== '');
  return set.find((c) => c.wins) ?? set[0] ?? col.choices[0];
}

export function readRow(el, spec) {
  const row = {};
  Object.defineProperty(row, '__source', { value: el, enumerable: false }); // lets buildElement reuse an untouched element as is
  const skip = known(spec);
  for (const col of spec.columns) {
    if (col.as === 'child') {
      const child = (el.$children ?? []).find((c) => col.childTypes.includes(local(c.$type)));
      if (child) {
        row[col.key] = child.$body ?? '';
        row[col.key + 'Type'] = local(child.$type);
      } else {
        // value given as an attribute instead, e.g. <flowable:field name="x" stringValue="y"/>
        const attrType = col.childTypes.find((t) => el[t === 'string' ? 'stringValue' : t] !== undefined);
        row[col.key] = attrType ? el[attrType === 'string' ? 'stringValue' : attrType] : '';
        row[col.key + 'Type'] = attrType ?? col.childTypes[0];
      }
    } else if (col.as === 'attrChoice') {
      const c = chosen(el, col);
      row[col.key] = el[c.key] ?? '';
      row[col.key + 'Type'] = c.key;
    } else {
      row[col.key] = el[col.key] ?? el.$attrs?.[col.key] ?? '';
    }
  }
  const extra = {};
  for (const [k, v] of Object.entries(el)) if (!MODDLE_KEYS.has(k) && !skip.has(k) && !spec.columns.some((c) => c.key === k)) extra[k] = v;
  const attrChoiceKeys = new Set(spec.columns.filter((c) => c.as === 'attrChoice').flatMap((c) => c.choices.map((x) => x.key)));
  for (const k of attrChoiceKeys) delete extra[k];
  if (Object.keys(extra).length) row.__extra = extra;
  const others = (el.$children ?? []).filter((c) => !spec.columns.some((col) => col.as === 'child' && col.childTypes.includes(local(c.$type))));
  if (others.length) row.__children = others;
  return row;
}

export function emptyRow(spec) {
  return Object.fromEntries(spec.columns.flatMap((c) => (c.as === 'child' ? [[c.key, ''], [c.key + 'Type', c.childTypes[0]]] : c.as === 'attrChoice' ? [[c.key, ''], [c.key + 'Type', c.choices[0].key]] : [[c.key, '']])));
}

const sameColumns = (spec, a, b) => spec.columns.every((c) => a[c.key] === b[c.key] && (c.as === 'attr' || a[c.key + 'Type'] === b[c.key + 'Type']));

// Build a generic moddle element for a row. Empty attributes are left out.
function buildElement(moddle, spec, row) {
  // a row the user did not change keeps its original element, so its representation (e.g. stringValue="..") is not rewritten
  if (row.__source && sameColumns(spec, row, readRow(row.__source, spec))) return row.__source;
  const props = { ...(row.__extra ?? {}) };
  const children = [];
  for (const col of spec.columns) {
    if (col.as === 'child') {
      if (row[col.key] !== undefined && row[col.key] !== '') children.push(moddle.createAny(`flowable:${row[col.key + 'Type'] ?? col.childTypes[0]}`, FLOWABLE_NS, { $body: row[col.key] }));
    } else if (col.as === 'attrChoice') {
      const key = row[col.key + 'Type'] ?? col.choices[0].key;
      if (row[col.key] !== undefined && row[col.key] !== '') props[key] = row[col.key]; // only the chosen attribute is written
    } else if (row[col.key] !== undefined && row[col.key] !== '') {
      props[col.key] = row[col.key];
    }
  }
  children.push(...(row.__children ?? []));
  if (children.length) props.$children = children;
  return moddle.createAny(spec.type, FLOWABLE_NS, props);
}

// New `values` for an <extensionElements>: every item of this type replaced by the given rows, in place.
// Rows go where the first existing item was; with none, after the last other flowable element, else first.
export function replaceItems(moddle, values, spec, rows) {
  const items = rows.map((r) => buildElement(moddle, spec, r));
  const isItem = (v) => v.$type === spec.type;
  const first = values.findIndex(isItem);
  const rest = values.filter((v) => !isItem(v));
  if (first >= 0) {
    const before = values.slice(0, first).filter((v) => !isItem(v)).length;
    return [...rest.slice(0, before), ...items, ...rest.slice(before)];
  }
  let at = 0;
  rest.forEach((v, i) => {
    if (v.$type?.startsWith('flowable:')) at = i + 1;
  });
  return [...rest.slice(0, at), ...items, ...rest.slice(at)];
}
