const vscode = require('vscode');
const os = require('os');
const path = require('path');

const DEFAULT_PROFILES = [{ name: 'Claude' }];

const ANSI_COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

function config() {
  return vscode.workspace.getConfiguration('claudeLauncher');
}

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

function themeColorFor(profile) {
  const color = typeof profile.color === 'string' ? profile.color.toLowerCase() : '';
  if (!ANSI_COLORS.includes(color)) return undefined;
  return new vscode.ThemeColor(`terminal.ansi${color[0].toUpperCase()}${color.slice(1)}`);
}

function colorIcon(color) {
  return color
    ? new vscode.ThemeIcon('circle-filled', themeColorFor({ color }))
    : new vscode.ThemeIcon('circle-outline');
}

function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function terminalName(profile) {
  return `Claude Agents — ${profile.name}`;
}

function getProfiles() {
  const raw = config().get('profiles');
  const profiles = Array.isArray(raw) && raw.length ? raw : DEFAULT_PROFILES;
  // Names double as the key for tracking each profile's terminal — keep them
  // unique so "focus if open" doesn't pick up the wrong profile's terminal.
  return profiles.filter((p) => p && typeof p.name === 'string' && p.name.trim());
}

function getDefaultProfile(profiles = getProfiles()) {
  const name = config().get('defaultProfile');
  return name ? profiles.find((p) => p.name === name) : undefined;
}

// A workspace pinned to one profile shows only that profile's button.
function getVisibleProfiles() {
  const profiles = getProfiles();
  const pinned = getDefaultProfile(profiles);
  return pinned ? [pinned] : profiles;
}

// Single-root assumption covers the common case; multi-root prompts, no
// workspace falls back to a folder picker.
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

// profileArg comes from a status bar click (the profile object) or a custom
// keybinding's args ({ "name": "Work" }); both carry `name`.
async function resolveProfile(profileArg) {
  const profiles = getProfiles();
  if (profileArg && profileArg.name) {
    const match = profiles.find((p) => p.name === profileArg.name);
    if (match) return match;
  }
  const fallback = getDefaultProfile(profiles);
  if (fallback) return fallback;
  if (profiles.length === 1) return profiles[0];
  const pick = await vscode.window.showQuickPick(
    profiles.map((p) => ({ label: p.name, description: p.configDir || undefined, profile: p })),
    { placeHolder: 'Which Claude profile?' }
  );
  return pick ? pick.profile : undefined;
}

// Write back to whichever level already defines the list, so a workspace
// override isn't silently copied into user settings (or vice versa).
async function saveProfiles(profiles) {
  const info = config().inspect('profiles');
  const target =
    info && info.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  const clean = profiles.map((p) => {
    const out = { name: p.name };
    if (p.configDir) out.configDir = p.configDir;
    if (p.color) out.color = p.color;
    return out;
  });
  await config().update('profiles', clean, target);
}

async function pickColor(current) {
  const items = [
    { label: 'No color', color: undefined, iconPath: colorIcon(undefined) },
    ...ANSI_COLORS.map((c) => ({ label: capitalize(c), color: c, iconPath: colorIcon(c) })),
  ];
  for (const item of items) if (item.color === current) item.description = 'current';
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Pick a color' });
  return pick ? { color: pick.color } : undefined;
}

async function askName(profiles, current) {
  return vscode.window.showInputBox({
    prompt: 'Profile name, shown on its status bar button',
    value: current,
    placeHolder: 'e.g. Work',
    validateInput: (v) => {
      const name = v.trim();
      if (!name) return 'Name cannot be empty';
      if (name !== current && profiles.some((p) => p.name === name)) return 'A profile with this name already exists';
      return undefined;
    },
  });
}

async function askConfigDir(current) {
  return vscode.window.showInputBox({
    prompt: 'Claude config folder for this profile (CLAUDE_CONFIG_DIR). Leave blank for the default ~/.claude',
    value: current || '',
    placeHolder: '~/.claude-work',
  });
}

