const { XmlEditorProvider } = require('./xmlEditorProvider.js');
const { openDecision } = require('./decisionNavigation.js');

class BpmnEditorProvider extends XmlEditorProvider {
  static viewType = 'flowable.bpmnEditor';
  webviewName = 'webview';
  bodyHtml = '<div id="error" hidden></div><div id="layout"><div id="canvas"></div><div id="splitter" title="Drag to resize, double-click to reset"></div><aside id="panel"></aside></div>';

  constructor(context, log, index) {
    super(context, log);
    this.index = index;
  }

  // "Open decision" in the properties panel of a DMN task
  onWebviewMessage(msg) {
    if (msg.type !== 'openDecision') return false;
    openDecision(this.index, msg.key);
    return true;
  }
}

module.exports = { BpmnEditorProvider };
