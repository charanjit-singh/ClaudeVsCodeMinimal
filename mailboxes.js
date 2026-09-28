'use strict';
// Installs the mailbox bridge into each Claude profile's own config, so every
// session of that profile has it however it was started: a user-scope MCP
// server (via the official `claude mcp` CLI), three hooks, and a status line
// segment that wraps any status line already there. Uninstall reverses all of it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const bridge = require('./bridge/bridge.js');

const ROOT = bridge.ROOT;
const SERVER = bridge.SERVER_NAME;
const SCRIPT = path.join(ROOT, 'bin', 'bridge.js');
// Trailing shell comment that tags every command we install, so we can find
// and remove exactly ours and never touch anyone else's.
const MARK = '# claude-mailbox';
const HOOK_EVENTS = ['PostToolUse', 'UserPromptSubmit', 'Stop'];

function q(arg) {
  if (/^[A-Za-z0-9_\-./:=]+$/.test(arg)) return arg;
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

function expandHome(p) {
  const t = String(p || '').trim();
  if (t === '~') return os.homedir();
  if (t.startsWith('~/')) return path.join(os.homedir(), t.slice(2));
  return t;
}

function profileDir(profile) {
  return profile.configDir ? path.resolve(expandHome(profile.configDir)) : path.join(os.homedir(), '.claude');
}

function isOurs(command) {
  return typeof command === 'string' && command.trimEnd().endsWith(MARK);
}

function envPrefix() {
  const parts = ['ELECTRON_RUN_AS_NODE=1'];
  if (process.env.CLAUDE_MAILBOXES_ROOT) parts.push(`CLAUDE_MAILBOXES_ROOT=${q(ROOT)}`);
  return parts.join(' ');
}

function hookCommand(node, profile) {
  return `${envPrefix()} ${q(node)} ${q(SCRIPT)} hook --profile ${q(profile.name)} ${MARK}`;
}

function statusCommand(node, profile, wrapFile) {
  const wrap = wrapFile ? ` --wrap ${q(wrapFile)}` : '';
  return `${envPrefix()} ${q(node)} ${q(SCRIPT)} statusline --profile ${q(profile.name)}${wrap} ${MARK}`;
}

function writeAtomic(file, text, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

// Sessions that outlive an extension update keep pointing at a stable copy.
function copyBridge(extensionPath) {
  const code = fs.readFileSync(path.join(extensionPath, 'bridge', 'bridge.js'));
  let current;
  try {
    current = fs.readFileSync(SCRIPT);
  } catch {}
  if (!current || !current.equals(code)) writeAtomic(SCRIPT, code, 0o600);
  const readme = path.join(ROOT, 'README.txt');
  if (!fs.existsSync(readme)) {
    writeAtomic(
      readme,
      'Claude mailboxes, managed by the Claude Agents VS Code extension.\n\n' +
        'mailboxes/<name>/mailbox.json  which project folders each mailbox covers\n' +
        'mailboxes/<name>/inbox, pending messages waiting to be delivered\n' +
        'bin/bridge.js                  the MCP server, hook and status line used by every profile\n' +
        'installed.json                 which Claude profiles it is installed into\n\n' +
        'Remove it with "Claude Agents: Remove Mailboxes" in VS Code.\n'
    );
  }
}

// VS Code launched from the Dock may not have the shell's PATH.
function findClaude() {
  if (process.env.CLAUDE_MAILBOX_CLAUDE) return process.env.CLAUDE_MAILBOX_CLAUDE;
  const home = os.homedir();
  for (const candidate of [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'claude';
}

function runClaude(claude, args, profile) {
  const env = { ...process.env };
  if (profile.configDir) env.CLAUDE_CONFIG_DIR = profileDir(profile);
  else delete env.CLAUDE_CONFIG_DIR;
  return new Promise((resolve) => {
    execFile(claude, args, { env, timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr || (err && err.message) || '') });
    });
  });
}

function readSettings(file) {
  if (!fs.existsSync(file)) return { json: {}, existed: false };
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return { json: {}, existed: true };
  try {
    return { json: JSON.parse(text), existed: true };
  } catch {
    throw new Error(`${file} isn't valid JSON, so it was left untouched. Fix it and try again.`);
  }
}

function writeSettings(file, json, existed) {
  const backup = `${file}.before-claude-mailbox`;
  if (existed && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  let mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {}
  writeAtomic(file, `${JSON.stringify(json, null, 2)}\n`, mode);
}

// Removes our hook entries (and any group left empty by that) and, when
// `command` is given, adds ours back. Other hooks are never touched.
function applyHooks(json, command) {
  const hooks = json.hooks && typeof json.hooks === 'object' ? json.hooks : {};
  for (const event of HOOK_EVENTS) {
    let groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    groups = groups
      .map((g) => {
        const list = Array.isArray(g && g.hooks) ? g.hooks : [];
        const kept = list.filter((h) => !isOurs(h && h.command));
        return kept.length === list.length ? g : kept.length ? { ...g, hooks: kept } : null;
      })
      .filter(Boolean);
    if (command) {
      const ours = { type: 'command', command, timeout: 10 };
      groups.push(event === 'PostToolUse' ? { matcher: '*', hooks: [ours] } : { hooks: [ours] });
    }
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length) json.hooks = hooks;
  else delete json.hooks;
}

function statusBackup(dir) {
  return path.join(ROOT, 'statusline', `${crypto.createHash('sha1').update(dir).digest('hex').slice(0, 12)}.json`);
}

async function installProfile(profile, { node, claude }) {
  const dir = profileDir(profile);
  await runClaude(claude, ['mcp', 'remove', '--scope', 'user', SERVER], profile);
  const env = ['-e', 'ELECTRON_RUN_AS_NODE=1', '-e', `CLAUDE_MAILBOX_PROFILE=${profile.name}`];
  if (process.env.CLAUDE_MAILBOXES_ROOT) env.push('-e', `CLAUDE_MAILBOXES_ROOT=${ROOT}`);
  const added = await runClaude(claude, ['mcp', 'add', '--scope', 'user', SERVER, ...env, '--', node, SCRIPT, 'serve'], profile);
  if (added.code !== 0) throw new Error(`claude mcp add failed for ${profile.name}: ${added.stderr.trim() || added.stdout.trim()}`);

  const file = path.join(dir, 'settings.json');
  const { json, existed } = readSettings(file);
  applyHooks(json, hookCommand(node, profile));
  const backup = statusBackup(dir);
  if (json.statusLine && !isOurs(json.statusLine.command)) writeAtomic(backup, JSON.stringify(json.statusLine, null, 2));
  const original = readJson(backup);
  json.statusLine = { ...(original || {}), type: 'command', command: statusCommand(node, profile, original ? backup : null) };
  writeSettings(file, json, existed);
}

async function uninstallProfile(profile, { claude }) {
  const dir = profileDir(profile);
  await runClaude(claude, ['mcp', 'remove', '--scope', 'user', SERVER], profile);
  const file = path.join(dir, 'settings.json');
  if (fs.existsSync(file)) {
    const { json, existed } = readSettings(file);
    applyHooks(json, null);
    if (json.statusLine && isOurs(json.statusLine.command)) {
      const original = readJson(statusBackup(dir));
      if (original) json.statusLine = original;
      else delete json.statusLine;
    }
    writeSettings(file, json, existed);
  }
  try {
    fs.unlinkSync(statusBackup(dir));
  } catch {}
}

function stampFile() {
  return path.join(ROOT, 'installed.json');
}

function readStamp() {
  const stamp = readJson(stampFile());
  return stamp && stamp.profiles ? stamp : { profiles: {} };
}

function isInstalled() {
  return Object.keys(readStamp().profiles).length > 0;
}

// Several VS Code windows can activate at once; only one should edit configs.
async function withLock(fn) {
  const lock = path.join(ROOT, '.lock');
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(lock);
  } catch {
    let age = 0;
    try {
      age = Date.now() - fs.statSync(lock).mtimeMs;
    } catch {}
    if (age < 120000) return { skipped: true, installed: [], removed: [], errors: [] };
    fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(lock);
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

// Brings every profile's config in line with `enabled`: installs into
// profiles that are new or changed, removes from ones no longer wanted.
function sync({ enabled, profiles, extensionPath, node = process.execPath, claude = findClaude(), force = false }) {
  return withLock(async () => {
    const result = { installed: [], removed: [], errors: [] };
    if (enabled) copyBridge(extensionPath);
    const desired = new Map();
    if (enabled) {
      for (const p of profiles) {
        const dir = profileDir(p);
        if (!desired.has(dir)) desired.set(dir, { name: p.name, configDir: p.configDir || '' });
      }
    }
    const stamp = readStamp();
    for (const [dir, want] of desired) {
      const have = stamp.profiles[dir];
      if (!force && have && have.name === want.name && have.node === node && fs.existsSync(SCRIPT)) continue;
      try {
        await installProfile(want, { node, claude });
        stamp.profiles[dir] = { ...want, node };
        result.installed.push(want.name);
      } catch (e) {
        result.errors.push(`${want.name}: ${e.message}`);
      }
    }
    for (const [dir, have] of Object.entries(stamp.profiles)) {
      if (desired.has(dir)) continue;
      try {
        await uninstallProfile(have, { claude });
        delete stamp.profiles[dir];
        result.removed.push(have.name);
      } catch (e) {
        result.errors.push(`${have.name}: ${e.message}`);
      }
    }
    writeAtomic(stampFile(), JSON.stringify(stamp, null, 2));
    return result;
  });
}

module.exports = { sync, isInstalled, readStamp, profileDir, applyHooks, isOurs, ROOT, SCRIPT, SERVER };
