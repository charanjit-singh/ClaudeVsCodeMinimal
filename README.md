# Claude Agents

A sidebar (Claude logo icon, from [thesvg.org](https://thesvg.org/icon/claude-code)) listing every Claude Code
session — live and resumable-historical — grouped by the project folder it ran in. Reads directly from
`~/.claude/` (sessions, jobs, transcripts); never writes there.

- **Groups** default to the project's real folder name. Rename a group with the pencil icon, or drag an
  agent onto a different group to move it there.
- **Live status** shown as an animated icon: spinning while working, a question mark while waiting on
  your input, a check when done, an outline circle for historical sessions.
- **Click** a running agent's row to focus its terminal (opens as a tab in the current editor group,
  not a new split); click a historical row to resume it (`claude --resume <id>`) in a new terminal at
  the right folder.
- **Rename** any agent with its pencil icon — this is Claude Code's own *real* session name (the same
  one used by `/resume`, `SendMessage`, and `ListAgents`), not just a label in this sidebar. If the
  agent is currently running, it's pushed live via `/rename` sent into its terminal; a historical
  agent gets renamed via `--name` the next time you resume it. Our own
  `~/.claude-vscode-extension-data/state.json` keeps the *intended* name in the meantime, so the
  sidebar shows it immediately even before the CLI has actually applied it.
- **Colors and pictures** — right-click an agent or group → Set Color / Set Picture. These are purely
  cosmetic to this sidebar (color tints the label, picture replaces the status icon while idle) — there's
  no equivalent concept in Claude Code itself to push these into.
- **+** in the view title (or on a group) starts a brand new `claude` session in that folder, optionally
  naming it up front via `--name`.

## Run it

1. Open this folder in VS Code: `code ~/Projects/ClaudeVsCodeMinimal`
2. Press `F5` (or Run > Start Debugging) — this launches an Extension Development Host window.
3. Open the Claude icon in the new window's activity bar (left side).

## Install permanently

```bash
npm i -g @vscode/vsce
cd ~/Projects/ClaudeVsCodeMinimal
vsce package
code --install-extension claude-launcher-minimal-0.1.0.vsix
```

Right-click the icon in the activity bar afterwards and choose "Pin" if it isn't shown by default.

Requires the `claude` CLI on your `PATH`, and VS Code `^1.93.0`+.

## How it works

| Concern | Source |
|---|---|
| Session list, project, title | `~/.claude/projects/<slug>/<sessionId>.jsonl` (filename = session id) |
| Live status | `~/.claude/sessions/<pid>.json` + `~/.claude/jobs/<shortId>/state.json` |
| Our own state (renames, group moves) | `~/.claude-vscode-extension-data/state.json` |

The on-disk project folder name is a lossy slug (`/` and `.` both become `-`), so grouping always reads the
real path out of the transcript content rather than trying to reverse the folder name.
