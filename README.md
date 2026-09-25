# Claude Agents

One status bar button per profile. No sidebar, no tree, no state file.

- **Click** a profile's item in the status bar: focuses its terminal if it's already open,
  otherwise opens a new one running `claude agents --cwd=<project folder>`.
- The terminal opens as a **pinned tab** in the editor group (not a split panel), named
  "Claude Agents — `<profile>`".
- **Command Palette → "Claude: New Agents Tab"** always opens a fresh tab, even if one is already open
  for that profile. (VS Code doesn't give extensions a way to distinguish a plain click from a
  ⌘/Ctrl-click on a custom command, so "new tab" is this separate command rather than a real
  modifier-click.)
- Launches with `--dangerously-skip-permissions` by default (skips Claude Code's permission prompts).
  Turn off via the setting `claudeLauncher.dangerouslySkipPermissions`.

## Profiles

By default there's one button, `Claude`, using Claude Code's normal `~/.claude` config. To run separate
accounts (e.g. personal vs. work) side by side, add profiles in `settings.json`:

```jsonc
"claudeLauncher.profiles": [
  { "name": "Personal" },
  { "name": "Work", "configDir": "~/.claude-work" }
]
```

Each profile gets its own status bar button and its own tracked terminal. `configDir` is passed as
`CLAUDE_CONFIG_DIR` when launching that profile (e.g. `CLAUDE_CONFIG_DIR=~/.claude-work claude agents ...`);
omit it to use the default `~/.claude`. Add as many as you want — unlimited, and each name must be unique.
The Command Palette commands prompt you to pick a profile when there's more than one.

## Run it

1. Open this folder in VS Code: `code ~/Projects/ClaudeVsCodeMinimal`
2. Press `F5` (or Run > Start Debugging) — this launches an Extension Development Host window.
3. Look for `✨ Claude` (or your configured profile names) in that window's status bar, bottom-right,
   next to the notification bell.

## Install permanently

```bash
npm i -g @vscode/vsce
cd ~/Projects/ClaudeVsCodeMinimal
vsce package
code --install-extension claude-launcher-minimal-0.4.0.vsix
```

Requires the `claude` CLI on your `PATH`, and VS Code `^1.93.0`+.
