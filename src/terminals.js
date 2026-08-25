const vscode = require('vscode');
const { execFile } = require('child_process');
const { themeColorFor } = require('./colors');

function shellEscape(arg) {
  if (/^[A-Za-z0-9_\-./:]+$/.test(arg)) return arg;
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

function parentPid(pid) {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'ppid=', '-p', String(pid)], (err, stdout) => {
      if (err) return resolve(undefined);
      const ppid = parseInt(String(stdout).trim(), 10);
      resolve(Number.isFinite(ppid) && ppid > 0 ? ppid : undefined);
    });
  });
}

// `Terminal.processId` only resolves to the shell's pid, not the `claude`
// child process running inside it — there's no direct VS Code API to map a
// pid to the Terminal that owns it. Walk up the process tree from the
// session's pid instead, and see if any ancestor matches a known terminal.
async function ancestorPids(pid, maxDepth = 10) {
  const chain = new Set([pid]);
  let current = pid;
  for (let i = 0; i < maxDepth; i++) {
    const parent = await parentPid(current);
    if (!parent || parent === current || parent <= 1 || chain.has(parent)) break;
    chain.add(parent);
    current = parent;
  }
  return chain;
}

async function findTerminalForPid(pid) {
  if (!pid) return undefined;
  const chain = await ancestorPids(pid);
  for (const terminal of vscode.window.terminals) {
    let shellPid;
    try {
      shellPid = await terminal.processId;
    } catch {
      continue;
    }
    if (shellPid && chain.has(shellPid)) {
      return terminal;
    }
  }
  return undefined;
}

class TerminalManager {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.terminals = new Map(); // sessionId -> vscode.Terminal

