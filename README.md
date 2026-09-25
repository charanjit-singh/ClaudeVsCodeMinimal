<div align="center">

<img src="media/icon.png" width="96" alt="Claude Agents icon" />

# Claude Agents for VS Code

**Your Claude Code agents, one click away.**

A tiny button in your status bar opens Claude's agent view for the project you're in,
right inside your editor. No sidebar, no setup, no clutter.

[![Install from VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/charanjit-singh.claude-launcher-minimal?label=VS%20Code%20Marketplace&logo=visualstudiocode&color=D97757)](https://marketplace.visualstudio.com/items?itemName=charanjit-singh.claude-launcher-minimal)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/charanjit-singh.claude-launcher-minimal?color=D97757)](https://marketplace.visualstudio.com/items?itemName=charanjit-singh.claude-launcher-minimal)

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
Click `✨ Claude` in the status bar and `claude agents` opens for your current project. Already
open? The same click takes you back to it, so you don't end up with a pile of duplicate tabs.

**📌 It stays put.**
Agents open as a pinned editor tab next to your code, not squeezed into the bottom panel. Switch
files as much as you like and the tab stays where you left it.

**👥 Work and personal, side by side.**
Using more than one Claude account? Give each one its own button. Each profile keeps its own
config, its own login, and its own terminal, and you can add as many as you need.

![Work and Personal profile buttons next to the notification bell](readme-assets/bottom-right.png)

**🚀 Built for flow.**
Agents launch with full autonomy by default, so they don't stop to ask permission for every step.
Prefer to approve actions yourself? It's one setting to turn off.

**🪶 Nothing extra.**
No panels, no background indexing, no telemetry, no state files. It's around 150 lines of code,
starts after VS Code finishes loading, and stays out of your way.

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

Open your `settings.json` and list your profiles:

```jsonc
"claudeLauncher.profiles": [
  { "name": "Personal" },
  { "name": "Work", "configDir": "~/.claude-work" }
]
```

Each profile gets its own status bar button. `configDir` points that profile at its own Claude
config folder (it's passed to Claude as `CLAUDE_CONFIG_DIR`), so your accounts, sessions, and
settings never mix. Leave `configDir` out to use the default `~/.claude`.

The first time you launch a new profile, sign in once and you're done.

---

## Tips

| You want to… | Do this |
|---|---|
| Open or jump back to your agents | Click the profile's button in the status bar |
| Open a second, separate agents tab | Command Palette → **Claude: New Agents Tab** |
| Approve each action yourself | Set `claudeLauncher.dangerouslySkipPermissions` to `false` |
| Add another account | Add an entry to `claudeLauncher.profiles` |

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| `claudeLauncher.profiles` | `[{ "name": "Claude" }]` | One status bar button per entry. Optional `configDir` per profile. |
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
