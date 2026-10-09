const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mailboxes = require('./mailboxes.js');
const bridge = require('./bridge/bridge.js');
const claudeSwap = require('./claudeswap.js');

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

// Which account a profile is signed in with, from its own Claude config.
function profileAccount(profile) {
  return bridge.account(profile.configDir ? expandHome(profile.configDir) : undefined);
}

function accountLabel(profile) {
  const a = profileAccount(profile);
  if (!a) return undefined;
  if (a.email) return a.org ? `${a.email} (${a.org})` : a.email;
  return a.kind;
}

function mailboxesEnabled() {
  return config().get('mailboxes', false) === true;
}

function currentProject() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : undefined;
}

function pluralize(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
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

  // Tracks each profile's agents tab (by profile name) so a plain click
  // focuses it again. VS Code gives
  // extensions no way to tell a click from a modifier-click on a custom
  // command, so "new tab" is a separate command.
  const tabs = { agents: new Map() };
  let statusItems = [];

  // claude-swap, when installed: every account's plan usage, read-only.
  let swapAccounts;
  let swapReadAt = 0;
  let swapReading = false;
  async function refreshSwap({ force = false } = {}) {
    if (swapReading || config().get('claudeSwapUsage', true) !== true) return;
    if (!force && Date.now() - swapReadAt < 60000) return;
    swapReading = true;
    try {
      const accounts = await claudeSwap.readAccounts();
      swapReadAt = Date.now();
      if (accounts || swapAccounts) {
        swapAccounts = accounts;
        rebuildStatusBar();
      }
    } finally {
      swapReading = false;
    }
  }

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
  function findExisting(profile) {
    const map = tabs.agents;
    const tracked = map.get(profile.name);
    if (tracked) return tracked;
    const restored = vscode.window.terminals.find((t) => t.name === terminalName(profile));
    if (restored) map.set(profile.name, restored);
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
    tabs.agents.set(profile.name, terminal);
    return terminal;
  }

  async function openOrFocus(profileArg) {
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
  }

  async function newAgentsTab(profileArg) {
    const profile = await resolveProfile(profileArg);
    if (!profile) return;
    const cwd = await resolveCwd();
    if (!cwd) return;
    await openNewTab(cwd, profile);
  }

  // ---------- mailboxes ----------

  // Installs into (or removes from) every profile's Claude config to match
  // the setting. Cheap when nothing changed: a stamp file records what's done.
  let syncing = Promise.resolve();
  function syncMailboxes({ report = false, force = false } = {}) {
    syncing = syncing.then(async () => {
      const enabled = mailboxesEnabled();
      if (!enabled && !mailboxes.isInstalled()) return;
      const result = await mailboxes.sync({ enabled, profiles: getProfiles(), extensionPath, force });
      if (result.skipped) return;
      for (const error of result.errors) vscode.window.showErrorMessage(`Claude Agents mailboxes: ${error}`);
      if (report && enabled && !result.errors.length) {
        const where = getProfiles()
          .map((p) => `${p.name} (${p.configDir || '~/.claude'})`)
          .join(', ');
        const hasBox = currentProject() && bridge.mailboxFor(currentProject());
        const choice = await vscode.window.showInformationMessage(
          `Mailboxes are set up for ${where}. New Claude sessions have them; restart sessions that were already running.` +
            (hasBox ? '' : ' Next, give this project a mailbox.'),
          ...(hasBox || !currentProject() ? [] : ['Create Mailbox', 'Select Mailbox'])
        );
        if (choice === 'Create Mailbox') await createMailboxCmd();
        if (choice === 'Select Mailbox') await selectMailboxCmd();
      } else if (report && !enabled && result.removed.length) {
        vscode.window.showInformationMessage(
          `Mailboxes removed from ${result.removed.join(', ')}. Mailbox history stays in ${bridge.ROOT}.`
        );
      }
      rebuildStatusBar();
    });
    return syncing;
  }

  async function setUpMailboxes() {
    const profiles = getProfiles();
    const list = profiles.map((p) => `• ${p.name}: ${p.configDir || '~/.claude'}`).join('\n');
    const choice = await vscode.window.showInformationMessage(
      'Set up mailboxes so your Claude sessions can message each other, across profiles?',
      {
        modal: true,
        detail:
          `This adds to each profile's Claude config:\n${list}\n\n` +
          '• the agent-mailbox mod, as one folder: skills/agent-mailbox\n\n' +
          'Every Claude session of these profiles then gets a name, mailbox tools and a /mailbox command, wakes up when a message arrives, ' +
          'and shows a band above the prompt with its mailbox, account, context use and plan limits. ' +
          'Your settings, hooks and status line are not touched.\n\n' +
          'Nothing else in your config changes, and "Claude Agents: Remove Mailboxes" undoes all of it.',
      },
      'Set Up'
    );
    if (choice !== 'Set Up') return false;
    if (mailboxesEnabled()) await syncMailboxes({ report: true, force: true });
    else await config().update('mailboxes', true, vscode.ConfigurationTarget.Global);
    return true;
  }

  async function removeMailboxes() {
    const choice = await vscode.window.showWarningMessage(
      'Remove mailboxes from all your Claude profiles?',
      { modal: true, detail: 'Deletes the skills/agent-mailbox folder from each profile. Mailboxes and their history stay on disk.' },
      'Remove'
    );
    if (choice !== 'Remove') return;
    if (!mailboxesEnabled()) await syncMailboxes({ report: true });
    else await config().update('mailboxes', false, vscode.ConfigurationTarget.Global);
  }

  async function ensureSetUp(why) {
    if (mailboxesEnabled()) return true;
    const choice = await vscode.window.showInformationMessage(`${why} needs mailboxes, which aren't set up yet.`, 'Set Up Mailboxes');
    return choice === 'Set Up Mailboxes' ? setUpMailboxes() : false;
  }

  function describeBox(box) {
    const n = bridge.livePeers(box.id).length;
    return `${pluralize(n, 'active session')} · ${box.projects.map((p) => path.basename(p)).join(', ') || 'no projects'}`;
  }

  async function createMailboxCmd() {
    const cwd = currentProject() || (await resolveCwd());
    if (!cwd) return;
    const name = await vscode.window.showInputBox({
      title: 'Create Mailbox',
      prompt: `Mailbox for ${cwd}. Sessions in this folder (any profile) will share it.`,
      value: path.basename(cwd),
      validateInput: (v) => {
        if (!v.trim()) return 'Name cannot be empty';
        return bridge.findMailbox(v) ? 'A mailbox with this name already exists. Use "Select Mailbox" to join it.' : undefined;
      },
    });
    if (name === undefined) return;
    try {
      const box = bridge.createMailbox(name, cwd);
      rebuildStatusBar();
      vscode.window.showInformationMessage(`Created mailbox "${box.name}" for ${path.basename(cwd)}.`);
    } catch (e) {
      vscode.window.showErrorMessage(e.message);
    }
    await ensureSetUp('Messaging');
  }

  async function selectMailboxCmd() {
    const cwd = currentProject() || (await resolveCwd());
    if (!cwd) return;
    const current = bridge.mailboxFor(cwd);
    const items = [
      ...bridge.listMailboxes().map((b) => ({
        label: b.name,
        description: `${current && current.id === b.id ? 'current · ' : ''}${describeBox(b)}`,
        iconPath: new vscode.ThemeIcon('inbox'),
        box: b,
      })),
      { label: 'Create a new mailbox…', iconPath: new vscode.ThemeIcon('add'), create: true },
      ...(current ? [{ label: `Leave "${current.name}"`, iconPath: new vscode.ThemeIcon('close'), leave: true }] : []),
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: `Which mailbox should ${path.basename(cwd)} use?` });
    if (!pick) return;
    if (pick.create) return createMailboxCmd();
    if (pick.leave) bridge.leaveMailbox(cwd);
    else bridge.selectMailbox(pick.box.id, cwd);
    rebuildStatusBar();
    if (pick.box) await ensureSetUp('Messaging');
  }

  async function listMailboxesCmd() {
    const boxes = bridge.listMailboxes();
    if (!boxes.length) {
      const choice = await vscode.window.showInformationMessage('There are no mailboxes yet.', 'Create Mailbox');
      if (choice) await createMailboxCmd();
      return;
    }
    const current = currentProject() && bridge.mailboxFor(currentProject());
    const pick = await vscode.window.showQuickPick(
      boxes.map((b) => {
        const peers = bridge.livePeers(b.id);
        return {
          label: b.name,
          description: `${current && current.id === b.id ? 'this project · ' : ''}${pluralize(peers.length, 'active session')}`,
          detail: [b.projects.join(' · ') || 'no projects', peers.map((p) => `${p.name} (${p.profile})`).join(', ')].filter(Boolean).join('  —  '),
          iconPath: new vscode.ThemeIcon('inbox'),
          box: b,
        };
      }),
      { placeHolder: 'Mailboxes', matchOnDetail: true }
    );
    if (!pick) return;
    const action = await vscode.window.showQuickPick(
      [
        ...(currentProject() && !(current && current.id === pick.box.id) ? [{ label: 'Use for this project', id: 'use', iconPath: new vscode.ThemeIcon('check') }] : []),
        { label: 'Reveal folder', id: 'reveal', iconPath: new vscode.ThemeIcon('folder-opened') },
        { label: 'Delete mailbox', id: 'delete', iconPath: new vscode.ThemeIcon('trash') },
      ],
      { placeHolder: pick.box.name }
    );
    if (!action) return;
    if (action.id === 'use') {
      bridge.selectMailbox(pick.box.id, currentProject());
      await ensureSetUp('Messaging');
    } else if (action.id === 'reveal') {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.join(bridge.ROOT, 'mailboxes', pick.box.id, 'mailbox.json')));
    } else if (action.id === 'delete') {
      const ok = await vscode.window.showWarningMessage(
        `Delete mailbox "${pick.box.name}" and its unread messages?`,
        { modal: true, detail: `Projects in it: ${pick.box.projects.join(', ') || 'none'}. Sessions in them stop sharing messages.` },
        'Delete'
      );
      if (ok === 'Delete') bridge.deleteMailbox(pick.box.id);
    }
    rebuildStatusBar();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeLauncher.openAgents', (profileArg) => openOrFocus(profileArg)),

    vscode.commands.registerCommand('claudeLauncher.setUpMailboxes', () => setUpMailboxes()),

    vscode.commands.registerCommand('claudeLauncher.removeMailboxes', () => removeMailboxes()),

    vscode.commands.registerCommand('claudeLauncher.createMailbox', () => createMailboxCmd()),

    vscode.commands.registerCommand('claudeLauncher.selectMailbox', () => selectMailboxCmd()),

    vscode.commands.registerCommand('claudeLauncher.listMailboxes', () => listMailboxesCmd()),

    vscode.commands.registerCommand('claudeLauncher.newAgentsTab', (profileArg) => newAgentsTab(profileArg)),

    vscode.commands.registerCommand('claudeLauncher.openAgentsForProfile', async () => {
      const profile = await pickAnyProfile('Open agents for which profile?');
      if (profile) await openOrFocus(profile);
    }),

    vscode.commands.registerCommand('claudeLauncher.newAgentsTabForProfile', async () => {
      const profile = await pickAnyProfile('New agents tab for which profile?');
      if (profile) await newAgentsTab(profile);
    }),

    vscode.commands.registerCommand('claudeLauncher.manageProfiles', () => manageProfiles()),

    vscode.commands.registerCommand('claudeLauncher.showAccountUsage', () => showAccountUsage()),

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
      const tracked = findExisting({ name: oldName });
      if (tracked) {
        tabs.agents.delete(oldName);
        tabs.agents.set(profile.name, tracked);
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

  async function showAccountUsage() {
    if (!claudeSwap.findCswap()) {
      const choice = await vscode.window.showInformationMessage(
        'Account usage across all your Claude accounts comes from claude-swap, which isn\'t installed. Claude Agents only reads it; it never switches accounts.',
        'About claude-swap'
      );
      if (choice) vscode.env.openExternal(vscode.Uri.parse('https://github.com/realiti4/claude-swap'));
      return;
    }
    await refreshSwap({ force: true });
    if (!swapAccounts || !swapAccounts.length) {
      vscode.window.showInformationMessage('claude-swap has no accounts yet, or its usage could not be read. Run "cswap list" in a terminal to check.');
      return;
    }
    const byEmail = new Map();
    for (const p of getProfiles()) {
      const match = claudeSwap.matchAccount(swapAccounts, profileAccount(p));
      if (match) byEmail.set(match.number, p.name);
    }
    await vscode.window.showQuickPick(
      swapAccounts.map((a) => ({
        label: `${a.alias || a.email || `Account ${a.number}`}`,
        description: [byEmail.has(a.number) ? `profile ${byEmail.get(a.number)}` : '', a.active ? 'default login' : '', a.disabled ? 'held out of rotation' : '']
          .filter(Boolean)
          .join(' · '),
        detail: a.status === 'ok' || a.isStale ? claudeSwap.describe(a) : `usage ${a.status.replace(/_/g, ' ')}`,
        iconPath: new vscode.ThemeIcon(claudeSwap.peak(a) >= 90 ? 'warning' : 'account'),
      })),
      { placeHolder: 'Usage by account, from claude-swap (read-only)', matchOnDetail: true }
    );
  }

  // Right alignment + low priority pushes these to the far right edge of the
  // status bar, next to the built-in notification bell — VS Code has no API
  // to dock beside a specific native item, this is the closest equivalent.
  function rebuildStatusBar() {
    for (const item of statusItems) item.dispose();
    const enabled = mailboxesEnabled();
    const project = currentProject();
    const box = enabled && project ? bridge.mailboxFor(project) : undefined;
    const multiProfile = getProfiles().length > 1;
    const visible = getVisibleProfiles();
    const othersHidden = getProfiles().length > visible.length;
    statusItems = visible.map((profile, i) => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1 + i);
      // Status bar text only renders codicons, not our SVG logo; $(sparkle)
      // is the closest built-in stand-in.
      item.text = `$(sparkle) ${profile.name}${box ? ' $(comment-discussion)' : ''}`;
      item.color = themeColorFor(profile);
      const swapped = swapAccounts && claudeSwap.matchAccount(swapAccounts, profileAccount(profile));
      if (swapped && claudeSwap.peak(swapped) >= 90) {
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      }
      const profileArgs = encodeURIComponent(JSON.stringify([{ name: profile.name }]));
      const tooltip = new vscode.MarkdownString();
      tooltip.supportThemeIcons = true;
      tooltip.appendMarkdown('**Claude Agents — ');
      tooltip.appendText(profile.name);
      tooltip.appendMarkdown('**');
      const signedIn = accountLabel(profile);
      if (signedIn) {
        tooltip.appendMarkdown('  \n$(account) ');
        tooltip.appendText(signedIn);
      }
      if (swapped) {
        tooltip.appendMarkdown('  \n$(pulse) ');
        tooltip.appendText(`${claudeSwap.describe(swapped)}${swapped.disabled ? ' · held out of rotation' : ''}`);
        tooltip.appendMarkdown(' · [All accounts](command:claudeLauncher.showAccountUsage)');
      }
      tooltip.appendMarkdown(
        `\n\nClick to open or focus · [New tab](command:claudeLauncher.newAgentsTab?${profileArgs}) · ` +
          (othersHidden ? '[Other profile…](command:claudeLauncher.openAgentsForProfile) · ' : '') +
          '[Project profile](command:claudeLauncher.setProjectProfile) · ' +
          '[Manage profiles](command:claudeLauncher.manageProfiles)'
      );
      if (box) {
        tooltip.appendMarkdown('\n\nMailbox **');
        tooltip.appendText(box.name);
        tooltip.appendMarkdown(
          `** · ${pluralize(bridge.livePeers(box.id).length, 'active session')} · ` +
            '[Switch](command:claudeLauncher.selectMailbox) · [All mailboxes](command:claudeLauncher.listMailboxes)'
        );
      } else if (enabled && project) {
        tooltip.appendMarkdown(
          '\n\nNo mailbox for this project · [Create one](command:claudeLauncher.createMailbox) · [Join one](command:claudeLauncher.selectMailbox)'
        );
      } else if (!enabled && multiProfile) {
        tooltip.appendMarkdown('\n\n[Set up mailboxes](command:claudeLauncher.setUpMailboxes) so your agents can message each other');
      }
      tooltip.isTrusted = {
        enabledCommands: [
          'claudeLauncher.newAgentsTab',
          'claudeLauncher.openAgentsForProfile',
          'claudeLauncher.setProjectProfile',
          'claudeLauncher.manageProfiles',
          'claudeLauncher.selectMailbox',
          'claudeLauncher.listMailboxes',
          'claudeLauncher.createMailbox',
          'claudeLauncher.setUpMailboxes',
          'claudeLauncher.showAccountUsage',
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
      if (e.affectsConfiguration('claudeLauncher.profiles') || e.affectsConfiguration('claudeLauncher.defaultProfile')) {
        rebuildStatusBar();
      }
      // Renamed, added, or removed profiles need their Claude config updated too.
      if (e.affectsConfiguration('claudeLauncher.profiles')) syncMailboxes();
      if (e.affectsConfiguration('claudeLauncher.mailboxes')) syncMailboxes({ report: true });
    })
  );

  // Mailbox changes can come from Claude sessions or other windows.
  if (mailboxesEnabled()) fs.mkdirSync(path.join(bridge.ROOT, 'mailboxes'), { recursive: true, mode: 0o700 });
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(path.join(bridge.ROOT, 'mailboxes')), '*/mailbox.json')
  );
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(() => rebuildStatusBar()),
    watcher.onDidCreate(() => rebuildStatusBar()),
    watcher.onDidDelete(() => rebuildStatusBar()),
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) return;
      rebuildStatusBar();
      refreshSwap();
    })
  );

  const swapTimer = setInterval(() => refreshSwap({ force: true }), 5 * 60000);
  if (swapTimer.unref) swapTimer.unref();
  context.subscriptions.push({ dispose: () => clearInterval(swapTimer) });
  refreshSwap({ force: true });

  // 0.8.0 (never released) kept a launch-time bridge here; mailboxes replace it.
  fs.rm(path.join(os.homedir(), '.claude-agents-bridge'), { recursive: true, force: true }, () => {});
  syncMailboxes();

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
