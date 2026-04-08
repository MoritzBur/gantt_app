const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR_NAME = 'ActualPlan';
const isPackaged = Boolean(process.pkg);
const repoRoot = path.resolve(__dirname, '..');
const isInstalledLinuxApp = process.platform === 'linux' && repoRoot === '/opt/actual-plan';
const isManagedInstall = isPackaged || isInstalledLinuxApp;
const executableDir = isPackaged ? path.dirname(process.execPath) : repoRoot;
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');

function resolveManagedPaths() {
  if (isInstalledLinuxApp) {
    return {
      appRoot: path.join(xdgDataHome, 'actual-plan'),
      configDir: path.join(xdgConfigHome, 'actual-plan'),
      dataDir: path.resolve(process.env.ACTUAL_PLAN_DEFAULT_DATA_DIR || path.join(xdgDataHome, 'actual-plan', 'data')),
    };
  }

  const appRoot = path.join(localAppData, APP_DIR_NAME);
  return {
    appRoot,
    configDir: path.join(appRoot, 'config'),
    dataDir: path.join(appRoot, 'data'),
  };
}

const managedPaths = resolveManagedPaths();
const appRoot = managedPaths.appRoot;
const configDir = managedPaths.configDir;
const dataDir = managedPaths.dataDir;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function newSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function resolveEnvPath() {
  const candidates = [];

  if (process.env.GANTT_ENV_PATH) candidates.push(path.resolve(process.env.GANTT_ENV_PATH));
  if (isManagedInstall) candidates.push(path.join(configDir, '.env'));
  candidates.push(path.join(executableDir, '.env'));
  candidates.push(path.join(repoRoot, '.env'));

  const existing = candidates.find(candidate => fs.existsSync(candidate));
  if (existing) return existing;

  return isManagedInstall ? path.join(configDir, '.env') : path.join(repoRoot, '.env');
}

function ensurePackagedEnvFile() {
  if (!isManagedInstall) return;

  const envPath = resolveEnvPath();
  ensureDir(path.dirname(envPath));

  if (fs.existsSync(envPath)) return;

  const content = [
    'CALENDAR_BACKEND=ical',
    'ICAL_URLS=',
    'GOOGLE_CLIENT_ID=',
    'GOOGLE_CLIENT_SECRET=',
    'GOOGLE_CALENDAR_IDS=',
    `PORT=${process.env.ACTUAL_PLAN_DEFAULT_PORT || '3000'}`,
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

  return isManagedInstall ? dataDir : path.join(repoRoot, 'data');
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
  isInstalledLinuxApp,
  isManagedInstall,
  ensurePackagedEnvFile,
  ensureDir,
  resolveDataDir,
};
