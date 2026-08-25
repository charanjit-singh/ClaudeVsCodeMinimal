// Read-only access to Claude Code's on-disk state under ~/.claude.
// This module NEVER writes anything under ~/.claude.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const JOBS_DIR = path.join(CLAUDE_DIR, 'jobs');

// sessionId -> { mtimeMs, title, cwd }. Title lines repeat throughout a
// transcript (re-emitted after every turn), so a full read is needed to find
// the LAST occurrence — cache by mtime so unchanged files are read once.
const metaCache = new Map();

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listProjectDirs() {
  try {
    return fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(PROJECTS_DIR, d.name));
  } catch {
    return [];
  }
}

function extractSessionMeta(filePath, sessionId) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  const cached = metaCache.get(sessionId);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached;
  }

  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    // fall through with empty content
  }

  let cwd;
  let customTitle;
  let aiTitle;
  let agentName;

  for (const line of raw.split('\n')) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd;
    if (obj.type === 'custom-title' && obj.customTitle) customTitle = obj.customTitle;
    else if (obj.type === 'ai-title' && obj.aiTitle) aiTitle = obj.aiTitle;
    else if (obj.type === 'agent-name' && obj.agentName) agentName = obj.agentName;
  }

  const title = customTitle || aiTitle || agentName || sessionId.slice(0, 8);
  const result = { mtimeMs: stat.mtimeMs, title, cwd, lastActivity: stat.mtimeMs };
  metaCache.set(sessionId, result);
  return result;
}

function countSubagents(projectDir, sessionId) {
  const subDir = path.join(projectDir, sessionId, 'subagents');
  try {
    return fs.readdirSync(subDir).filter((f) => f.endsWith('.meta.json')).length;
  } catch {
    return 0;
  }
}

// ~/.claude/sessions/<pid>.json — live process registry, one file per running `claude`.
function listLiveSessions() {
  const map = new Map();
  let files;
  try {
    files = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return map;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const data = readJsonSafe(path.join(SESSIONS_DIR, f));
    if (data && data.sessionId) {
      map.set(data.sessionId, data);
    }
  }
  return map;
}

// ~/.claude/jobs/<jobId>/state.json — richer live detail (state, tempo, detail, respawnFlags).
// The directory name IS the short id `claude attach <id>` / `claude stop <id>`
// expect — a background (daemon-managed) session always has one of these;
// a plain interactive session (attached directly to its own terminal, no
// daemon involved) never does. That distinction is what tells us whether
// "take over" is even possible for a session we can't find a terminal for.
function listJobStates() {
  const map = new Map();
  let dirs;
  try {
    dirs = fs.readdirSync(JOBS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return map;
  }
  for (const d of dirs) {
    const data = readJsonSafe(path.join(JOBS_DIR, d.name, 'state.json'));
    if (data && data.sessionId) {
      map.set(data.sessionId, { ...data, jobId: d.name });
    }
  }
  return map;
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function deriveStatus(liveEntry, jobState) {
  if (jobState) {
    if (jobState.state === 'working') return 'working';
    if (jobState.state === 'blocked') return 'waiting';
    if (jobState.state === 'done') return 'done';
  }
  if (liveEntry) {
    if (liveEntry.status === 'busy') return 'working';
    if (liveEntry.status === 'waiting') return 'waiting';
    if (liveEntry.status === 'idle') return 'done';
  }
  return 'working';
}

// Returns a flat, normalized list of every known session — live and historical.
function listSessions() {
  const liveSessions = listLiveSessions();
  const jobStates = listJobStates();
  const sessions = [];

  for (const projectDir of listProjectDirs()) {
    let entries;
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const sessionId = entry.name.slice(0, -'.jsonl'.length);
      const filePath = path.join(projectDir, entry.name);
      const meta = extractSessionMeta(filePath, sessionId);
      if (!meta) continue;

      const liveEntry = liveSessions.get(sessionId);
      const jobState = jobStates.get(sessionId);
      const live = !!liveEntry && isPidAlive(liveEntry.pid);
      const status = live ? deriveStatus(liveEntry, jobState) : 'idle';

      // `jobState.respawnFlags` is how the CLI's own daemon re-spawns a
      // BACKGROUND job internally — it can carry undocumented/internal flags
      // (e.g. `--reply-on-resume`, not in `claude --help`) that are unsafe to
      // forward into a plain interactive terminal. Stick to the documented,
      // always-safe form. `resumeSessionId` (not `sessionId`) is the id to
      // pass — they differ for a forked session.
      const resumeArgv = ['--resume', (jobState && jobState.resumeSessionId) || sessionId];

      sessions.push({
        sessionId,
        projectDir, // the actual on-disk (slugged) directory — needed to delete files; never un-slug cwd instead
        cwd: meta.cwd || (liveEntry && liveEntry.cwd) || (jobState && jobState.cwd),
        title: (live && liveEntry && liveEntry.name) || meta.title,
        status,
        detail: jobState && jobState.detail,
        live,
        pid: liveEntry && liveEntry.pid,
        jobId: jobState && jobState.jobId,
        lastActivity: meta.lastActivity,
        subagentCount: countSubagents(projectDir, sessionId),
        resumeArgv,
      });
    }
  }

  sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  return sessions;
}

// Permanently deletes a historical session's transcript + subagent sidecar
// directory. Caller is responsible for confirming with the user and for
// making sure the session isn't live before calling this.
function deleteSession(session) {
  if (!session || !session.projectDir || !session.sessionId) return;
  const filePath = path.join(session.projectDir, session.sessionId + '.jsonl');
  const sidecarDir = path.join(session.projectDir, session.sessionId);
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // best-effort
  }
  try {
    fs.rmSync(sidecarDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  metaCache.delete(session.sessionId);
}

module.exports = {
  listSessions,
  deleteSession,
  isPidAlive,
  CLAUDE_DIR,
  PROJECTS_DIR,
  SESSIONS_DIR,
  JOBS_DIR,
};
