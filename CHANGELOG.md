# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.7.0]

### Added
- **Claude: Set Project Profile** picks which profile the current project uses and saves it to the
  project's workspace settings. **All profiles** switches back to showing every button. It's also
  available from Manage Profiles, from a **Project profile** link when you hover a button, and from
  the setting's description.
- README section on per-project JSON overrides: what goes in User vs Workspace settings, and how they
  combine.

### Security
- Until you trust a folder, its own `.vscode/settings.json` can no longer change `profiles`,
  `dangerouslySkipPermissions`, or `openOnStartup`, and `openOnStartup` never fires there. Before
  this, a cloned repo could auto-launch an agent with permissions skipped, or point a profile's
  `configDir` at a folder inside the repo, which Claude would load hooks from.

## [0.6.0]

### Added
- **Claude: Manage Profiles** command: add, rename, recolor, change the config folder of, or delete
  profiles from menus, with no JSON editing. It picks colors from a swatch list.
- Hovering a status bar button shows **New tab** and **Manage profiles** links.
- The profiles setting in the Settings UI links straight to Manage Profiles, since VS Code's settings
  editor can't edit a list of profiles itself.

### Changed
- Renaming or deleting a profile also updates `claudeLauncher.defaultProfile` wherever it points at
  that profile.

## [0.5.0]

### Added
- Keyboard shortcuts: `⌘⌥A` / `Ctrl+Alt+A` opens or focuses your agents, `⌘⌥⇧A` /
  `Ctrl+Alt+Shift+A` opens a new tab. Custom keybindings can target a profile with
  `"args": { "name": "Work" }`.
- `claudeLauncher.defaultProfile`: pin a workspace to one profile. Only its button shows, and
  shortcuts and commands use it without asking.
- Per-profile `color` that tints the status bar button and the terminal tab.
- `claudeLauncher.openOnStartup`: open the agents tab automatically when a window opens.

### Fixed
- After a window reload, clicking a profile's button focuses the tab VS Code restored instead of
  opening a duplicate.

## [0.4.2]

### Changed
- README rewritten as a landing page: why it exists, what it does, and a 30-second install from the
  VS Code Marketplace.
- Tagged releases now publish to the VS Code Marketplace automatically, alongside the GitHub Release.

### Fixed
- Replaced the retired Marketplace badges in the README with ones that render.

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
