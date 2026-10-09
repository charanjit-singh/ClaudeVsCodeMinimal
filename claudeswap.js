'use strict';
// Optional, read-only use of claude-swap (https://github.com/realiti4/claude-swap):
// when the `cswap` CLI is installed, read every account's plan usage from
// `cswap list --json`. Never switches accounts or touches credentials.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// VS Code launched from the Dock may not have the shell's PATH; uv and pipx
// both install tools into ~/.local/bin.
function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function findCswap() {
  const override = process.env.CLAUDE_AGENTS_CSWAP;
  if (override) return isExecutable(override) ? override : undefined;
  const home = os.homedir();
  const dirs = [...String(process.env.PATH || '').split(path.delimiter), path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, process.platform === 'win32' ? 'cswap.exe' : 'cswap');
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

function window(w) {
  if (!w || typeof w.pct !== 'number') return undefined;
  return { pct: w.pct, resetsAt: w.resetsAt };
}

// Accepts schemaVersion 1 only; anything else reads as "no data" rather than
// a guess, so a format change upstream degrades to showing nothing.
function parse(text) {
  const json = JSON.parse(text);
  if (!json || json.schemaVersion !== 1 || !Array.isArray(json.accounts)) return undefined;
  return json.accounts.map((a) => {
    const usage = a.usage || a.lastGoodUsage || {};
    return {
      number: a.number,
      email: a.email || '',
      alias: a.alias || undefined,
      org: a.organizationName || a.organization || a.org || undefined,
      active: !!a.active,
      disabled: !!a.disabled,
      status: a.usageStatus || 'unknown',
      isStale: !a.usage && !!a.lastGoodUsage,
      fiveHour: window(usage.fiveHour),
      sevenDay: window(usage.sevenDay),
    };
  });
}

function readAccounts(bin = findCswap(), { timeoutMs = 30000 } = {}) {
  if (!bin) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(bin, ['list', '--json'], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return resolve(undefined);
      try {
        resolve(parse(String(stdout)));
      } catch {
        resolve(undefined);
      }
    });
  });
}

// The claude-swap account a profile is signed in with: same email, and the
// same organization when claude-swap knows several under that email.
function matchAccount(accounts, account) {
  if (!accounts || !account || !account.email) return undefined;
  const email = account.email.toLowerCase();
  const same = accounts.filter((a) => a.email.toLowerCase() === email);
  if (same.length <= 1 || !account.org) return same[0];
  return same.find((a) => a.org === account.org) || same[0];
}

function peak(a) {
  return Math.max(a && a.fiveHour ? a.fiveHour.pct : 0, a && a.sevenDay ? a.sevenDay.pct : 0);
}

function resetText(iso, now = new Date()) {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = t.toDateString() === now.toDateString();
  return sameDay ? time : `${t.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function describe(a, now) {
  const part = (label, w) => (w ? `${label} ${Math.round(w.pct)}%${w.resetsAt ? ` (resets ${resetText(w.resetsAt, now)})` : ''}` : `${label} ?`);
  return `${part('5h', a.fiveHour)} · ${part('7d', a.sevenDay)}${a.isStale ? ' · last known' : ''}`;
}

module.exports = { findCswap, parse, readAccounts, matchAccount, peak, describe, resetText };
