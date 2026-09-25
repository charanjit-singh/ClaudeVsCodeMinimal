const vscode = require('vscode');
const os = require('os');
const path = require('path');

const DEFAULT_PROFILES = [{ name: 'Claude' }];

function shellEscape(arg) {
  if (/^[A-Za-z0-9_\-./:]+$/.test(arg)) return arg;
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

function expandHome(p) {
  if (!p) return p;
  const trimmed = p.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

function getProfiles() {
  const raw = vscode.workspace.getConfiguration('claudeLauncher').get('profiles');
  const profiles = Array.isArray(raw) && raw.length ? raw : DEFAULT_PROFILES;
  // Names double as the key for tracking each profile's terminal — keep them
  // unique so "focus if open" doesn't pick up the wrong profile's terminal.
  return profiles.filter((p) => p && typeof p.name === 'string' && p.name.trim());
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

async function resolveProfile(profileArg) {
  const profiles = getProfiles();
  if (profileArg) {
    const match = profiles.find((p) => p.name === profileArg.name);
    if (match) return match;
  }
  if (profiles.length === 1) return profiles[0];
  const pick = await vscode.window.showQuickPick(
    profiles.map((p) => ({ label: p.name, description: p.configDir || undefined, profile: p })),
    { placeHolder: 'Which Claude profile?' }
  );
  return pick ? pick.profile : undefined;
}

function activate(context) {
  const iconUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'claude-icon-color.svg');

  // Tracks the terminal opened by the last "open or focus" / "new tab" call,
  // per profile (by name), so a plain click can find its own profile's
  // terminal again. VS Code gives extensions no way to tell a click from a
  // modifier-click on a custom command, so "new tab" is a separate command
  // rather than a real ⌘-click — see README.
  const currentByProfile = new Map();
  let statusItems = [];

  vscode.window.onDidCloseTerminal((closed) => {
    for (const [name, terminal] of currentByProfile) {
      if (terminal === closed) currentByProfile.delete(name);
    }
  });

  async function openNewTab(cwd, profile) {
    const terminal = vscode.window.createTerminal({
      name: `Claude Agents — ${profile.name}`,
      iconPath: iconUri,
      cwd,
      // Editor location opens as a TAB in the current editor group, like any
      // other file, rather than splitting a new terminal panel every time.
      location: vscode.TerminalLocation.Editor,
    });
    terminal.show();
    const skipPermissions = vscode.workspace
      .getConfiguration('claudeLauncher')
      .get('dangerouslySkipPermissions', true);
    const args = [];
    if (profile.configDir) {
      args.push(`CLAUDE_CONFIG_DIR=${shellEscape(expandHome(profile.configDir))}`);
    }
    args.push('claude', 'agents', `--cwd=${shellEscape(cwd)}`);
    if (skipPermissions) args.push('--dangerously-skip-permissions');
    terminal.sendText(args.join(' '));
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    currentByProfile.set(profile.name, terminal);
    return terminal;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeLauncher.openAgents', async (profileArg) => {
      const profile = await resolveProfile(profileArg);
      if (!profile) return;

      const existing = currentByProfile.get(profile.name);
      if (existing) {
        existing.show();
        return;
      }
      const cwd = await resolveCwd();
      if (!cwd) return;
      await openNewTab(cwd, profile);
    }),

    vscode.commands.registerCommand('claudeLauncher.newAgentsTab', async (profileArg) => {
      const profile = await resolveProfile(profileArg);
      if (!profile) return;

      const cwd = await resolveCwd();
      if (!cwd) return;
      await openNewTab(cwd, profile);
    })
  );

  // Right alignment + low priority pushes these to the far right edge of the
  // status bar, next to the built-in notification bell — VS Code has no API
  // to dock beside a specific native item, this is the closest equivalent.
  // One item per configured profile; priority order matches profile order.
  function rebuildStatusBar() {
    for (const item of statusItems) item.dispose();
    statusItems = getProfiles().map((profile, i) => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1 + i);
      // Status bar text only renders codicons ($(name)) or a custom icon font
      // registered via contributes.icons — it can't render our arbitrary SVG
      // (media/claude-icon-color.svg) the way the terminal tab icon can.
      // $(sparkle) is the closest built-in stand-in.
      item.text = `$(sparkle) ${profile.name}`;
      item.tooltip = `Claude Agents — ${profile.name} — click to open or focus\nCommand Palette → "Claude: New Agents Tab" to force a new one`;
      item.command = { command: 'claudeLauncher.openAgents', title: 'Open Claude Agents', arguments: [profile] };
      item.show();
      return item;
    });
  }

  rebuildStatusBar();
  context.subscriptions.push({ dispose: () => statusItems.forEach((i) => i.dispose()) });
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeLauncher.profiles')) rebuildStatusBar();
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
