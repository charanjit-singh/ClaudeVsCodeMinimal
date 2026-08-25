const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(os.homedir(), '.claude-vscode-extension-data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function defaultState() {
  return {
    version: 1,
    // groupId -> custom display name (groupId is either a project's true abs path, or a "custom:<id>" id)
    groupNames: {},
    // groupId -> { name } for groups not backed by a real project folder
    customGroups: {},
    // sessionId -> { name?, groupId?, color?, avatar? } wrapper overrides
    agents: {},
    // groupId -> colorId (see src/colors.js)
    groupColors: {},
    // groupId -> avatar filename under ~/.claude-vscode-extension-data/avatars/
    groupAvatars: {},
  };
}

function load() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed, {
      groupNames: Object.assign({}, parsed.groupNames),
      customGroups: Object.assign({}, parsed.customGroups),
      agents: Object.assign({}, parsed.agents),
      groupColors: Object.assign({}, parsed.groupColors),
      groupAvatars: Object.assign({}, parsed.groupAvatars),
    });
  } catch {
    return defaultState();
  }
}

function save(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

class StateStore {
  constructor() {
    this.state = load();
  }

  reload() {
    this.state = load();
  }

  persist() {
    save(this.state);
  }

  groupName(groupId, fallback) {
    return this.state.groupNames[groupId] || fallback;
  }

  setGroupName(groupId, name) {
    if (name) {
      this.state.groupNames[groupId] = name;
    } else {
      delete this.state.groupNames[groupId];
    }
    this.persist();
  }

  createCustomGroup(name) {
    const groupId = 'custom:' + crypto.randomUUID();
    this.state.customGroups[groupId] = { name };
    this.state.groupNames[groupId] = name;
    this.persist();
    return groupId;
  }

  customGroupIds() {
    return Object.keys(this.state.customGroups);
  }

  agentName(sessionId, fallback) {
    const entry = this.state.agents[sessionId];
    return (entry && entry.name) || fallback;
  }

  setAgentName(sessionId, name) {
    const entry = this.state.agents[sessionId] || {};
    if (name) {
      entry.name = name;
    } else {
      delete entry.name;
    }
    this.state.agents[sessionId] = entry;
    this.persist();
  }

  removeAgent(sessionId) {
    if (this.state.agents[sessionId]) {
      delete this.state.agents[sessionId];
      this.persist();
    }
  }

  agentGroupOverride(sessionId) {
    const entry = this.state.agents[sessionId];
    return entry && entry.groupId;
  }

  setAgentGroupOverride(sessionId, groupId) {
    const entry = this.state.agents[sessionId] || {};
    if (groupId) {
      entry.groupId = groupId;
    } else {
      delete entry.groupId;
    }
    this.state.agents[sessionId] = entry;
    this.persist();
  }

  agentColor(sessionId) {
    const entry = this.state.agents[sessionId];
    return entry && entry.color;
  }

  setAgentColor(sessionId, colorId) {
    const entry = this.state.agents[sessionId] || {};
    if (colorId) {
      entry.color = colorId;
    } else {
      delete entry.color;
    }
    this.state.agents[sessionId] = entry;
    this.persist();
  }

  agentAvatar(sessionId) {
    const entry = this.state.agents[sessionId];
    return entry && entry.avatar;
  }

  setAgentAvatar(sessionId, filename) {
    const entry = this.state.agents[sessionId] || {};
    if (filename) {
      entry.avatar = filename;
    } else {
      delete entry.avatar;
    }
    this.state.agents[sessionId] = entry;
    this.persist();
  }

  groupColor(groupId) {
    return this.state.groupColors[groupId];
  }

  setGroupColor(groupId, colorId) {
    if (colorId) {
      this.state.groupColors[groupId] = colorId;
    } else {
      delete this.state.groupColors[groupId];
    }
    this.persist();
  }

  groupAvatar(groupId) {
    return this.state.groupAvatars[groupId];
  }

  setGroupAvatar(groupId, filename) {
    if (filename) {
      this.state.groupAvatars[groupId] = filename;
    } else {
      delete this.state.groupAvatars[groupId];
    }
    this.persist();
  }
}

module.exports = { StateStore, STATE_FILE, DATA_DIR };
