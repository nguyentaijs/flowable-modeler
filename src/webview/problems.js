// The problems bar shared by both designers: the validators' diagnostics of this file, as a pill at the bottom-left that
// expands to a list. The host sends {type: 'problems', items} (see core/problems.mjs); "Show in XML" asks it to open the
// text editor at the item's range ({type: 'showText', line, character, endLine, endCharacter}).
const ICONS = { error: '✖', warning: '⚠', information: 'ⓘ', hint: '•' };

const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function mountProblems(vscode) {
  const root = el('div', { id: 'problems', hidden: true });
  document.body.append(root);
  let items = [];
  let expanded = false;

  const summary = () => {
    const count = (s) => items.filter((i) => i.severity === s).length;
    return [['error', 'error'], ['warning', 'warning'], ['information', 'info']]
      .filter(([s]) => count(s))
      .map(([s, word]) => `${count(s)} ${word}${count(s) === 1 || word === 'info' ? '' : 's'}`)
      .join(', ') || plural(items.length, 'problem');
  };

  const render = () => {
    root.hidden = items.length === 0;
    if (root.hidden) return;
    const worst = items.some((i) => i.severity === 'error') ? 'error' : items.some((i) => i.severity === 'warning') ? 'warning' : 'information';
    const pill = el('button', { type: 'button', className: `problems-pill ${worst}`, title: expanded ? 'Hide the problems' : 'Show the problems of this file' }, `${ICONS[worst]} ${summary()} ${expanded ? '▾' : '▴'}`);
    pill.addEventListener('click', () => {
      expanded = !expanded;
      render();
    });
    const nodes = [];
    if (expanded) {
      const list = el('ul', { className: 'problems-list' });
      for (const item of items) {
        const link = el('button', { type: 'button', className: 'problems-link', title: 'Open the XML at this problem' }, 'Show in XML');
        link.addEventListener('click', () => vscode.postMessage({ type: 'showText', line: item.line, character: item.character, endLine: item.endLine, endCharacter: item.endCharacter }));
        list.append(el('li', { className: item.severity }, el('span', { className: 'problems-icon', textContent: ICONS[item.severity] ?? ICONS.hint }), el('span', { className: 'problems-message', textContent: item.message }), el('span', { className: 'problems-where', textContent: `${item.code ? item.code + ' · ' : ''}line ${item.line + 1}` }), link));
      }
      nodes.push(list);
    }
    nodes.push(pill);
    root.replaceChildren(...nodes);
  };

  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'problems') return;
    items = Array.isArray(event.data.items) ? event.data.items : [];
    render();
  });
}
