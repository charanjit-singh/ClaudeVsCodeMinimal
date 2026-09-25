# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.1]

### Added
- README screenshots (pinned terminal tab, status bar buttons).
- Marketplace icon (`media/icon.png`) and a `repository` field in `package.json`, in prep for
  publishing to the VS Code Marketplace.

### Changed
- `.vscodeignore` trims `.github/`, `.gitignore`, and `readme-assets/` out of the packaged `.vsix` —
  README images resolve against the GitHub repo instead of being bundled.

## [0.4.0]

### Added
- Multi-profile support via `claudeLauncher.profiles` — one status bar button and one tracked
  terminal per profile, unlimited profiles.
- `configDir` per profile, passed through as `CLAUDE_CONFIG_DIR` (e.g. a separate `~/.claude-work`
  for a work account), so Personal and Work can run side by side without colliding.

## [0.3.0]

### Added
- `claudeLauncher.dangerouslySkipPermissions` setting (default `true`) — launches with
  `claude agents --dangerously-skip-permissions`, bypassing Claude Code's permission prompts.

## [0.2.2]

### Changed
- Status bar item shows `✨ Claude` (icon + label) instead of icon-only — the sparkle codicon alone
  wasn't recognizable enough.

## [0.2.1]

### Changed
- Status bar item moved from the left side to the right, next to the built-in notification bell.
- Icon switched to the `$(sparkle)` codicon, icon-only. (VS Code status bar items can only render
  codicons or a custom icon font, not the extension's own SVG logo.)

## [0.2.0]

### Changed
- Rewritten from a full sidebar (tree view with groups, per-agent colors/avatars, live status,
  rename, drag-and-drop) down to a single status bar button: click to open-or-focus a pinned
  `claude agents --cwd=<project>` terminal tab; "Claude: New Agents Tab" command to force a new one.
- Removed the sidebar tree, group/avatar/color state, and the `~/.claude-vscode-extension-data`
  state file — the extension no longer reads or writes anything outside the terminal it opens.

## [0.1.0]

### Added
- Initial release: sidebar listing Claude Code sessions grouped by project, with live status,
  colors, avatars, rename, and drag-and-drop between groups.
