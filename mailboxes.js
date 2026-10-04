'use strict';
// Installs the agent-mailbox mod into each Claude profile and removes it
// again. A plugin folder in <config dir>/skills/ loads in every session of
// that profile (as agent-mailbox@skills-dir), so installing is copying one
// folder: no `claude mcp add`, no settings.json edits, no status line changes.

const fs = require('fs');
const os = require('os');
const path = require('path');
const bridge = require('./bridge/bridge.js');

const ROOT = bridge.ROOT;
const SCRIPT = path.join(ROOT, 'bin', 'bridge.js');
const MOD = 'agent-mailbox';

function expandHome(p) {
  const t = String(p || '').trim();
  if (t === '~') return os.homedir();
  if (t.startsWith('~/')) return path.join(os.homedir(), t.slice(2));
  return t;
}

function profileDir(profile) {
  return profile.configDir ? path.resolve(expandHome(profile.configDir)) : path.join(os.homedir(), '.claude');
}

function modTarget(dir) {
  return path.join(dir, 'skills', MOD);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function modVersion(extensionPath) {
  const manifest = readJson(path.join(extensionPath, 'mod', MOD, '.claude-plugin', 'plugin.json'));
  return (manifest && manifest.version) || '0';
}

// Only ever replaces or removes a folder that is ours.
function isOurMod(dir) {
  const manifest = readJson(path.join(modTarget(dir), '.claude-plugin', 'plugin.json'));
  return !fs.existsSync(modTarget(dir)) || (manifest && manifest.name === MOD);
}

function installMod(extensionPath, dir) {
  if (!isOurMod(dir)) throw new Error(`${modTarget(dir)} exists and isn't the agent-mailbox mod, so it was left alone.`);
  const target = modTarget(dir);
  const staging = `${target}.installing-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(extensionPath, 'mod', MOD), staging, {
    recursive: true,
    filter: (src) => !/[\\/]tests([\\/]|$)/.test(src) && !/[\\/]\.claude-plugin[\\/]types([\\/]|$)/.test(src),
  });
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);
}

function uninstallMod(dir) {
  if (!isOurMod(dir)) throw new Error(`${modTarget(dir)} isn't the agent-mailbox mod, so it was left alone.`);
  fs.rmSync(modTarget(dir), { recursive: true, force: true });
}

// The bridge runs on the Node inside VS Code (ELECTRON_RUN_AS_NODE), copied
// to a stable path so sessions outlive extension updates.
function writeRuntime(extensionPath, node, profiles) {
  const code = fs.readFileSync(path.join(extensionPath, 'bridge', 'bridge.js'));
  let current;
  try {
    current = fs.readFileSync(SCRIPT);
  } catch {}
  if (!current || !current.equals(code)) writeAtomic(SCRIPT, code);
  const names = {};
  for (const p of profiles) names[profileDir(p)] = p.name;
  writeAtomic(path.join(ROOT, 'runtime.json'), JSON.stringify({ node, bridge: SCRIPT, profiles: names }, null, 2));
  const readme = path.join(ROOT, 'README.txt');
  if (!fs.existsSync(readme)) {
    writeAtomic(
      readme,
      'Claude mailboxes, managed by the Claude Agents VS Code extension.\n\n' +
        'mailboxes/<name>/mailbox.json  which project folders each mailbox covers\n' +
        'mailboxes/<name>/...           who is here, and messages waiting for delivery\n' +
        'sessions/                      the name each running Claude session has\n' +
        'bin/bridge.js, runtime.json    what the agent-mailbox mod runs to reach these files\n' +
        'installed.json                 which Claude profiles the mod is installed in\n\n' +
        'Remove it with "Claude Agents: Remove Mailboxes" in VS Code.\n'
    );
  }
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

// Several VS Code windows can activate at once; only one should install.
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
    if (age < 60000) return { skipped: true, installed: [], removed: [], errors: [] };
    fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(lock);
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

// Brings every profile in line with `enabled`: installs into profiles that are
// new or out of date, removes from ones no longer wanted.
function sync({ enabled, profiles, extensionPath, node = process.execPath, force = false }) {
  return withLock(async () => {
    const result = { installed: [], removed: [], errors: [] };
    const version = modVersion(extensionPath);
    const desired = new Map();
    if (enabled) {
      for (const p of profiles) {
        const dir = profileDir(p);
        if (!desired.has(dir)) desired.set(dir, { name: p.name, configDir: p.configDir || '' });
      }
      writeRuntime(extensionPath, node, profiles);
    }
    const stamp = readStamp();
    for (const [dir, want] of desired) {
      const have = stamp.profiles[dir];
      const upToDate = have && have.version === version && fs.existsSync(path.join(modTarget(dir), 'hooks', 'register.tsx'));
      if (!force && upToDate) {
        if (have.name !== want.name) stamp.profiles[dir] = { ...have, name: want.name };
        continue;
      }
      try {
        installMod(extensionPath, dir);
        stamp.profiles[dir] = { ...want, version };
        result.installed.push(want.name);
      } catch (e) {
        result.errors.push(`${want.name}: ${e.message}`);
      }
    }
    for (const [dir, have] of Object.entries(stamp.profiles)) {
      if (desired.has(dir)) continue;
      try {
        uninstallMod(dir);
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

module.exports = { sync, isInstalled, readStamp, profileDir, modTarget, ROOT, SCRIPT, MOD };
