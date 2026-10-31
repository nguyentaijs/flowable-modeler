import { parseXml, elementChildren, canon, rootElement, escapeAttr, escapeText } from './xml.mjs';
import { isIgnoredElement, hasOrderedChildren, isIgnoredAttribute, normalizeValue, shouldWriteCdata } from './rules.mjs';

// Compute minimal text edits that turn `oldText` into a document canonically equal to `newText`.
// Untouched elements keep their original bytes (comments, CDATA, design:* pass-through, attribute order).
const cdata = (value) => '<![CDATA[' + value.replaceAll(']]>', ']]]]><![CDATA[>') + ']]>';

export function diffXml(oldText, newText) {
  const eol = oldText.includes('\r\n') ? '\r\n' : '\n';
  const O = rootElement(parseXml(oldText));
  const N = rootElement(parseXml(newText));
  const edits = [];

  // Leading whitespace of the line that `pos` is on.
  const lineIndent = (text, pos) => {
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    return /^[ \t]*/.exec(text.slice(ls))[0];
  };

  // Source slice of a new element, re-indented from its indentation in newText to `indent`.
  const reindent = (nEl, indent) => {
    const from = lineIndent(newText, nEl.start);
    // Cut out ignored descendants (see rules.mjs) with their own line, and turn text of cdataElement leaves into CDATA.
    const cuts = [];
    const collect = (el) => {
      for (const c of el.children) {
        if (c.type !== 'el') continue;
        if (isIgnoredElement(c)) {
          let s = c.start;
          while (newText[s - 1] === ' ' || newText[s - 1] === '\t') s--;
          if (newText[s - 1] === '\n') s--;
          if (newText[s - 1] === '\r') s--;
          cuts.push([s, c.end, '']);
        } else if (!c.selfClosing && !elementChildren(c).length && !c.children.some((x) => x.type === 'cdata') && shouldWriteCdata(c) && leafValue(c)) {
          cuts.push([c.openEnd, c.closeStart, cdata(c.children.filter((x) => x.type === 'text').map((x) => x.value).join(''))]);
        } else collect(c);
      }
    };
    collect({ children: [nEl] }); // nEl itself may be a leaf that needs CDATA
    let slice = '';
    let pos = nEl.start;
    for (const [s, e, text] of cuts.sort((a, b) => a[0] - b[0])) {
      slice += newText.slice(pos, s) + text;
      pos = e;
    }
    slice += newText.slice(pos, nEl.end);
    const lines = slice.split(/\r?\n/);
    return lines.map((l, k) => (k === 0 ? l : l.startsWith(from) ? indent + l.slice(from.length) : l)).join(eol);
  };

  const idKey = (el) => {
    const id = el.attrs.find((x) => x.name === 'id');
    return id ? el.name + '|' + id.value : null;
  };

  // Pair children of the old and new element. Children with an id pair by name|id. Children without one
  // (waypoints, <flowable:field>, ...) pair by longest common subsequence of identical content, then
  // positionally within each gap, so inserting or deleting one of them touches only that one.
  function matchChildren(ok, nk) {
    const match = new Map(); // new child -> old child
    const byId = new Map(ok.filter(idKey).map((c) => [idKey(c), c]));
    for (const c of nk) if (idKey(c) && byId.has(idKey(c))) match.set(c, byId.get(idKey(c)));
    const oi = ok.filter((c) => !idKey(c));
    const ni = nk.filter((c) => !idKey(c));
    const oc = oi.map(canon);
    const nc = ni.map(canon);
    const dp = Array.from({ length: oi.length + 1 }, () => new Array(ni.length + 1).fill(0));
    for (let i = oi.length - 1; i >= 0; i--) for (let j = ni.length - 1; j >= 0; j--) dp[i][j] = oc[i] === nc[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    let gapO = 0;
    let gapN = 0;
    const closeGap = (ei, ej) => {
      for (let k = 0; gapO + k < ei && gapN + k < ej; k++) if (oi[gapO + k].name === ni[gapN + k].name) match.set(ni[gapN + k], oi[gapO + k]);
    };
    while (i < oi.length && j < ni.length) {
      if (oc[i] === nc[j]) {
        closeGap(i, j);
        match.set(ni[j], oi[i]);
        i++;
        j++;
        gapO = i;
        gapN = j;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    closeGap(oi.length, ni.length);
    return match;
  }

  const replaceWhole = (o, n) => edits.push({ start: o.start, end: o.end, text: reindent(n, lineIndent(oldText, o.start)) });

  const isNs = (a) => a.name === 'xmlns' || a.name.startsWith('xmlns:');

  function diffAttrs(o, n) {
    const significant = (el) => el.attrs.filter((a) => !isNs(a) && !isIgnoredAttribute(el, a));
    const oa = new Map(significant(o).map((a) => [a.name, a]));
    const na = new Map(significant(n).map((a) => [a.name, a]));
    for (const [name, a] of oa) {
      const b = na.get(name);
      if (!b) {
        if (n.attrs.some((x) => x.name === name)) continue; // present in the output, but as an ignored attribute
        let s = a.start;
        while (/\s/.test(oldText[s - 1])) s--;
        edits.push({ start: s, end: a.end, text: '' });
      } else if (normalizeValue(n, b) !== normalizeValue(o, a)) {
        edits.push({ start: a.valStart, end: a.valEnd, text: escapeAttr(b.value) });
      }
    }
    // an ignored attribute of the old element (e.g. a spec default) that now has a real value is updated in place, not added twice
    const oldIgnored = new Map(o.attrs.filter((a) => !oa.has(a.name)).map((a) => [a.name, a]));
    for (const [name, b] of na) {
      const a = oldIgnored.get(name);
      if (a && !oa.has(name) && b.value !== a.value) edits.push({ start: a.valStart, end: a.valEnd, text: escapeAttr(b.value) });
    }
    const added = [...na].filter(([name]) => !oa.has(name) && !oldIgnored.has(name)).map(([, b]) => ` ${b.name}="${escapeAttr(b.value)}"`).join('');
    if (added) {
      const last = o.attrs[o.attrs.length - 1];
      const at = last ? last.end : o.start + 1 + o.name.length;
      edits.push({ start: at, end: at, text: added });
    }
  }

  const leafValue = (el) => {
    const v = el.children.filter((c) => c.type === 'text' || c.type === 'cdata').map((c) => c.value).join('');
    return v.trim() === '' ? '' : v;
  };

  function diffEl(o, n) {
    if (canon(o) === canon(n)) return;
    const ok = elementChildren(o);
    const nk = elementChildren(n);
    if (o.name !== n.name || (o.selfClosing && nk.length)) return replaceWhole(o, n);
    if (ok.length && nk.length && hasOrderedChildren(o)) {
      // matched children must keep their relative order, otherwise the element is rewritten as a whole
      const m = matchChildren(ok, nk);
      const seq = nk.map((c) => m.get(c)).filter(Boolean).map((c) => ok.indexOf(c));
      if (seq.some((v, i) => i && v < seq[i - 1])) return replaceWhole(o, n);
    }
    diffAttrs(o, n);
    if (!ok.length && !nk.length) {
      const value = leafValue(n);
      if (value === leafValue(o)) return;
      if (o.selfClosing) return replaceWhole(o, n);
      const useCdata = o.children.some((c) => c.type === 'cdata') || (value !== '' && shouldWriteCdata(n));
      const text = useCdata ? cdata(value) : escapeText(value);
      edits.push({ start: o.openEnd, end: o.closeStart, text });
      return;
    }
    const match = matchChildren(ok, nk);
    const matchedOld = new Set(match.values());
    for (const c of ok) {
      if (matchedOld.has(c)) continue;
      let s = c.start;
      while (oldText[s - 1] === ' ' || oldText[s - 1] === '\t') s--;
      if (oldText[s - 1] === '\n') s--;
      if (oldText[s - 1] === '\r') s--;
      edits.push({ start: s, end: c.end, text: '' });
    }
    const indentUnit = ok.length ? lineIndent(oldText, ok[0].start) : lineIndent(oldText, o.start) + '  ';
    let anchor = o.openEnd;
    let pending = [];
    const flush = () => {
      if (pending.length) edits.push({ start: anchor, end: anchor, text: pending.join('') });
      pending = [];
    };
    for (const c of nk) {
      const m = match.get(c);
      if (m) {
        flush();
        diffEl(m, c);
        anchor = m.end;
      } else {
        pending.push(eol + indentUnit + reindent(c, indentUnit));
      }
    }
    flush();
  }

  diffEl(O, N);
  return edits;
}

export function applyEdits(text, edits) {
  return [...edits].sort((a, b) => b.start - a.start || b.end - a.end).reduce((t, e) => t.slice(0, e.start) + e.text + t.slice(e.end), text);
}
