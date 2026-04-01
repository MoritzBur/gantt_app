const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR_NAME = 'GanttApp';
const isPackaged = Boolean(process.pkg);
const repoRoot = path.resolve(__dirname, '..');
const executableDir = isPackaged ? path.dirname(process.execPath) : repoRoot;
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const appRoot = path.join(localAppData, APP_DIR_NAME);
const configDir = path.join(appRoot, 'config');
const dataDir = path.join(appRoot, 'data');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function newSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function resolveEnvPath() {
  const candidates = [];

  if (process.env.GANTT_ENV_PATH) candidates.push(path.resolve(process.env.GANTT_ENV_PATH));
  if (isPackaged) candidates.push(path.join(configDir, '.env'));
  candidates.push(path.join(executableDir, '.env'));
  candidates.push(path.join(repoRoot, '.env'));

  const existing = candidates.find(candidate => fs.existsSync(candidate));
  if (existing) return existing;

  return isPackaged ? path.join(configDir, '.env') : path.join(repoRoot, '.env');
}

function ensurePackagedEnvFile() {
  if (!isPackaged) return;

  const envPath = resolveEnvPath();
  ensureDir(path.dirname(envPath));

  if (fs.existsSync(envPath)) return;

  const content = [
    'CALENDAR_BACKEND=ical',
    'ICAL_URLS=',
    'GOOGLE_CLIENT_ID=',
    'GOOGLE_CLIENT_SECRET=',
    'GOOGLE_CALENDAR_IDS=',
    'PORT=3000',
    `GANTT_DATA_DIR=${dataDir}`,
    `SESSION_SECRET=${newSecret()}`,
    '',
  ].join('\n');

  fs.writeFileSync(envPath, content, 'utf8');
}

function resolveDataDir() {
  if (process.env.GANTT_DATA_DIR) {
    return path.resolve(process.env.GANTT_DATA_DIR);
  }

  return isPackaged ? dataDir : path.join(repoRoot, 'data');
}

module.exports = {
  APP_DIR_NAME,
  USER_APP_ROOT: appRoot,
  USER_CONFIG_DIR: configDir,
  USER_DATA_DIR: dataDir,
  REPO_ROOT: repoRoot,
  EXECUTABLE_DIR: executableDir,
  ENV_PATH: resolveEnvPath(),
  DIST_DIR: path.join(__dirname, '../client/dist'),
  isPackaged,
  ensurePackagedEnvFile,
  ensureDir,
  resolveDataDir,
};
