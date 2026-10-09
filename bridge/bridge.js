'use strict';
// Claude mailboxes: the file side. Zero dependencies.
//
// The claude-mailbox mod (mod/claude-mailbox) runs inside each Claude session
// and calls this script for everything that touches the mailbox files:
//   bridge.js op <name>   reads JSON args on stdin, prints a JSON result
// The mod starts it with $.process.run, so this process's parent is the
// Claude session itself: process.ppid is the session's identity.
//
// Named mailboxes live in ~/.claude-mailboxes/mailboxes/<slug>/. Each lists
// the project folders it covers; a session joins the one covering its cwd.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.env.CLAUDE_MAILBOXES_ROOT || path.join(os.homedir(), '.claude-mailboxes');
const STALE_MS = 70000;
const MAX_MESSAGE_CHARS = 20000;

// ---------- files ----------

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function jsonFiles(dir) {
  return listDir(dir).filter((n) => n.endsWith('.json')).sort();
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mailbox';
}

// ---------- session names ----------

// Every session gets a human name for as long as its Claude process lives,
// unique across all mailboxes.
const NAMES = [
  'Aanya', 'Aditi', 'Aisha', 'Ananya', 'Anika', 'Anjali', 'Anushka', 'Avni', 'Bhavna', 'Chitra',
  'Deepa', 'Diya', 'Esha', 'Gauri', 'Ira', 'Isha', 'Jaya', 'Kajal', 'Kavya', 'Kiara',
  'Lata', 'Madhu', 'Mahi', 'Meera', 'Mira', 'Naina', 'Neha', 'Nisha', 'Pooja', 'Priya',
  'Radhika', 'Riya', 'Rekha', 'Saanvi', 'Sara', 'Shreya', 'Simran', 'Sonam', 'Tanvi', 'Tara',
  'Trisha', 'Urvi', 'Vani', 'Vidya', 'Zara', 'Kriti', 'Nandini', 'Parvati', 'Rani', 'Sita',
];

function sessionFile(pid) {
  return path.join(ROOT, 'sessions', `${pid}.json`);
}

function sessionFor(pid) {
  const entry = readJson(sessionFile(pid));
  return entry && isAlive(pid) ? entry : undefined;
}

function assignName(pid) {
  const existing = sessionFor(pid);
  if (existing) return existing;
  const taken = new Set();
  for (const file of jsonFiles(path.join(ROOT, 'sessions'))) {
    const other = Number(file.replace(/\.json$/, ''));
    const entry = readJson(path.join(ROOT, 'sessions', file));
    if (entry && isAlive(other)) taken.add(entry.name);
    else {
      try {
        fs.unlinkSync(path.join(ROOT, 'sessions', file));
      } catch {}
    }
  }
  const free = NAMES.filter((n) => !taken.has(n));
  let name = free.length ? free[crypto.randomInt(free.length)] : undefined;
  for (let i = 2; !name; i++) {
    const candidate = `${NAMES[crypto.randomInt(NAMES.length)]} ${i}`;
    if (!taken.has(candidate)) name = candidate;
  }
  const entry = { name, box: null, startedAt: Date.now() };
  writeJsonAtomic(sessionFile(pid), entry);
  return entry;
}

function isSessionName(s) {
  const base = String(s).trim().replace(/\s+\d+$/, '').toLowerCase();
  return NAMES.some((n) => n.toLowerCase() === base);
}

// ---------- profiles and accounts ----------

function configDir() {
  return path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
}

// The VS Code extension records which config folder is which profile.
function profileName() {
  const runtime = readJson(path.join(ROOT, 'runtime.json'));
  const named = runtime && runtime.profiles && runtime.profiles[configDir()];
  return named || path.basename(configDir()).replace(/^\./, '') || 'claude';
}

// The account Claude Code is signed in with for a config folder (this
// session's when none is given). The default profile keeps its account in
// ~/.claude.json; a CLAUDE_CONFIG_DIR profile keeps it inside that folder.
function account(dir = process.env.CLAUDE_CONFIG_DIR) {
  const file = dir ? path.join(path.resolve(dir), '.claude.json') : path.join(os.homedir(), '.claude.json');
  const json = readJson(file);
  const a = json && json.oauthAccount;
  if (!a) return json && json.primaryApiKey ? { kind: 'api key' } : undefined;
  return {
    email: a.emailAddress || undefined,
    org: a.organizationName || undefined,
    plan: a.organizationType || a.billingType || undefined,
  };
}

