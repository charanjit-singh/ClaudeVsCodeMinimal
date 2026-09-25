<div align="center">

<img src="media/icon.png" width="96" alt="Claude Agents icon" />

# Claude Agents for VS Code

**Your Claude Code agents, one click away.**

A tiny button in your status bar opens Claude's agent view for the project you're in,
right inside your editor. No sidebar, no setup, no clutter.

[![Install from VS Code Marketplace](https://img.shields.io/badge/VS%20Code%20Marketplace-Install-D97757?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=charanjit-singh.claude-launcher-minimal)
[![Latest release](https://img.shields.io/github/v/release/charanjit-singh/ClaudeVsCodeMinimal?color=D97757)](https://github.com/charanjit-singh/ClaudeVsCodeMinimal/releases/latest)

[**Install from the VS Code Marketplace →**](https://marketplace.visualstudio.com/items?itemName=charanjit-singh.claude-launcher-minimal)

</div>

![Claude Agents running as a pinned tab inside VS Code](readme-assets/pinned-chat.png)

---

## Why I built this

Moving from Cursor to Claude Code was a brain slap. In Cursor, chats lived right next to my code:
I opened one, did the work, came back to it later. With Claude Code, I was juggling terminals and
losing track of which session belonged to which project.

So I built the thing I was missing. Claude's agent view now sits one click away in every project.
**I treat each agent like a chat:** start one per task, come back to it later, and each project keeps
its own set. It feels like Cursor's chat panel, but it's running Claude Code.

---

## Why you'll like it

**⚡ One click, you're in.**
Click `✨ Claude` in the status bar, or press `⌘⌥A` (`Ctrl+Alt+A`), and `claude agents` opens for
your current project. Already open? The same click takes you back to it, even after a window reload,
so you don't end up with a pile of duplicate tabs.

**📌 It stays put.**
Agents open as a pinned editor tab next to your code, not squeezed into the bottom panel. Switch
files as much as you like and the tab stays where you left it.

**👥 Work and personal, side by side.**
Using more than one Claude account? Give each one its own button and its own color. Each profile
keeps its own config, its own login, and its own terminal, and you can add as many as you need.
Pin a project to one profile and only that button shows up there.

![Work and Personal profile buttons next to the notification bell](readme-assets/bottom-right.png)

**🚀 Built for flow.**
Agents launch with full autonomy by default, so they don't stop to ask permission for every step.
Prefer to approve actions yourself? It's one setting to turn off.

**🪶 Nothing extra.**
No panels, no background indexing, no telemetry, no state files. It's a single small file with
no dependencies, starts after VS Code finishes loading, and stays out of your way. Want your agents waiting for you
when you open a project? Turn on one setting.

---

## Get started in 30 seconds

1. **Install** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=charanjit-singh.claude-launcher-minimal),
   or search **"Claude Agents"** in the Extensions view, or run:
   ```bash
   code --install-extension charanjit-singh.claude-launcher-minimal
   ```
2. **Click** `✨ Claude` in the bottom-right corner of your status bar.

That's it. Prefer a manual install? Grab the `.vsix` from
[GitHub Releases](https://github.com/charanjit-singh/ClaudeVsCodeMinimal/releases/latest) and use
**Extensions** → `···` → **Install from VSIX…**

> **You'll need** the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) on your `PATH`
> and VS Code 1.93 or newer.

---

## Set up multiple accounts

Run **Claude: Manage Profiles** from the Command Palette, or hover any status bar button and click
**Manage profiles**. From there you can add a profile, pick its color, point it at its own config
folder, rename it, or delete it, all without touching JSON.

Prefer editing settings directly? Add this to your `settings.json`:

```jsonc
"claudeLauncher.profiles": [
  { "name": "Personal", "color": "blue" },
  { "name": "Work", "configDir": "~/.claude-work", "color": "magenta" }
]
```

Each profile gets its own status bar button. `configDir` points that profile at its own Claude
config folder (it's passed to Claude as `CLAUDE_CONFIG_DIR`), so your accounts, sessions, and
settings never mix. Leave `configDir` out to use the default `~/.claude`.

`color` tints the profile's button and its terminal tab so you always know which account you're
in. Pick from `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, or `white`; the exact
shade comes from your theme. A new color shows on the button right away. A tab that's already open
keeps its old color until you open a new one, because VS Code can't recolor an existing terminal.

The first time you launch a new profile, sign in once and you're done.

### Pin a project to one profile

In a work repo, open **Workspace** settings (`.vscode/settings.json`) and add:

```jsonc
"claudeLauncher.defaultProfile": "Work"
```

Now that window shows only the **Work** button, and the keyboard shortcut opens Work agents without
asking which profile you meant.

---

## Tips

| You want to… | Do this |
|---|---|
| Open or jump back to your agents | Click the profile's button, or press `⌘⌥A` / `Ctrl+Alt+A` |
| Open a second, separate agents tab | `⌘⌥⇧A` / `Ctrl+Alt+Shift+A`, or **Claude: New Agents Tab** |
| Give each account its own shortcut | Add a keybinding for `claudeLauncher.openAgents` with `"args": { "name": "Work" }` |
| Have agents open when you open a project | Turn on `claudeLauncher.openOnStartup` |
| Approve each action yourself | Set `claudeLauncher.dangerouslySkipPermissions` to `false` |
| Add an account, or change a color | **Claude: Manage Profiles**, or hover a button → **Manage profiles** |

Shortcut already taken? Rebind it in **Keyboard Shortcuts** (`⌘K ⌘S`) by searching "Claude Agents".

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| `claudeLauncher.profiles` | `[{ "name": "Claude" }]` | One status bar button per entry. Optional `configDir` and `color` per profile. Easiest to edit with **Claude: Manage Profiles**. |
| `claudeLauncher.defaultProfile` | `""` | Set per workspace. Shows only this profile's button, and shortcuts use it without asking. |
| `claudeLauncher.openOnStartup` | `false` | Opens the agents tab when a window opens. Works in single-folder workspaces when the profile is clear: your `defaultProfile`, or your only profile. |
| `claudeLauncher.dangerouslySkipPermissions` | `true` | Launches with `--dangerously-skip-permissions`. Turn it off if you want Claude to ask before acting. |

> ⚠️ With permissions skipped, agents can edit files and run commands without asking first.
> That's great for momentum, but only use it on projects where you're comfortable with that.

---

## Pairs well with: Sync Code Theme

Working on several projects at once? Install
[**sync-code-theme**](https://github.com/charanjit-singh/claude-plugins#sync-code-theme), a Claude Code
plugin that tints each VS Code window with its project's own brand colors. Combined with Claude Agents,
you can tell at a glance which window, and which agents, belong to which project.

---

## For contributors

```bash
git clone https://github.com/charanjit-singh/ClaudeVsCodeMinimal.git
cd ClaudeVsCodeMinimal
code .            # then press F5 to launch an Extension Development Host
```

Pushing a `vX.Y.Z` tag builds the `.vsix` and publishes a GitHub Release automatically, using that
version's notes from the [CHANGELOG](CHANGELOG.md).

---

<div align="center">
<sub>An independent community project. Not affiliated with or endorsed by Anthropic.</sub>
</div>
