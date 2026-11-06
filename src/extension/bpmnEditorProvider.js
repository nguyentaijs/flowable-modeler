const { XmlEditorProvider } = require('./xmlEditorProvider.js');
const { openDecision } = require('./decisionNavigation.js');
const { newBpmn } = require('../core/templates.mjs');

class BpmnEditorProvider extends XmlEditorProvider {
  static viewType = 'flowable.bpmnEditor';
  webviewName = 'webview';
  bodyHtml = '<div id="error" hidden></div><div id="layout"><div id="canvas"></div><div id="splitter" title="Drag to resize, double-click to reset"></div><aside id="panel"></aside></div><a id="author-link" href="https://www.linkedin.com/in/nguyentaijs" title="Opens LinkedIn">Contact the author</a>';

  constructor(context, log, index) {
    super(context, log);
    this.index = index;
  }

  emptyTemplate(document) {
    return newBpmn(document.uri.path);
  }

  // "Open decision" in the properties panel of a DMN task
  onWebviewMessage(msg, document) {
    if (msg.type !== 'openDecision') return false;
    openDecision(this.index, msg.key, document.uri);
    return true;
  }
}

module.exports = { BpmnEditorProvider };