// ---------- mailboxes ----------

function mailboxDir(id) {
  return path.join(ROOT, 'mailboxes', id);
}

function normalize(p) {
  const resolved = path.resolve(p);
  return resolved.length > 1 ? resolved.replace(/[\\/]+$/, '') : resolved;
}

function listMailboxes() {
  const boxes = [];
  for (const id of listDir(path.join(ROOT, 'mailboxes'))) {
    const meta = readJson(path.join(mailboxDir(id), 'mailbox.json'));
    if (!meta) continue;
    boxes.push({ id, name: meta.name || id, projects: (meta.projects || []).map(normalize), createdAt: meta.createdAt });
  }
  return boxes.sort((a, b) => a.name.localeCompare(b.name));
}

function saveMailbox(box) {
  writeJsonAtomic(path.join(mailboxDir(box.id), 'mailbox.json'), { name: box.name, projects: box.projects, createdAt: box.createdAt });
}

function covers(root, project) {
  return project === root || project.startsWith(root + path.sep);
}

// The mailbox whose most specific project folder contains `project`.
function mailboxFor(project) {
  const p = normalize(project);
  let best;
  let bestLen = -1;
  for (const box of listMailboxes()) {
    for (const root of box.projects) {
      if (covers(root, p) && root.length > bestLen) {
        best = box;
        bestLen = root.length;
      }
    }
  }
  return best;
}

function findMailbox(nameOrId) {
  const key = String(nameOrId || '').trim();
  if (!key) return undefined;
  return listMailboxes().find((b) => b.id === key || b.name.toLowerCase() === key.toLowerCase() || b.id === slug(key));
}

// A project folder belongs to at most one mailbox.
function detachProject(project) {
  const p = normalize(project);
  for (const box of listMailboxes()) {
    if (box.projects.includes(p)) {
      box.projects = box.projects.filter((x) => x !== p);
      saveMailbox(box);
    }
  }
}

function createMailbox(name, project) {
  const display = String(name || '').trim();
  if (!display) throw new Error('Mailbox name is empty.');
  const id = slug(display);
  if (findMailbox(id)) throw new Error(`A mailbox named "${display}" already exists. Select it instead.`);
  if (project) detachProject(project);
  const box = { id, name: display, projects: project ? [normalize(project)] : [], createdAt: new Date().toISOString() };
  saveMailbox(box);
  return box;
}

function selectMailbox(nameOrId, project) {
  const box = findMailbox(nameOrId);
  if (!box) throw new Error(`No mailbox named "${nameOrId}". List them with list_mailboxes, or create one.`);
  detachProject(project);
  const fresh = findMailbox(box.id);
  fresh.projects.push(normalize(project));
  saveMailbox(fresh);
  return fresh;
}

// Removes the folder that puts `project` in its mailbox (itself or a parent).
function leaveMailbox(project) {
  const box = mailboxFor(project);
  if (!box) return undefined;
  const p = normalize(project);
  box.projects = box.projects.filter((root) => !covers(root, p));
  saveMailbox(box);
  return box;
}

function deleteMailbox(nameOrId) {
  const box = findMailbox(nameOrId);
  if (!box) throw new Error(`No mailbox named "${nameOrId}".`);
  fs.rmSync(mailboxDir(box.id), { recursive: true, force: true });
  return box;
}

// ---------- peers and messages (scoped to one mailbox) ----------

const sub = (box, ...parts) => path.join(mailboxDir(box), ...parts);

function isActive(box, id) {
  return fs.existsSync(sub(box, 'active', id));
}

function markActive(box, id) {
  ensureDir(sub(box, 'active'));
  fs.writeFileSync(sub(box, 'active', id), '', { mode: 0o600 });
}

