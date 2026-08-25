const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { listSessions } = require('./store');
const { avatarPath } = require('./avatars');
const { resourceUriFor } = require('./decorations');

// Normalizes away trailing slashes and resolves symlinks (e.g. macOS's
// /tmp -> /private/tmp) so a workspace folder path compares equal to a
// session's recorded cwd even when one side is a symlinked form of the other.
function canonicalPath(p) {
  const normalized = path.normalize(p);
  try {
    return fs.realpathSync.native(normalized);
  } catch {
    return normalized;
  }
}

const DRAG_MIME_TYPE = 'application/vnd.code.tree.claudelauncher.agents';

const STATUS_ICON = {
  working: () => new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue')),
  waiting: () => new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.yellow')),
  done: () => new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed')),
  error: () => new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')),
  idle: () => new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground')),
};

function iconFor(status) {
  return (STATUS_ICON[status] || STATUS_ICON.idle)();
}

// "Running" gates Stop/Take-Over actions and means the PROCESS is alive —
// not to be confused with the animated icon, which reflects working/waiting
// specifically. A live-but-idle background session (e.g. one the daemon kept
// alive after its terminal closed) is still stoppable/take-over-able even
// though its icon isn't spinning.
function contextValueFor(session) {
  return session.live ? 'agent-running' : 'agent-idle';
}

function labelForGroup(groupId, override) {
  if (override) return override;
  if (groupId === 'unknown') return 'Unknown project';
  if (groupId.startsWith('custom:')) return 'Group';
  return path.basename(groupId);
}

class ClaudeTreeProvider {
  constructor(stateStore) {
    this.stateStore = stateStore;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.groups = new Map();
    this.hasWorkspace = false;
  }

  // Explains why "current project only" may look like it's doing nothing:
  // with no folder open in this window, there's nothing to scope to, so
  // every session is shown regardless of the setting.
  scopeMessage() {
    const showAll = vscode.workspace.getConfiguration('claudeLauncher').get('showAllProjects', false);
    if (!showAll && !this.hasWorkspace) {
      return 'No folder open in this window, so "current project only" has nothing to filter to — showing every project. Open a folder to filter, or use the toggle above to show all on purpose.';
    }
    return undefined;
  }

  refresh() {
    this.rebuild();
    this._onDidChangeTreeData.fire();
  }

  rebuild() {
    const sessions = listSessions();
    const groups = new Map();

    const showAll = vscode.workspace.getConfiguration('claudeLauncher').get('showAllProjects', false);
    const workspaceFolders = (vscode.workspace.workspaceFolders || []).map((f) => canonicalPath(f.uri.fsPath));
    this.hasWorkspace = workspaceFolders.length > 0;
    const inScope = (session) => {
      if (showAll || !workspaceFolders.length || !session.cwd) return true;
      const cwd = canonicalPath(session.cwd);
      return workspaceFolders.some((wf) => cwd === wf || cwd.startsWith(wf + path.sep));
    };

    const ensureGroup = (groupId, defaultLabel) => {
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          groupId,
          label: this.stateStore.groupName(groupId, defaultLabel),
          sessions: [],
        });
      }
      return groups.get(groupId);
    };

    for (const groupId of this.stateStore.customGroupIds()) {
      const name = this.stateStore.state.customGroups[groupId].name;
      ensureGroup(groupId, name);
    }

    for (const session of sessions) {
      const override = this.stateStore.agentGroupOverride(session.sessionId);
      // Manually-organized agents (dragged into a group) stay visible even
      // when their project is out of scope — that's the point of moving them.
      if (!override && !inScope(session)) continue;

      const projectPath = session.cwd || 'unknown';
      const groupId = override || projectPath;
      ensureGroup(groupId, labelForGroup(groupId));
      groups.get(groupId).sessions.push(session);
    }

    this.groups = groups;
  }

  getChildren(element) {
    if (!element) {
      this.rebuild();
      return Array.from(this.groups.values())
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((g) => ({ kind: 'group', groupId: g.groupId, label: g.label, sessions: g.sessions }));
    }
    if (element.kind === 'group') {
      return element.sessions
        .slice()
        .sort((a, b) => b.lastActivity - a.lastActivity)
        .map((session) => ({ kind: 'agent', session, groupId: element.groupId }));
    }
    return [];
  }

  getParent(element) {
    if (element.kind === 'agent') {
      const group = this.groups.get(element.groupId);
      return group ? { kind: 'group', groupId: group.groupId, label: group.label, sessions: group.sessions } : undefined;
    }
    return undefined;
  }

  getTreeItem(element) {
    if (element.kind === 'group') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = 'group:' + element.groupId;
      item.contextValue = 'group';
      item.resourceUri = resourceUriFor('group', element.groupId);

      const groupAvatar = this.stateStore.groupAvatar(element.groupId);
      item.iconPath = groupAvatar ? vscode.Uri.file(avatarPath(groupAvatar)) : new vscode.ThemeIcon('folder');
      item.description = String(element.sessions.length);
      return item;
    }

    const session = element.session;
    const label = this.stateStore.agentName(session.sessionId, session.title);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.id = session.sessionId;
    item.contextValue = contextValueFor(session);
    item.resourceUri = resourceUriFor('agent', session.sessionId);

    // A row has exactly one icon slot. An animated status (working/waiting)
    // is more valuable than a static picture, so the avatar only takes over
    // for idle/done/error rows — the status icon always wins while it matters.
    const animated = session.status === 'working' || session.status === 'waiting';
    const avatarFile = this.stateStore.agentAvatar(session.sessionId);
    item.iconPath = avatarFile && !animated ? vscode.Uri.file(avatarPath(avatarFile)) : iconFor(session.status);

    const descriptionParts = [];
    if (session.detail) descriptionParts.push(session.detail);
    if (session.subagentCount) {
      descriptionParts.push(`${session.subagentCount} agent${session.subagentCount === 1 ? '' : 's'}`);
    }
    item.description = descriptionParts.join(' · ');
    item.tooltip = `${label}\n${session.cwd || ''}\nstatus: ${session.status}`;
    item.command = { command: 'claudeLauncher.openAgent', title: 'Open', arguments: [element] };
    return item;
  }
}

class ClaudeDragAndDropController {
  constructor(provider, stateStore) {
    this.provider = provider;
    this.stateStore = stateStore;
    this.dropMimeTypes = [DRAG_MIME_TYPE];
    this.dragMimeTypes = [DRAG_MIME_TYPE];
  }

  handleDrag(source, dataTransfer) {
    const sessionIds = source.filter((el) => el.kind === 'agent').map((el) => el.session.sessionId);
    if (!sessionIds.length) return;
    dataTransfer.set(DRAG_MIME_TYPE, new vscode.DataTransferItem(sessionIds));
  }

  handleDrop(target, dataTransfer) {
    if (!target || target.kind !== 'group') return;
    const transferItem = dataTransfer.get(DRAG_MIME_TYPE);
    if (!transferItem) return;
    const sessionIds = transferItem.value;
    for (const sessionId of sessionIds) {
      this.stateStore.setAgentGroupOverride(sessionId, target.groupId);
    }
    this.provider.refresh();
  }
}

module.exports = { ClaudeTreeProvider, ClaudeDragAndDropController };
