const vscode = require('vscode');
const os = require('os');
const path = require('path');

// Watches only the small live-state files under ~/.claude, never the
// transcripts — a live session appends to its .jsonl constantly and would
// flood us with events for no benefit (status already comes from these).
const WATCH_PATTERNS = ['sessions/*.json', 'jobs/**/state.json'];

const DEBOUNCE_MS = 400;
const RECONCILE_INTERVAL_MS = 20000;

function setupWatchers(context, onChange) {
  const base = vscode.Uri.file(path.join(os.homedir(), '.claude'));

  let timer;
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  };

  for (const pattern of WATCH_PATTERNS) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, pattern));
    watcher.onDidCreate(debounced);
    watcher.onDidChange(debounced);
    watcher.onDidDelete(debounced);
    context.subscriptions.push(watcher);
  }

  // Safety net: file watchers can be silenced by the user's
  // files.watcherExclude config, or briefly suspend if a watched directory
  // is deleted and recreated. A low-frequency poll keeps the list honest.
  const poll = setInterval(onChange, RECONCILE_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(poll) });
}

module.exports = { setupWatchers };
