const vscode = require('vscode');

// Only verified-present theme color ids (checked against VS Code 1.134's
// color registry) — an unknown ThemeColor id fails silently (no error, just
// no color), so it's easy to ship a palette entry that quietly does nothing.
const PALETTE = [
  { id: 'red', themeColorId: 'charts.red' },
  { id: 'orange', themeColorId: 'charts.orange' },
  { id: 'yellow', themeColorId: 'charts.yellow' },
  { id: 'green', themeColorId: 'charts.green' },
  { id: 'blue', themeColorId: 'charts.blue' },
  { id: 'purple', themeColorId: 'charts.purple' },
  { id: 'pink', themeColorId: 'terminal.ansiMagenta' },
  { id: 'cyan', themeColorId: 'terminal.ansiCyan' },
];

function themeColorFor(colorId) {
  const entry = PALETTE.find((c) => c.id === colorId);
  return entry ? new vscode.ThemeColor(entry.themeColorId) : undefined;
}

function label(colorId) {
  return colorId.charAt(0).toUpperCase() + colorId.slice(1);
}

module.exports = { PALETTE, themeColorFor, label };
