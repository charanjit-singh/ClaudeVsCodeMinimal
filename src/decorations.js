const vscode = require('vscode');
const { themeColorFor } = require('./colors');

// FileDecoration.color is the only supported way to tint a TreeItem's LABEL
// TEXT — it never touches the icon, so it composes cleanly with the status
// icon (which owns the one available icon slot).
const SCHEME = 'claude-agent';

function resourceUriFor(kind, id) {
  return vscode.Uri.parse(`${SCHEME}://${kind}/${encodeURIComponent(id)}`);
}

class ColorDecorationProvider {
  constructor(stateStore) {
    this.stateStore = stateStore;
    this._onDidChangeFileDecorations = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  }

  refresh() {
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri) {
    if (uri.scheme !== SCHEME) return undefined;
    // uri.path is already percent-decoded by Uri.parse — decoding again here
    // would be a no-op for our ids today, but is wrong in principle.
    const id = uri.path.slice(1);
    const colorId = uri.authority === 'group' ? this.stateStore.groupColor(id) : this.stateStore.agentColor(id);
    const themeColor = themeColorFor(colorId);
    return themeColor ? new vscode.FileDecoration(undefined, undefined, themeColor) : undefined;
  }
}

module.exports = { ColorDecorationProvider, resourceUriFor, SCHEME };
