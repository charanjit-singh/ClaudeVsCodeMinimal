const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./state');

const AVATAR_DIR = path.join(DATA_DIR, 'avatars');

function safeFileBase(id) {
  return String(id).replace(/[^A-Za-z0-9_-]/g, '_');
}

function avatarPath(filename) {
  return filename ? path.join(AVATAR_DIR, filename) : undefined;
}

// Copies the user-picked image into our own data dir rather than referencing
// it in place, so it survives the source file being moved/deleted. A fresh
// timestamped filename per upload (rather than overwriting) sidesteps any
// icon caching by URI in VS Code's UI layer.
function saveAvatar(id, sourcePath, previousFilename) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  if (previousFilename) deleteAvatar(previousFilename);
  const ext = path.extname(sourcePath).toLowerCase() || '.png';
  const filename = `${safeFileBase(id)}-${Date.now()}${ext}`;
  fs.copyFileSync(sourcePath, avatarPath(filename));
  return filename;
}

function deleteAvatar(filename) {
  if (!filename) return;
  try {
    fs.rmSync(avatarPath(filename), { force: true });
  } catch {
    // best-effort
  }
}

module.exports = { avatarPath, saveAvatar, deleteAvatar, AVATAR_DIR };