function activate(context) {
  const iconUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'claude-icon-color.svg');

  // Tracks each profile's terminal (by profile name) so a plain click focuses
  // it again. VS Code gives extensions no way to tell a click from a
  // modifier-click on a custom command, so "new tab" is a separate command.
  const currentByProfile = new Map();
  let statusItems = [];

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((closed) => {
      for (const [name, terminal] of currentByProfile) {
        if (terminal === closed) currentByProfile.delete(name);
      }
    })
  );

  // After a window reload VS Code restores our terminal tabs but this map
  // starts empty, so fall back to matching by the name we gave the terminal.
  function findExisting(profile) {
    const tracked = currentByProfile.get(profile.name);
    if (tracked) return tracked;
    const restored = vscode.window.terminals.find((t) => t.name === terminalName(profile));
    if (restored) currentByProfile.set(profile.name, restored);
    return restored;
  }

  async function openNewTab(cwd, profile, { preserveFocus = false } = {}) {
    const terminal = vscode.window.createTerminal({
      name: terminalName(profile),
      iconPath: iconUri,
      color: themeColorFor(profile),
      cwd,
      // Editor location opens as a TAB in the current editor group, like any
      // other file, rather than splitting a new terminal panel every time.
      location: vscode.TerminalLocation.Editor,
    });
    terminal.show(preserveFocus);
    const args = [];
    if (profile.configDir) {
      args.push(`CLAUDE_CONFIG_DIR=${shellEscape(expandHome(profile.configDir))}`);
    }
    args.push('claude', 'agents', `--cwd=${shellEscape(cwd)}`);
    if (config().get('dangerouslySkipPermissions', true)) args.push('--dangerously-skip-permissions');
    terminal.sendText(args.join(' '));
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    currentByProfile.set(profile.name, terminal);
    return terminal;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeLauncher.openAgents', async (profileArg) => {
      const profile = await resolveProfile(profileArg);
      if (!profile) return;

      const existing = findExisting(profile);
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
    }),

    vscode.commands.registerCommand('claudeLauncher.manageProfiles', () => manageProfiles())
  );

  async function renameDefaultProfile(from, to) {
    const info = config().inspect('defaultProfile');
    if (!info) return;
    if (info.workspaceValue === from) await config().update('defaultProfile', to, vscode.ConfigurationTarget.Workspace);
    if (info.globalValue === from) await config().update('defaultProfile', to, vscode.ConfigurationTarget.Global);
  }

  async function manageProfiles() {
    const profiles = getProfiles().map((p) => ({ ...p }));
    const pick = await vscode.window.showQuickPick(
      [
        ...profiles.map((p) => ({
          label: p.name,
          description: p.configDir || '~/.claude',
          detail: p.color ? capitalize(p.color) : undefined,
          iconPath: colorIcon(p.color),
          profile: p,
        })),
        { label: 'Add profile', iconPath: new vscode.ThemeIcon('add'), add: true },
      ],
      { placeHolder: 'Choose a profile to edit, or add a new one' }
    );
    if (!pick) return;

    if (pick.add) {
      const name = await askName(profiles);
      if (name === undefined) return;
      const configDir = await askConfigDir();
      if (configDir === undefined) return;
      const color = await pickColor();
      if (!color) return;
      profiles.push({ name: name.trim(), configDir: configDir.trim(), color: color.color });
      await saveProfiles(profiles);
      vscode.window.showInformationMessage(`Added profile "${name.trim()}".`);
      return;
    }

    const profile = pick.profile;
    const action = await vscode.window.showQuickPick(
      [
        { label: 'Change color', iconPath: colorIcon(profile.color), action: 'color' },
        { label: 'Rename', iconPath: new vscode.ThemeIcon('edit'), action: 'rename' },
        { label: 'Change config folder', description: profile.configDir || '~/.claude', iconPath: new vscode.ThemeIcon('folder'), action: 'dir' },
        { label: 'Delete', iconPath: new vscode.ThemeIcon('trash'), action: 'delete' },
      ],
      { placeHolder: profile.name }
    );
    if (!action) return;

    if (action.action === 'color') {
      const color = await pickColor(profile.color);
      if (!color) return;
      profile.color = color.color;
      await saveProfiles(profiles);
      // VS Code can't recolor a terminal that already exists.
      if (findExisting(profile)) {
        vscode.window.showInformationMessage(
          `Updated ${profile.name}'s button. Its open tab keeps the old color until you open a new one.`
        );
      }
    } else if (action.action === 'rename') {
      const name = await askName(profiles, profile.name);
      if (name === undefined || name.trim() === profile.name) return;
      const oldName = profile.name;
      profile.name = name.trim();
      const tracked = findExisting({ name: oldName });
      if (tracked) {
        currentByProfile.delete(oldName);
        currentByProfile.set(profile.name, tracked);
      }
      await saveProfiles(profiles);
      await renameDefaultProfile(oldName, profile.name);
    } else if (action.action === 'dir') {
      const configDir = await askConfigDir(profile.configDir);
      if (configDir === undefined) return;
      profile.configDir = configDir.trim();
      await saveProfiles(profiles);
    } else if (action.action === 'delete') {
      const confirm = await vscode.window.showWarningMessage(
        `Delete profile "${profile.name}"? Its Claude config folder and sessions stay on disk.`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') return;
      await saveProfiles(profiles.filter((p) => p !== profile));
      await renameDefaultProfile(profile.name, undefined);
    }
  }

  // Right alignment + low priority pushes these to the far right edge of the
  // status bar, next to the built-in notification bell — VS Code has no API
  // to dock beside a specific native item, this is the closest equivalent.
  function rebuildStatusBar() {
    for (const item of statusItems) item.dispose();
    statusItems = getVisibleProfiles().map((profile, i) => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1 + i);
      // Status bar text only renders codicons, not our SVG logo; $(sparkle)
      // is the closest built-in stand-in.
      item.text = `$(sparkle) ${profile.name}`;
      item.color = themeColorFor(profile);
      const newTabArgs = encodeURIComponent(JSON.stringify([{ name: profile.name }]));
      const tooltip = new vscode.MarkdownString();
      tooltip.appendMarkdown('**Claude Agents — ');
      tooltip.appendText(profile.name);
      tooltip.appendMarkdown(
        `**\n\nClick to open or focus · [New tab](command:claudeLauncher.newAgentsTab?${newTabArgs}) · ` +
          '[Manage profiles](command:claudeLauncher.manageProfiles)'
      );
      tooltip.isTrusted = { enabledCommands: ['claudeLauncher.newAgentsTab', 'claudeLauncher.manageProfiles'] };
      item.tooltip = tooltip;
      item.command = { command: 'claudeLauncher.openAgents', title: 'Open Claude Agents', arguments: [profile] };
      item.show();
      return item;
    });
  }

  rebuildStatusBar();
  context.subscriptions.push({ dispose: () => statusItems.forEach((i) => i.dispose()) });
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeLauncher.profiles') || e.affectsConfiguration('claudeLauncher.defaultProfile')) {
        rebuildStatusBar();
      }
    })
  );

  // Startup never prompts: it needs exactly one folder and a profile it can
  // pick without asking (the workspace default, or the only one configured).
  if (config().get('openOnStartup', false)) {
    const folders = vscode.workspace.workspaceFolders;
    const profiles = getProfiles();
    const profile = getDefaultProfile(profiles) || (profiles.length === 1 ? profiles[0] : undefined);
    if (folders && folders.length === 1 && profile && !findExisting(profile)) {
      openNewTab(folders[0].uri.fsPath, profile, { preserveFocus: true });
    }
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
