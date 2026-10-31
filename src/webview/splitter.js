// Drag handle between the canvas and the properties panel. The width is clamped, restored from the webview
// state, and reset with a double click.
const MIN = 200;
const DEFAULT = 320;

export function mountSplitter({ splitter, panel, layout, vscode, onResize }) {
  const clamp = (w) => Math.max(MIN, Math.min(w, layout.clientWidth - 200));
  const apply = (w) => {
    panel.style.flexBasis = clamp(w) + 'px';
    onResize?.();
  };

  apply(vscode.getState()?.panelWidth ?? DEFAULT);

  splitter.addEventListener('pointerdown', (down) => {
    splitter.setPointerCapture(down.pointerId);
    document.body.classList.add('resizing');
    const move = (e) => apply(layout.getBoundingClientRect().right - e.clientX);
    const up = (e) => {
      splitter.releasePointerCapture(e.pointerId);
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      vscode.setState({ ...vscode.getState(), panelWidth: parseInt(panel.style.flexBasis, 10) });
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
  });

  splitter.addEventListener('dblclick', () => {
    apply(DEFAULT);
    vscode.setState({ ...vscode.getState(), panelWidth: DEFAULT });
  });

  window.addEventListener('resize', () => apply(parseInt(panel.style.flexBasis, 10) || DEFAULT));
}
