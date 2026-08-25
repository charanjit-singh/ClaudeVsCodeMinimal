# Claude Agents

One status bar button. No sidebar, no tree, no state file.

- **Click** the `Claude Agents` item in the status bar: focuses the terminal if it's already open,
  otherwise opens a new one running `claude agents --cwd=<project folder>`.
- The terminal opens as a **pinned tab** in the editor group (not a split panel), named "Claude Agents".
- **Command Palette → "Claude: New Agents Tab"** always opens a fresh tab, even if one is already open.
  (VS Code doesn't give extensions a way to distinguish a plain click from a ⌘/Ctrl-click on a custom
  command, so "new tab" is this separate command rather than a real modifier-click.)

## Run it

1. Open this folder in VS Code: `code ~/Projects/ClaudeVsCodeMinimal`
2. Press `F5` (or Run > Start Debugging) — this launches an Extension Development Host window.
3. Look for `Claude Agents` in that window's status bar (bottom-left).

## Install permanently

```bash
npm i -g @vscode/vsce
cd ~/Projects/ClaudeVsCodeMinimal
vsce package
code --install-extension claude-launcher-minimal-0.2.0.vsix
```

Requires the `claude` CLI on your `PATH`, and VS Code `^1.93.0`+.
