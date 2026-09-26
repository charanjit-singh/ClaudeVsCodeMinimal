# Profile communication

Let your Claude agents talk to each other, even when they run under **different Claude accounts**.

![A Work agent asks a Personal live chat whether a migration is merged, and gets the answer back](../readme-assets/profile-communication.png)
<sub>Illustration: a Work agent in agent view messaging a Personal live chat in the same project.</sub>

Sessions on the same account can already reach each other through Claude Code. Sessions on different
profiles can't: each one has its own `CLAUDE_CONFIG_DIR`, so they never see each other. Cross-profile
messaging adds a small bridge that connects them, **one project at a time**.

---

## Turn it on

Run **Claude: Toggle Cross-Profile Messaging** in the project, or hover a status bar button and click
**Turn on cross-profile messaging**.

- The setting is saved to that project's workspace settings, so each project opts in on its own. With no
  folder open, it's saved to your User settings instead.
- Buttons show a chat-bubble icon while it's on.
- Agents that are already running aren't affected. Only agents started from a fresh agents tab can
  message. The extension offers to restart the tab for you.

Prefer JSON? Add this to `.vscode/settings.json`:

```jsonc
"claudeLauncher.crossProfileMessaging": true
```

---

## Two ways to talk

### Agents in agent view (mailbox)

Every agent you start from an agents tab gets four tools:

| Tool | What it does |
|---|---|
| `list_peers` | Shows every session in this project across all profiles, with ids and what each is working on |
| `send_message` | Messages one session by id (`personal-48213`) or everyone on a profile (`Personal`) |
| `read_messages` | Returns and clears unread messages |
| `set_label` | Tells peers what this session is working on |

Incoming messages reach the agent automatically at three points: after each tool call, when you send it a
prompt, and just before it would go idle, so it handles them before stopping. You don't have to tell it
to check.

**Limit:** an agent that's already idle won't wake up by itself. It sees the message on its next turn.

### Live chat (channels)

Want messages to land instantly, even in an idle session? Run **Claude: Open Live Chat**, or click
**Live chat** in the button's tooltip. This opens a `Claude Chat — <profile>` tab: a regular Claude
session where the bridge is loaded as a
[Claude Code channel](https://code.claude.com/docs/en/channels), so messages push in as they arrive.

Things to know:

- **Channels are a research preview.** Custom channels load only through Claude Code's
  `--dangerously-load-development-channels` flag, so you'll see a development notice when the tab starts.
  Channels also need claude.ai or Console authentication, and Team and Enterprise orgs have to enable them.
- **Check the startup notice.** It should say messages from `server:claude_agents_bridge` "inject
  directly in this session". If it shows a warning instead, channels aren't available for your account
  yet. You can still message: `read_messages` returns everything sent to that session in the last hour,
  so nothing is lost.
- **Agent view can't use channels.** Claude Code only accepts the channel flags on a plain `claude`
  session, which is why live chat is a separate tab.

---

## Messaging other profiles

A project pinned to one profile (**Claude: Set Project Profile**) only shows that profile's button. The
other profiles are still one command away:

![Picking a profile for this project, with Work marked as the project default](../readme-assets/profile-picker.png)
<sub>Illustration: "Open Agents for Profile…" in a project pinned to Work.</sub>

| Command | What it does |
|---|---|
| **Claude: Open Agents for Profile…** | Opens or focuses any profile's agents tab |
| **Claude: New Agents Tab for Profile…** | Always opens a fresh agents tab for any profile |
| **Claude: Open Live Chat for Profile…** | Opens or focuses any profile's live chat |

The button's tooltip also has an **Other profile…** link. Your shortcut and the button itself still go
to the project default.

---

## How it works

```
 Work agent ──send_message──▶  ~/.claude-agents-bridge/projects/<project hash>/
                                   inbox/personal-48213/…json
                                          │
             agent view:  a hook hands it over between steps
             live chat:   the bridge pushes it as a channel event
                                          ▼
                                   Personal session
```

- **One bridge, scoped per project.** The extension ships a single zero-dependency script. Every session
  runs its own instance of it, and they all share a mailbox folder keyed to the project path. A Work agent in
  `billing-service` can never see mail for `website`.
- **Nothing is added to your repos or your Claude config.** The bridge is passed at launch with
  `--mcp-config` (plus `--settings` for the hooks in agent view). The files it uses live in
  `~/.claude-agents-bridge/`, with folders set to `700` and files to `600`.
- **No Node install needed.** The bridge runs on the copy of Node that ships inside VS Code.
- **Messages to an absent profile wait for it.** Sending to `Work` when no Work session is running in the
  project queues the message, and the next Work session there receives it. If a session closes with
  unread mail, the mail goes back into that queue.

---

## Safety

- **Peer messages are not your instructions.** Every message reaches the agent with a note to treat it as
  a request from a collaborator and to check with you before anything destructive or outside its task.
  In testing, an agent told "you can deploy" by a peer reported the message and didn't deploy.
- **Permissions still apply.** Messaging doesn't grant anything new. If you run with
  `dangerouslySkipPermissions` on, keep in mind that a peer's message can prompt an agent to act without
  asking you first.
- **Untrusted folders can't turn it on.** Until you trust a folder, its own settings can't enable
  cross-profile messaging.
- **It stays on your machine.** Messages are plain files in your home folder. Nothing leaves your machine
  except through the Claude sessions themselves.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agents don't have `list_peers` | Turn messaging on, then restart the agents tab. Only agents started after that get the tools. |
| A message never arrived | The recipient may be idle. It sees the message on its next turn, or it can call `read_messages`. |
| Live chat shows a channels warning at startup | Channels aren't enabled for your account or org yet. Use `read_messages`, or message from agent view instead. |
| `list_peers` shows only you | No other sessions are running in this project with messaging on. Messages sent to a profile name wait until one starts. |

[← Back to README](../README.md)