    vscode.window.onDidCloseTerminal((closed) => {
      for (const [sessionId, term] of this.terminals) {
        if (term === closed) {
          this.terminals.delete(sessionId);
          break;
        }
      }
    });
  }

  defaultIconUri() {
    return vscode.Uri.joinPath(this.extensionUri, 'media', 'claude-icon-color.svg');
  }

  // `name`/`color`/`iconPath` are only settable AT CREATION — VS Code has no
  // API to change an existing terminal's color or icon (the built-in
  // changeColor/changeIcon commands only open an interactive picker, they
  // don't accept a target value). Get these right up front.
  createTerminal({ name, cwd, colorId, iconUri }) {
    return vscode.window.createTerminal({
      name,
      iconPath: iconUri || this.defaultIconUri(),
      color: themeColorFor(colorId) || new vscode.ThemeColor('terminal.ansiBlue'),
      cwd,
      // Plain Editor location opens as a TAB in the active editor group, like
      // any other file — {viewColumn: Beside} (the old behavior) instead
      // split a new editor column every single time, so N agents meant N
      // side-by-side panes rather than N tabs.
      location: vscode.TerminalLocation.Editor,
    });
  }

  // The rename command only ever affects whatever terminal is currently
  // "active" — there's no API to target a specific background terminal, so
  // the caller must have already show()n it. Best-effort: swallow failures.
  async renameActiveTab(name) {
    if (!name) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name });
    } catch {
      // best-effort only
    }
  }

  // Starts a brand new (not resumed) Claude session in `cwd`. The CLI assigns
  // its own session id on first message, so this terminal is untracked until
  // the next refresh picks it up as a live session — `meta` here can only
  // carry a group's look (color/icon), not a per-agent one, since no agent
  // identity exists yet.
  // `--name` is a REAL Claude Code flag (verified against the installed CLI's
  // --help) — it sets the session's actual name, the same one shown in the
  // /resume picker and used by SendMessage/ListAgents to address it. Not a
  // VS Code cosmetic; this is Claude's own naming system.
  newAgent(cwd, meta = {}) {
    const terminal = this.createTerminal({
      name: meta.name || 'Claude',
      cwd,
      colorId: meta.colorId,
      iconUri: meta.iconUri,
    });
    terminal.show();
    const args = meta.name ? ['claude', '--name', meta.name] : ['claude'];
    terminal.sendText(args.map(shellEscape).join(' '));
    return terminal;
  }

  // Returns this window's Terminal for a session — from our own map if we
  // created it, otherwise by searching this window's terminals for one whose
  // shell is an ancestor of the session's pid (adopting it into the map so
  // later lookups are instant). Returns undefined if the session is running
  // somewhere this window has no terminal for (another window, tmux, etc).
  async locate(session) {
    const tracked = this.terminals.get(session.sessionId);
    if (tracked) return tracked;
    if (!session.live) return undefined;

    const found = await findTerminalForPid(session.pid);
    if (found) {
      this.terminals.set(session.sessionId, found);
    }
    return found;
  }

  async openAgent(session, meta = {}) {
    const terminal = await this.locate(session);
    if (terminal) {
      terminal.show();
      // Self-heals a stale tab title if the agent was renamed while this
      // terminal already existed (color/icon can't be synced the same way —
      // those only apply to a freshly created terminal, see createTerminal).
      await this.renameActiveTab(meta.name);
      return;
    }

    if (session.live) {
      if (session.jobId) {
        const choice = await vscode.window.showInformationMessage(
          `"${session.title}" is running in the background (pid ${session.pid}) — not attached to any terminal in this window (e.g. VS Code was closed and reopened since it started).`,
          'Take Over'
        );
        if (choice === 'Take Over') {
          await this.takeOver(session, meta);
        }
        return;
      }
      vscode.window.showInformationMessage(
        `"${session.title}" is running (pid ${session.pid}) in an interactive terminal outside this VS Code window — there's no way to reattach to that from here.`
      );
      return;
    }

    const resumed = this.createTerminal({
      name: meta.name || session.title,
      cwd: session.cwd,
      colorId: meta.colorId,
      iconUri: meta.iconUri,
    });
    this.terminals.set(session.sessionId, resumed);
    resumed.show();
    const args = ['claude', ...session.resumeArgv];
    if (meta.name) args.push('--name', meta.name);
    resumed.sendText(args.map(shellEscape).join(' '));
  }

  // Reattaches to a BACKGROUND session (one the daemon kept alive after its
  // original terminal closed — see docs.claude.com/agent-view) via the real
  // `claude attach <id>`. Confirmed against the installed CLI's own
  // `claude attach --help`: "Open the background session in this terminal.
  // <- returns to agent view, Ctrl+Z drops back to your shell. The session
  // keeps running either way." Only possible when session.jobId is set —
  // a plain interactive session (no daemon involved) has nothing to attach to.
  async takeOver(session, meta = {}) {
    if (!session.jobId) return false;
    const terminal = this.createTerminal({
      name: meta.name || session.title,
      cwd: session.cwd,
      colorId: meta.colorId,
      iconUri: meta.iconUri,
    });
    this.terminals.set(session.sessionId, terminal);
    terminal.show();
    terminal.sendText(`claude attach ${shellEscape(session.jobId)}`);
    return true;
  }

  async stopAgent(session) {
    const terminal = await this.locate(session);
    if (!terminal) {
      vscode.window.showInformationMessage(
        'This agent is not running in a terminal this window can see, so it cannot be stopped from here.'
      );
      return false;
    }
    terminal.dispose();
    this.terminals.delete(session.sessionId);
    return true;
  }

  // Pushes a rename into an agent that's ALREADY RUNNING right now, via
  // Claude Code's own `/rename` — a real in-session command (confirmed via
  // the CHANGELOG: it changes the actual session name used by /resume,
  // SendMessage, and ListAgents), not just this window's terminal tab.
  // We ALSO force VS Code's own tab title immediately after, since Claude's
  // side may not repaint the tab the instant the command lands.
  async syncNameIfOpen(sessionId, name) {
    const terminal = this.terminals.get(sessionId);
    if (!terminal || !name) return false;
    terminal.show();
    terminal.sendText(`/rename ${name}`);
    await this.renameActiveTab(name);
    return true;
  }
}

module.exports = { TerminalManager };