// Claude keeps pre-warmed spare sessions for agent view, which load the mod
// long before anyone uses them. A session only counts once it has had a prompt.
function livePeers(box, { includeIdle = false } = {}) {
  const dir = sub(box, 'peers');
  const now = Date.now();
  const peers = [];
  for (const file of jsonFiles(dir)) {
    const full = path.join(dir, file);
    const peer = readJson(full);
    let mtime = 0;
    try {
      mtime = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (!peer || !isAlive(peer.pid) || now - mtime > STALE_MS) {
      if (peer) dropPeer(box, peer);
      try {
        fs.unlinkSync(full);
      } catch {}
      continue;
    }
    peer.active = isActive(box, peer.id);
    if (peer.active || includeIdle) peers.push(peer);
  }
  return peers.sort((a, b) => a.startedAt - b.startedAt);
}

function newMessageFile(dir) {
  return path.join(ensureDir(dir), `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
}

// Keeps each file's name (its send time) so moved mail stays in order.
function moveAll(fromDir, toDir) {
  for (const name of jsonFiles(fromDir)) {
    const target = path.join(ensureDir(toDir), name);
    try {
      fs.renameSync(path.join(fromDir, name), fs.existsSync(target) ? newMessageFile(toDir) : target);
    } catch {}
  }
}

// Unread mail of a session that went away goes back to its profile's queue.
function dropPeer(box, peer) {
  moveAll(sub(box, 'inbox', peer.id), sub(box, 'pending', slug(peer.profile)));
  try {
    fs.rmSync(sub(box, 'inbox', peer.id), { recursive: true, force: true });
  } catch {}
  for (const file of [sub(box, 'active', peer.id), sub(box, 'peers', `${peer.id}.json`)]) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
}

function claimPending(box, peer) {
  moveAll(sub(box, 'pending', slug(peer.profile)), sub(box, 'inbox', peer.id));
}

function takeInbox(box, id) {
  const dir = sub(box, 'inbox', id);
  const messages = [];
  for (const name of jsonFiles(dir)) {
    const msg = readJson(path.join(dir, name));
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      continue;
    }
    if (msg) messages.push(msg);
  }
  return messages;
}

function send(box, from, to, text) {
  const target = String(to || '').trim();
  const body = String(text || '');
  if (!target) throw new Error('"to" is required: a session name from list_peers, or a profile name.');
  if (!body.trim()) throw new Error('"message" is empty.');
  if (body.length > MAX_MESSAGE_CHARS) throw new Error(`Message is too long (max ${MAX_MESSAGE_CHARS} characters).`);

  const everyone = livePeers(box, { includeIdle: true }).filter((p) => p.id !== from.id);
  const byName = everyone.filter((p) => p.id === slug(target));
  const byProfile = everyone.filter((p) => p.active && p.profile.toLowerCase() === target.toLowerCase());
  const message = {
    id: crypto.randomBytes(6).toString('hex'),
    from: { id: from.id, name: from.name, profile: from.profile, label: from.label || '' },
    to: target,
    text: body,
    sentAt: new Date().toISOString(),
  };
  const targets = byName.length ? byName : byProfile;
  if (targets.length) {
    for (const peer of targets) writeJsonAtomic(newMessageFile(sub(box, 'inbox', peer.id)), message);
    return `Delivered to ${targets.map((p) => `${p.name} (${p.profile})`).join(', ')}.`;
  }
  if (isSessionName(target)) throw new Error(`No session named "${target}" in this mailbox. Call list_peers to see who is here.`);
  writeJsonAtomic(newMessageFile(sub(box, 'pending', slug(target))), message);
  return `No active "${target}" session in this mailbox right now. Queued: the next "${target}" session here will get it.`;
}

// ---------- ops (called by the mod) ----------

// Who this session is: the Claude process that started this one.
function self(args) {
  const pid = process.ppid;
  const session = assignName(pid);
  return {
    pid,
    session,
    id: slug(session.name),
    name: session.name,
    profile: profileName(),
    project: normalize(args.project || process.cwd()),
  };
}

function peerRecord(me, box) {
  const existing = readJson(sub(box, 'peers', `${me.id}.json`)) || {};
  return {
    id: me.id,
    name: me.name,
    profile: me.profile,
    label: existing.label || '',
    project: me.project,
    pid: me.pid,
    startedAt: existing.startedAt || Date.now(),
  };
}

// Joins (or moves to, or leaves) the mailbox covering this session's folder,
// refreshes its heartbeat, and reports everything the mod draws.
function sync(args) {
  const me = self(args);
  const found = mailboxFor(me.project);
  const box = found ? found.id : null;
  if (me.session.box && me.session.box !== box) {
    dropPeer(me.session.box, { id: me.id, profile: me.profile });
  }
  if (me.session.box !== box) writeJsonAtomic(sessionFile(me.pid), { ...me.session, box });
  if (box) {
    ensureDir(sub(box, 'inbox', me.id));
    writeJsonAtomic(sub(box, 'peers', `${me.id}.json`), peerRecord(me, box));
    if (args.active && !isActive(box, me.id)) {
      markActive(box, me.id);
      claimPending(box, me);
    }
  }
  const all = box ? livePeers(box, { includeIdle: true }) : [];
  const others = all.filter((p) => p.id !== me.id);
  return {
    name: me.name,
    id: me.id,
    profile: me.profile,
    account: account(),
    mailbox: found ? { id: found.id, name: found.name, projects: found.projects } : null,
    inbox: box ? sub(box, 'inbox', me.id) : null,
    peers: others
      .filter((p) => p.active)
      .map((p) => ({ name: p.name, profile: p.profile, label: p.label, where: path.basename(p.project || ''), active: true })),
    idle: others.filter((p) => !p.active).length,
    unread: box ? jsonFiles(sub(box, 'inbox', me.id)).length : 0,
  };
}

function requireBox(me) {
  const found = mailboxFor(me.project);
  if (!found) {
    throw new Error(`${me.project} isn't in a mailbox yet. Create one with create_mailbox, or join one with select_mailbox.`);
  }
  return found;
}

const OPS = {
  sync,
  take(args) {
    const me = self(args);
    const box = requireBox(me);
    return takeInbox(box.id, me.id);
  },
  send(args) {
    const me = self(args);
    const box = requireBox(me);
    const label = (readJson(sub(box.id, 'peers', `${me.id}.json`)) || {}).label;
    return send(box.id, { ...me, label }, args.to, args.message);
  },
  label(args) {
    const me = self(args);
    const box = requireBox(me);
    const record = peerRecord(me, box.id);
    record.label = String(args.label || '').slice(0, 200);
    writeJsonAtomic(sub(box.id, 'peers', `${me.id}.json`), record);
    return record.label;
  },
  mailboxes(args) {
    const me = self(args);
    const current = mailboxFor(me.project);
    return listMailboxes().map((b) => ({
      name: b.name,
      projects: b.projects,
      active: livePeers(b.id).length,
      current: !!current && current.id === b.id,
    }));
  },
  create(args) {
    const me = self(args);
    return createMailbox(args.name, me.project).name;
  },
  select(args) {
    const me = self(args);
    return selectMailbox(args.name, me.project).name;
  },
  leave(args) {
    const me = self(args);
    const box = leaveMailbox(me.project);
    return box ? box.name : null;
  },
  bye(args) {
    const pid = process.ppid;
    const session = readJson(sessionFile(pid));
    if (session && session.box) dropPeer(session.box, { id: slug(session.name), profile: profileName() });
    try {
      fs.unlinkSync(sessionFile(pid));
    } catch {}
    return true;
  },
};

function runOp(name) {
  let args = {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (raw.trim()) args = JSON.parse(raw);
  } catch {}
  try {
    if (!OPS[name]) throw new Error(`Unknown op: ${name}`);
    process.stdout.write(JSON.stringify({ ok: true, value: OPS[name](args) }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }));
  }
}

if (require.main === module) {
  const [mode, name] = process.argv.slice(2);
  if (mode === 'op') runOp(name);
  else {
    process.stderr.write('usage: bridge.js op <sync|take|send|label|mailboxes|create|select|leave|bye>\n');
    process.exit(2);
  }
}

module.exports = {
  ROOT,
  NAMES,
  listMailboxes,
  mailboxFor,
  findMailbox,
  createMailbox,
  selectMailbox,
  leaveMailbox,
  deleteMailbox,
  livePeers,
  account,
  slug,
};
