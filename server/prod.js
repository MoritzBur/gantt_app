const { spawn } = require('child_process');
const http = require('http');
const runtimePaths = require('./runtime-paths');

runtimePaths.ensurePackagedEnvFile();
require('dotenv').config({ path: runtimePaths.ENV_PATH });

const port = Number.parseInt(process.env.PORT || '3000', 10);
const appUrl = `http://localhost:${port}`;
const shouldOpenBrowser = !process.argv.includes('--no-browser') && !process.argv.includes('--stop');

function request(method, route) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: route,
        method,
        timeout: 1200,
      },
      (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

async function isAppRunning() {
  try {
    const response = await request('GET', '/api/calendar/status');
    return response.statusCode === 200;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
}

async function stopRunningApp() {
  try {
    await request('POST', '/api/restart');
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (process.argv.includes('--stop')) {
    const stopped = await stopRunningApp();
    process.exit(stopped ? 0 : 1);
  }

  if (await isAppRunning()) {
    if (shouldOpenBrowser) openBrowser(appUrl);
    process.exit(0);
  }

  process.env.NODE_ENV = 'production';
  require('./index');

  if (shouldOpenBrowser) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await isAppRunning()) {
        openBrowser(appUrl);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
