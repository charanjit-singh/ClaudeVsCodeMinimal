const vscode = require('vscode');
const fs = require('fs');
const { StateStore } = require('./src/state');
const { TerminalManager } = require('./src/terminals');
const { ClaudeTreeProvider, ClaudeDragAndDropController } = require('./src/tree');
const { setupWatchers } = require('./src/watch');
const { deleteSession } = require('./src/store');
const { PALETTE, label: colorLabel } = require('./src/colors');
const { saveAvatar, deleteAvatar, avatarPath } = require('./src/avatars');
const { ColorDecorationProvider } = require('./src/decorations');

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function defaultAvatarUri(extensionUri) {
  return vscode.Uri.joinPath(extensionUri, 'media', 'claude-icon-color.svg');
}

// What a freshly (re)opened terminal for this agent should look like — name,
// color, and picture all come from our own state, falling back to the Claude
// logo when no avatar is set.
function agentMeta(stateStore, session, extensionUri) {
  const avatarFile = stateStore.agentAvatar(session.sessionId);
  return {
    name: stateStore.agentName(session.sessionId, session.title),
    colorId: stateStore.agentColor(session.sessionId),
    iconUri: avatarFile ? vscode.Uri.file(avatarPath(avatarFile)) : defaultAvatarUri(extensionUri),
  };
}

// A brand new agent has no identity of its own yet (the CLI assigns the
// session id on first message), so a terminal started from a group's "+"
// button borrows that GROUP's look instead, as a visual cue of where it came
// from — until the sidebar picks it up as its own session next refresh.
function groupMeta(stateStore, groupId) {
  if (!groupId) return {};
  const avatarFile = stateStore.groupAvatar(groupId);
  return {
    colorId: stateStore.groupColor(groupId),
    iconUri: avatarFile ? vscode.Uri.file(avatarPath(avatarFile)) : undefined,
  };
}

async function resolveNewAgentTarget(element) {
  if (element && element.kind === 'group' && !element.groupId.startsWith('custom:')) {
    return { cwd: element.groupId, groupId: element.groupId };
  }

  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length === 1) {
    return { cwd: folders[0].uri.fsPath };
  }
  if (folders && folders.length > 1) {
    const pick = await vscode.window.showQuickPick(
      folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
      { placeHolder: 'Start Claude in which folder?' }
    );
    return pick ? { cwd: pick.folder.uri.fsPath } : undefined;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Start Claude Here',
  });
  return picked && picked[0] ? { cwd: picked[0].fsPath } : undefined;
}

async function deleteAgent(element, stateStore, terminals) {
  if (!element || element.kind !== 'agent') return false;
  const session = element.session;
  const label = stateStore.agentName(session.sessionId, session.title);

  if (session.live) {
    const choice = await vscode.window.showWarningMessage(
      `"${label}" is currently running. Stop it and permanently delete its history?`,
      { modal: true },
      'Stop and Delete'
    );
    if (choice !== 'Stop and Delete') return false;

    const stopped = await terminals.stopAgent(session);
    if (!stopped) {
      vscode.window.showWarningMessage(
        `Couldn't find a terminal for "${label}" in this window to stop it. Close it manually, then delete again.`
      );
      return false;
    }
  } else {
    const choice = await vscode.window.showWarningMessage(
      `Delete "${label}"? This permanently removes its history from disk and cannot be undone.`,
      { modal: true },
      'Delete'
    );
    if (choice !== 'Delete') return false;
  }

  const avatarFile = stateStore.agentAvatar(session.sessionId);
  deleteSession(session);
  stateStore.removeAgent(session.sessionId);
  deleteAvatar(avatarFile);
  return true;
}

async function pickColor() {
  const items = [
    { label: 'Default', description: 'No custom color', colorId: undefined, iconPath: new vscode.ThemeIcon('circle-slash') },
    ...PALETTE.map((c) => ({
      label: colorLabel(c.id),
      colorId: c.id,
      iconPath: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(c.themeColorId)),
    })),
  ];
  return vscode.window.showQuickPick(items, { placeHolder: 'Choose a color' });
}

async function setColorElement(element, stateStore, decorations) {
  if (!element || (element.kind !== 'agent' && element.kind !== 'group')) return false;
  const picked = await pickColor();
  if (picked === undefined) return false;

  if (element.kind === 'agent') {
    stateStore.setAgentColor(element.session.sessionId, picked.colorId);
  } else {
    stateStore.setGroupColor(element.groupId, picked.colorId);
  }
  decorations.refresh();
  return true;
}

async function setAvatarElement(element, stateStore) {
  if (!element || (element.kind !== 'agent' && element.kind !== 'group')) return false;

  const id = element.kind === 'agent' ? element.session.sessionId : element.groupId;
  const getAvatar = element.kind === 'agent' ? (i) => stateStore.agentAvatar(i) : (i) => stateStore.groupAvatar(i);
  const setAvatar =
    element.kind === 'agent' ? (i, f) => stateStore.setAgentAvatar(i, f) : (i, f) => stateStore.setGroupAvatar(i, f);

  const existing = getAvatar(id);
  const actionItems = [{ label: '$(file-media) Choose Image...', action: 'choose' }];
  if (existing) actionItems.push({ label: '$(trash) Remove Picture', action: 'remove' });
  const action = await vscode.window.showQuickPick(actionItems, { placeHolder: 'Profile picture' });
  if (!action) return false;

  if (action.action === 'remove') {
    deleteAvatar(existing);
    setAvatar(id, undefined);
    return true;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: false,
    filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
    openLabel: 'Set as Picture',
  });
  if (!picked || !picked[0]) return false;

  let stat;
  try {
    stat = fs.statSync(picked[0].fsPath);
  } catch {
    return false;
  }
  if (stat.size > MAX_AVATAR_BYTES) {
    vscode.window.showWarningMessage('That image is larger than 5 MB — pick a smaller one.');
    return false;
  }

  const filename = saveAvatar(id, picked[0].fsPath, existing);
  setAvatar(id, filename);
  return true;
}

