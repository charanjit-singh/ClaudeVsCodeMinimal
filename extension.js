const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PROFILES = [{ name: 'Claude' }];

const BRIDGE_SERVER = 'claude_agents_bridge';

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

function terminalName(profile, kind = 'agents') {
  return `${kind === 'chat' ? 'Claude Chat' : 'Claude Agents'} — ${profile.name}`;
}

function messagingEnabled() {
  return config().get('crossProfileMessaging', false) === true;
}

function bridgeRoot() {
  return process.env.CLAUDE_AGENTS_BRIDGE_ROOT || path.join(os.homedir(), '.claude-agents-bridge');
}

function writePrivate(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Agents dispatched from agent view can outlive this extension version, so
// they run a stable copy of the bridge, not the versioned install folder.
function installBridge(extensionPath) {
  const code = fs.readFileSync(path.join(extensionPath, 'bridge', 'bridge.js'));
  const dest = path.join(bridgeRoot(), 'bin', 'bridge.js');
  let current;
  try {
    current = fs.readFileSync(dest);
  } catch {}
  if (!current || !current.equals(code)) writePrivate(dest, code);
  return dest;
}

// The bridge runs on VS Code's own Node (ELECTRON_RUN_AS_NODE), so users
// don't need Node installed. Hooks deliver mail to agent-view sessions; in
// chat mode the same server also pushes live as a channel.
function bridgeLaunchFiles(extensionPath, profile, project, mode) {
  const script = installBridge(extensionPath);
  const root = bridgeRoot();
  const node = process.execPath;
  const env = {
    ELECTRON_RUN_AS_NODE: '1',
    CLAUDE_AGENTS_BRIDGE_ROOT: root,
    CLAUDE_AGENTS_BRIDGE_PROFILE: profile.name,
    CLAUDE_AGENTS_BRIDGE_PROJECT: project,
    CLAUDE_AGENTS_BRIDGE_MODE: mode,
  };
  const hookCommand = [
    'ELECTRON_RUN_AS_NODE=1',
    `CLAUDE_AGENTS_BRIDGE_ROOT=${shellEscape(root)}`,
    shellEscape(node),
    shellEscape(script),
    'hook',
    '--profile',
    shellEscape(profile.name),
    '--project',
    shellEscape(project),
  ].join(' ');
  const hooks = [{ type: 'command', command: hookCommand, timeout: 10 }];

  const key = crypto.createHash('sha1').update(path.resolve(project)).digest('hex').slice(0, 12);
  const slug = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';
  const base = path.join(root, 'launch', `${key}-${slug}-${mode}`);
  const mcpConfig = `${base}-mcp.json`;
  writePrivate(mcpConfig, JSON.stringify({ mcpServers: { [BRIDGE_SERVER]: { command: node, args: [script, 'serve'], env } } }, null, 2));
  // Live-chat sessions get messages pushed as a channel; only agent-view
  // sessions need the hooks.
  if (mode !== 'mailbox') return { mcpConfig };
  const settings = `${base}-settings.json`;
  writePrivate(
    settings,
    JSON.stringify({ hooks: { PostToolUse: [{ matcher: '*', hooks }], UserPromptSubmit: [{ hooks }], Stop: [{ hooks }] } }, null, 2)
  );
  return { mcpConfig, settings };
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

// Unlike resolveProfile, this always asks, even in a project pinned to a
// default profile, so the other profiles stay one command away.
async function pickAnyProfile(placeHolder) {
  const profiles = getProfiles();
  if (profiles.length === 1) return profiles[0];
  const pinned = getDefaultProfile(profiles);
  const pick = await vscode.window.showQuickPick(
    profiles.map((p) => ({
      label: p.name,
      description: [p === pinned ? 'project default' : '', p.configDir || '~/.claude'].filter(Boolean).join(' · '),
      iconPath: colorIcon(p.color),
      profile: p,
    })),
    { placeHolder }
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

  const extensionPath = context.extensionPath || (context.extensionUri && context.extensionUri.fsPath);

  // Tracks each profile's tabs (by profile name) so a plain click focuses
  // them again: agent view tabs and live-chat tabs separately. VS Code gives
  // extensions no way to tell a click from a modifier-click on a custom
  // command, so "new tab" is a separate command.
  const tabs = { agents: new Map(), chat: new Map() };
  const cwdOf = new WeakMap();
  let statusItems = [];

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((closed) => {
      for (const map of Object.values(tabs)) {
        for (const [name, terminal] of map) {
          if (terminal === closed) map.delete(name);
        }
      }
    })
  );

  // After a window reload VS Code restores our terminal tabs but these maps
  // start empty, so fall back to matching by the name we gave the terminal.
  function findExisting(profile, kind = 'agents') {
    const map = tabs[kind];
    const tracked = map.get(profile.name);
    if (tracked) return tracked;
    const restored = vscode.window.terminals.find((t) => t.name === terminalName(profile, kind));
    if (restored) map.set(profile.name, restored);
    return restored;
  }

  async function openNewTab(cwd, profile, { preserveFocus = false, kind = 'agents' } = {}) {
    const chat = kind === 'chat';
    let bridge;
    if (chat || messagingEnabled()) {
      try {
        bridge = bridgeLaunchFiles(extensionPath, profile, cwd, chat ? 'channel' : 'mailbox');
      } catch (e) {
        vscode.window.showErrorMessage(`Claude Agents couldn't set up cross-profile messaging: ${e.message}`);
        if (chat) return undefined;
      }
    }

    const terminal = vscode.window.createTerminal({
      name: terminalName(profile, kind),
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
    if (chat) {
      // Custom channels aren't on the research-preview allowlist, so they
      // only load through the development flag (and `claude agents` can't
      // take it at all, hence a plain session here).
      args.push('claude', '--dangerously-load-development-channels', `server:${BRIDGE_SERVER}`);
    } else {
      args.push('claude', 'agents', `--cwd=${shellEscape(cwd)}`);
    }
    if (config().get('dangerouslySkipPermissions', true)) args.push('--dangerously-skip-permissions');
    if (bridge) args.push('--mcp-config', shellEscape(bridge.mcpConfig));
    if (bridge && bridge.settings) args.push('--settings', shellEscape(bridge.settings));
    terminal.sendText(args.join(' '));
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    tabs[kind].set(profile.name, terminal);
    cwdOf.set(terminal, cwd);
    return terminal;
  }

  async function openOrFocus(profileArg, kind) {
    const profile = await resolveProfile(profileArg);
    if (!profile) return;
    const existing = findExisting(profile, kind);
    if (existing) {
      existing.show();
      return;
    }
    const cwd = await resolveCwd();
    if (!cwd) return;
    await openNewTab(cwd, profile, { kind });
  }

  async function newAgentsTab(profileArg) {
    const profile = await resolveProfile(profileArg);
    if (!profile) return;
    const cwd = await resolveCwd();
    if (!cwd) return;
    await openNewTab(cwd, profile);
  }

  // Agents already running keep their launch flags, so switching messaging
  // on or off only reaches agents started from a fresh agents tab.
  async function restartAgentsTabs() {
    const open = [...tabs.agents.entries()];
    for (const [name, terminal] of open) {
      const profile = getProfiles().find((p) => p.name === name);
      const cwd = cwdOf.get(terminal) || (await resolveCwd());
      terminal.dispose();
      tabs.agents.delete(name);
      if (profile && cwd) await openNewTab(cwd, profile);
    }
  }

  async function toggleMessaging() {
    const folderOpen = !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length);
    const next = !messagingEnabled();
    await config().update(
      'crossProfileMessaging',
      next,
      folderOpen ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    );
    const where = folderOpen ? 'this project' : 'all projects';
    const summary = `Cross-profile messaging is ${next ? 'on' : 'off'} for ${where}.`;
    if (!tabs.agents.size) {
      vscode.window.showInformationMessage(summary);
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      `${summary} Restart your agents tab so new agents pick it up. Running agents aren't affected either way.`,
      'Restart Agents Tab'
    );
    if (choice) await restartAgentsTabs();
  }

  async function openLiveChat(profileArg) {
    if (!messagingEnabled()) {
      const choice = await vscode.window.showInformationMessage(
        'Live chat uses cross-profile messaging, which is off for this project. Turn it on?',
        'Turn On'
      );
      if (choice !== 'Turn On') return;
      await toggleMessaging();
    }
    await openOrFocus(profileArg, 'chat');
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeLauncher.openAgents', (profileArg) => openOrFocus(profileArg, 'agents')),

    vscode.commands.registerCommand('claudeLauncher.openLiveChat', (profileArg) => openLiveChat(profileArg)),

    vscode.commands.registerCommand('claudeLauncher.toggleCrossProfileMessaging', () => toggleMessaging()),

    vscode.commands.registerCommand('claudeLauncher.newAgentsTab', (profileArg) => newAgentsTab(profileArg)),

    vscode.commands.registerCommand('claudeLauncher.openAgentsForProfile', async () => {
      const profile = await pickAnyProfile('Open agents for which profile?');
      if (profile) await openOrFocus(profile, 'agents');
    }),

    vscode.commands.registerCommand('claudeLauncher.newAgentsTabForProfile', async () => {
      const profile = await pickAnyProfile('New agents tab for which profile?');
      if (profile) await newAgentsTab(profile);
    }),

    vscode.commands.registerCommand('claudeLauncher.openLiveChatForProfile', async () => {
      const profile = await pickAnyProfile('Open live chat for which profile?');
      if (profile) await openLiveChat(profile);
    }),

    vscode.commands.registerCommand('claudeLauncher.manageProfiles', () => manageProfiles()),

    vscode.commands.registerCommand('claudeLauncher.setProjectProfile', () => setProjectProfile())
  );

  async function setProjectProfile() {
    if (!vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders.length) {
      vscode.window.showInformationMessage("Open a folder first. A project's profile is saved in its workspace settings.");
      return;
    }
    const info = config().inspect('defaultProfile') || {};
    const current = info.workspaceValue || undefined;
    const items = [
      { label: 'All profiles', description: 'show every button', iconPath: new vscode.ThemeIcon('list-unordered'), name: undefined },
      ...getProfiles().map((p) => ({
        label: p.name,
        description: p.configDir || '~/.claude',
        iconPath: colorIcon(p.color),
        name: p.name,
      })),
    ];
    for (const item of items) {
      if (item.name === current) item.description = `${item.description} · current`;
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Which profile should this project use?' });
    if (!pick) return;
    // "All profiles" has to override a user-level default with an empty
    // value; with no user-level default, remove the key instead.
    const value = pick.name || (info.globalValue ? '' : undefined);
    await config().update('defaultProfile', value, vscode.ConfigurationTarget.Workspace);
  }

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
        ...(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length
          ? [{ label: "Set this project's profile", iconPath: new vscode.ThemeIcon('pinned'), project: true }]
          : []),
      ],
      { placeHolder: 'Choose a profile to edit, or add a new one' }
    );
    if (!pick) return;

    if (pick.project) {
      await setProjectProfile();
      return;
    }

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
      for (const kind of Object.keys(tabs)) {
        const tracked = findExisting({ name: oldName }, kind);
        if (tracked) {
          tabs[kind].delete(oldName);
          tabs[kind].set(profile.name, tracked);
        }
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
    const messaging = messagingEnabled();
    const multiProfile = getProfiles().length > 1;
    const visible = getVisibleProfiles();
    const othersHidden = getProfiles().length > visible.length;
    statusItems = visible.map((profile, i) => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1 + i);
      // Status bar text only renders codicons, not our SVG logo; $(sparkle)
      // is the closest built-in stand-in.
      item.text = `$(sparkle) ${profile.name}${messaging ? ' $(comment-discussion)' : ''}`;
      item.color = themeColorFor(profile);
      const profileArgs = encodeURIComponent(JSON.stringify([{ name: profile.name }]));
      const tooltip = new vscode.MarkdownString();
      tooltip.appendMarkdown('**Claude Agents — ');
      tooltip.appendText(profile.name);
      tooltip.appendMarkdown(
        `**\n\nClick to open or focus · [New tab](command:claudeLauncher.newAgentsTab?${profileArgs}) · ` +
          (othersHidden ? '[Other profile…](command:claudeLauncher.openAgentsForProfile) · ' : '') +
          '[Project profile](command:claudeLauncher.setProjectProfile) · ' +
          '[Manage profiles](command:claudeLauncher.manageProfiles)'
      );
      if (messaging) {
        tooltip.appendMarkdown(
          `\n\nCross-profile messaging **on** · [Live chat](command:claudeLauncher.openLiveChat?${profileArgs}) · ` +
            '[Turn off](command:claudeLauncher.toggleCrossProfileMessaging)'
        );
      } else if (multiProfile) {
        tooltip.appendMarkdown('\n\n[Turn on cross-profile messaging](command:claudeLauncher.toggleCrossProfileMessaging)');
      }
      tooltip.isTrusted = {
        enabledCommands: [
          'claudeLauncher.newAgentsTab',
          'claudeLauncher.openAgentsForProfile',
          'claudeLauncher.setProjectProfile',
          'claudeLauncher.manageProfiles',
          'claudeLauncher.openLiveChat',
          'claudeLauncher.toggleCrossProfileMessaging',
        ],
      };
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
      if (
        e.affectsConfiguration('claudeLauncher.profiles') ||
        e.affectsConfiguration('claudeLauncher.defaultProfile') ||
        e.affectsConfiguration('claudeLauncher.crossProfileMessaging')
      ) {
        rebuildStatusBar();
      }
    })
  );

  // Startup never prompts: it needs exactly one folder and a profile it can
  // pick without asking (the workspace default, or the only one configured).
  // Never auto-launch into a folder the user hasn't trusted yet.
  if (vscode.workspace.isTrusted && config().get('openOnStartup', false)) {
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
