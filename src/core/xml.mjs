import { isIgnoredElement, hasOrderedChildren, isIgnoredAttribute, normalizeValue } from './rules.mjs';

// Range-preserving XML parser: every node knows its offsets in the source text.
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decode(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return e in ENT ? ENT[e] : m;
  });
}

export function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Element: {type:'el', name, attrs:[{name,value,start,end,valStart,valEnd,quote}], children,
//           start, openEnd, closeStart, end, selfClosing, parent}
// Other nodes: {type:'text'|'cdata'|'comment'|'pi', value, start, end}
export function parseXml(src) {
  const root = { type: 'doc', children: [] };
  let i = 0;
  let cur = root;
  const n = src.length;
  while (i < n) {
    if (src[i] !== '<') {
      const j = src.indexOf('<', i);
      const end = j < 0 ? n : j;
      cur.children.push({ type: 'text', value: decode(src.slice(i, end)), start: i, end });
      i = end;
    } else if (src.startsWith('<!--', i)) {
      const j = src.indexOf('-->', i);
      if (j < 0) throw new Error('Unterminated comment at ' + i);
      cur.children.push({ type: 'comment', value: src.slice(i + 4, j), start: i, end: j + 3 });
      i = j + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const j = src.indexOf(']]>', i);
      if (j < 0) throw new Error('Unterminated CDATA at ' + i);
      cur.children.push({ type: 'cdata', value: src.slice(i + 9, j), start: i, end: j + 3 });
      i = j + 3;
    } else if (src[i + 1] === '?') {
      const j = src.indexOf('?>', i);
      if (j < 0) throw new Error('Unterminated PI at ' + i);
      cur.children.push({ type: 'pi', value: src.slice(i, j + 2), start: i, end: j + 2 });
      i = j + 2;
    } else if (src[i + 1] === '/') {
      const j = src.indexOf('>', i);
      const name = src.slice(i + 2, j).trim();
      if (cur.type !== 'el' || cur.name !== name) throw new Error(`Mismatched </${name}> at ${i}`);
      cur.closeStart = i;
      cur.end = j + 1;
      cur = cur.parent;
      i = j + 1;
    } else {
      const m = /^<([^\s/>]+)/.exec(src.slice(i, i + 256));
      if (!m) throw new Error('Bad tag at ' + i);
      const el = { type: 'el', name: m[1], attrs: [], children: [], start: i, parent: cur };
      let p = i + m[0].length;
      for (;;) {
        while (/\s/.test(src[p])) p++;
        if (src[p] === '>' || (src[p] === '/' && src[p + 1] === '>')) break;
        const am = /^([^\s=]+)\s*=\s*(["'])/.exec(src.slice(p, p + 512));
        if (!am) throw new Error('Bad attribute at ' + p);
        const quote = am[2];
        const valStart = p + am[0].length;
        const valEnd = src.indexOf(quote, valStart);
        el.attrs.push({ name: am[1], value: decode(src.slice(valStart, valEnd)), start: p, end: valEnd + 1, valStart, valEnd, quote });
        p = valEnd + 1;
      }
      if (src[p] === '/') {
        el.selfClosing = true;
        el.openEnd = el.closeStart = el.end = p + 2;
        cur.children.push(el);
        i = p + 2;
      } else {
        el.openEnd = p + 1;
        cur.children.push(el);
        cur = el;
        i = p + 1;
      }
    }
  }
  if (cur !== root) throw new Error('Unclosed element ' + cur.name);
  return root;
}

export const idOf = (el) => el.attrs.find((a) => a.name === 'id')?.value;
export const elementChildren = (el) => el.children.filter((c) => c.type === 'el' && !isIgnoredElement(c));

// Canonical, whitespace/CDATA/attribute-order-insensitive form used to decide "did this change".
export function canon(el) {
  const attrs = el.attrs
    .filter((a) => a.name !== 'xmlns' && !a.name.startsWith('xmlns:'))
    .filter((a) => !isIgnoredAttribute(el, a))
    .map((a) => a.name + '=' + JSON.stringify(normalizeValue(el, a)))
    .sort()
    .join(' ');
  const kids = elementChildren(el);
  let body;
  if (kids.length === 0) {
    // whitespace-only content is the same as no content (left over when ignored children are cut out)
    const value = el.children.filter((c) => c.type === 'text' || c.type === 'cdata').map((c) => c.value).join('');
    body = JSON.stringify(value.trim() === '' ? '' : value);
  } else {
    // Children with an id are keyed (order-insensitive: modelers reorder DI and flow elements freely);
    // id-less children (waypoints, extension values) keep their order.
    if (hasOrderedChildren(el)) {
      const ordered = el.children.filter((c) => c.type === 'el' ? !isIgnoredElement(c) : (c.type === 'text' && c.value.trim()) || c.type === 'cdata' || c.type === 'comment');
      return `<${el.name} ${attrs}>${ordered.map((c) => (c.type === 'el' ? canon(c) : c.type + ':' + JSON.stringify(c.value.trim()))).join(',')}</>`;
    }
    const other = el.children
      .filter((c) => (c.type === 'el' && !idOf(c) && !isIgnoredElement(c)) || (c.type === 'text' && c.value.trim()) || c.type === 'cdata' || c.type === 'comment')
      .map((c) => (c.type === 'el' ? canon(c) : c.type + ':' + JSON.stringify(c.value.trim())));
    const keyed = kids.filter(idOf).map((c) => [c.name + '|' + idOf(c), canon(c)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    body = other.join(',') + '|' + keyed.map((k) => k[1]).join(',');
  }
  return `<${el.name} ${attrs}>${body}</>`;
}

export const rootElement = (doc) => doc.children.find((c) => c.type === 'el');

// Human-readable location of the first canonical difference between two elements (for diagnostics).
export function firstDifference(a, b, path = '') {
  if (canon(a) === canon(b)) return null;
  const here = `${path}/${a.name}${a.attrs.find((x) => x.name === 'id') ? '[' + a.attrs.find((x) => x.name === 'id').value + ']' : ''}`;
  if (a.name !== b.name) return `${here}: element ${a.name} vs ${b.name}`;
  const pairKeys = (list) => {
    const seen = {};
    return new Map(list.map((c) => [idOf(c) ? c.name + '|' + idOf(c) : c.name + '#' + (seen[c.name] = (seen[c.name] || 0) + 1), c]));
  };
  const ka = pairKeys(elementChildren(a));
  const kb = pairKeys(elementChildren(b));
  for (const k of new Set([...ka.keys(), ...kb.keys()])) {
    if (!ka.has(k) || !kb.has(k)) return `${here}: child ${k} is ${ka.has(k) ? 'only in patched text' : 'only in modeler output'}`;
    if (canon(ka.get(k)) !== canon(kb.get(k))) return firstDifference(ka.get(k), kb.get(k), here);
  }
  return `${here}: attributes/text differ\n  patched: ${canon(a).slice(0, 240)}\n  modeler: ${canon(b).slice(0, 240)}`;
}
