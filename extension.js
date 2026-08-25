const vscode = require('vscode');

function shellEscape(arg) {
  if (/^[A-Za-z0-9_\-./:]+$/.test(arg)) return arg;
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

// Single-root assumption covers the common case; multi-root prompts, no
// workspace falls back to a folder picker — same resolution the old sidebar
// used for "New Agent Here".
async function resolveCwd() {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length === 1) return folders[0].uri.fsPath;
  if (folders && folders.length > 1) {
    const pick = await vscode.window.showQuickPick(
      folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
      { placeHolder: 'Open Claude Agents in which folder?' }
    );
    return pick ? pick.folder.uri.fsPath : undefined;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Open Claude Agents Here',
  });
  return picked && picked[0] ? picked[0].fsPath : undefined;
}

function activate(context) {
  const iconUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'claude-icon-color.svg');

  // Tracks the terminal opened by the last "open or focus" / "new tab" call so
  // a plain click can find it again. VS Code gives extensions no way to tell
  // a click from a modifier-click on a custom command, so "new tab" is a
  // separate command rather than a real ⌘-click — see README.
  let current;

  vscode.window.onDidCloseTerminal((closed) => {
    if (closed === current) current = undefined;
  });

  async function openNewTab(cwd) {
    const terminal = vscode.window.createTerminal({
      name: 'Claude Agents',
      iconPath: iconUri,
      cwd,
      // Editor location opens as a TAB in the current editor group, like any
      // other file, rather than splitting a new terminal panel every time.
      location: vscode.TerminalLocation.Editor,
    });
    terminal.show();
    terminal.sendText(`claude agents --cwd=${shellEscape(cwd)}`);
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    current = terminal;
    return terminal;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeLauncher.openAgents', async () => {
      if (current) {
        current.show();
        return;
      }
      const cwd = await resolveCwd();
      if (!cwd) return;
      await openNewTab(cwd);
    }),

    vscode.commands.registerCommand('claudeLauncher.newAgentsTab', async () => {
      const cwd = await resolveCwd();
      if (!cwd) return;
      await openNewTab(cwd);
    })
  );

  // Right alignment + low priority pushes this to the far right edge of the
  // status bar, next to the built-in notification bell — VS Code has no API
  // to dock beside a specific native item, this is the closest equivalent.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
  // Status bar text only renders codicons ($(name)) or a custom icon font
  // registered via contributes.icons — it can't render our arbitrary SVG
  // (media/claude-icon-color.svg) the way the old activity-bar icon and
  // terminal tab icon could. $(sparkle) is the closest built-in stand-in.
  status.text = '$(sparkle) Claude';
  status.tooltip = 'Claude Agents — click to open or focus\nCommand Palette → "Claude: New Agents Tab" to force a new one';
  status.command = 'claudeLauncher.openAgents';
  status.show();
  context.subscriptions.push(status);
}

function deactivate() {}

module.exports = { activate, deactivate };