async function renameElement(element, stateStore) {
  if (!element) return false;

  if (element.kind === 'group') {
    const value = await vscode.window.showInputBox({
      title: 'Rename Group',
      value: element.label,
      prompt: 'New group name',
      validateInput: (v) => (v.trim() ? undefined : 'Name cannot be empty'),
    });
    if (value === undefined) return false;
    stateStore.setGroupName(element.groupId, value.trim());
    return true;
  }

  if (element.kind === 'agent') {
    const current = stateStore.agentName(element.session.sessionId, element.session.title);
    const value = await vscode.window.showInputBox({
      title: 'Rename Agent',
      value: current,
      prompt: 'New agent name',
      validateInput: (v) => (v.trim() ? undefined : 'Name cannot be empty'),
    });
    if (value === undefined) return false;
    stateStore.setAgentName(element.session.sessionId, value.trim());
    return true;
  }

  return false;
}

function activate(context) {
  const stateStore = new StateStore();
  const terminals = new TerminalManager(context.extensionUri);
  const tree = new ClaudeTreeProvider(stateStore);
  const dnd = new ClaudeDragAndDropController(tree, stateStore);
  const decorations = new ColorDecorationProvider(stateStore);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorations));

  const treeView = vscode.window.createTreeView('claudeLauncher.agents', {
    treeDataProvider: tree,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: dnd,
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(tree.onDidChangeTreeData(() => {
    treeView.message = tree.scopeMessage();
  }));

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeLauncher.refresh', () => tree.refresh()),

    vscode.commands.registerCommand('claudeLauncher.openAgent', async (element) => {
      if (!element || element.kind !== 'agent') return;
      await terminals.openAgent(element.session, agentMeta(stateStore, element.session, context.extensionUri));
    }),

    vscode.commands.registerCommand('claudeLauncher.stopAgent', async (element) => {
      if (!element || element.kind !== 'agent') return;
      await terminals.stopAgent(element.session);
      setTimeout(() => tree.refresh(), 500);
    }),

    vscode.commands.registerCommand('claudeLauncher.takeOver', async (element) => {
      if (!element || element.kind !== 'agent') return;
      if (!element.session.jobId) {
        vscode.window.showInformationMessage(
          `"${element.session.title}" isn't a background agent — there's no session to take over.`
        );
        return;
      }
      await terminals.takeOver(element.session, agentMeta(stateStore, element.session, context.extensionUri));
    }),

    vscode.commands.registerCommand('claudeLauncher.deleteAgent', async (element) => {
      const changed = await deleteAgent(element, stateStore, terminals);
      if (changed) tree.refresh();
    }),

    vscode.commands.registerCommand('claudeLauncher.newAgent', async (element) => {
      const target = await resolveNewAgentTarget(element);
      if (!target) return;

      // Optional — passed through as `claude --name <name>`, Claude Code's
      // own real session name (used by /resume, SendMessage, ListAgents),
      // not just a label in this sidebar.
      const name = await vscode.window.showInputBox({
        title: 'New Claude Agent',
        prompt: 'Name this agent (optional) — sets the real Claude session name',
        placeHolder: 'e.g. TICKET-123 (leave blank to skip)',
      });
      if (name === undefined) return;

      terminals.newAgent(target.cwd, { ...groupMeta(stateStore, target.groupId), name: name.trim() || undefined });
      setTimeout(() => tree.refresh(), 1500);
    }),

    vscode.commands.registerCommand('claudeLauncher.rename', async (element) => {
      const changed = await renameElement(element, stateStore);
      if (changed) {
        if (element.kind === 'agent') {
          const newName = stateStore.agentName(element.session.sessionId, element.session.title);
          terminals.syncNameIfOpen(element.session.sessionId, newName);
        }
        tree.refresh();
      }
    }),

    vscode.commands.registerCommand('claudeLauncher.setColor', async (element) => {
      const changed = await setColorElement(element, stateStore, decorations);
      if (changed) tree.refresh();
    }),

    vscode.commands.registerCommand('claudeLauncher.setAvatar', async (element) => {
      const changed = await setAvatarElement(element, stateStore);
      if (changed) tree.refresh();
    }),

    vscode.commands.registerCommand('claudeLauncher.scopeShowAll', () => {
      vscode.workspace.getConfiguration('claudeLauncher').update('showAllProjects', true, true);
    }),

    vscode.commands.registerCommand('claudeLauncher.scopeShowCurrent', () => {
      vscode.workspace.getConfiguration('claudeLauncher').update('showAllProjects', false, true);
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeLauncher.showAllProjects')) tree.refresh();
    }),

    vscode.workspace.onDidChangeWorkspaceFolders(() => tree.refresh())
  );

  setupWatchers(context, () => tree.refresh());

  tree.refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
