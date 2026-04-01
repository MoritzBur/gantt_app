const { execFile } = require('child_process');
const express = require('express');
const store = require('../data-store');

const router = express.Router();
const TRACKED_FILES = ['tasks.json', 'state.json', 'notes'];

function runGit(args, callback) {
  try {
    store.ensureDataDir();
  } catch (err) {
    process.nextTick(() => callback(err));
    return;
  }
  execFile('git', args, { cwd: store.DATA_DIR }, callback);
}

function snapshotUnavailable(message, extras = {}) {
  return {
    available: extras.available ?? false,
    repo: extras.repo ?? false,
    dirty: false,
    message,
  };
}

function classifyGitFailure(err, stderr = '') {
  if (err?.code === 'ENOENT') {
    return snapshotUnavailable(
      'Git is not installed or not available on PATH. The planner still works, but snapshot history needs Git.',
      { available: false, repo: false }
    );
  }

  const output = `${stderr || ''}\n${err?.message || ''}`;
  if (/not a git repository/i.test(output)) {
    return snapshotUnavailable(
      'Snapshot history is available when the current data directory is a Git repository.',
      { available: true, repo: false }
    );
  }

  return snapshotUnavailable(
    'Git is available, but snapshot history is not ready in the current data directory.',
    { available: true, repo: false }
  );
}

function ensureGitRepo(res, callback) {
  runGit(['rev-parse', '--is-inside-work-tree'], (repoErr, stdout, stderr) => {
    if (repoErr || stdout.trim() !== 'true') {
      const status = classifyGitFailure(repoErr || new Error('Not inside a Git work tree'), stderr);
      return res.status(status.available ? 409 : 503).json({ error: status.message });
    }
    callback();
  });
}

function ensureTrackedFiles() {
  store.ensureDataDir();
  if (!require('fs').existsSync(store.FILES.tasks)) store.writeTasks(store.readTasks());
  if (!require('fs').existsSync(store.FILES.state)) store.writeUiState(store.readUiState());
}

// GET /api/git/status — { available, repo, dirty, message }
router.get('/status', (_req, res) => {
  runGit(['rev-parse', '--is-inside-work-tree'], (repoErr, stdout, stderr) => {
    if (repoErr || stdout.trim() !== 'true') {
      return res.json(classifyGitFailure(repoErr || new Error('Not inside a Git work tree'), stderr));
    }
    runGit(['status', '--porcelain', '--', ...TRACKED_FILES], (err, statusStdout) => {
      if (err) {
        return res.json({
          available: true,
          repo: true,
          dirty: false,
          message: 'Git is available, but the current snapshot status could not be read.',
        });
      }
      res.json({
        available: true,
        repo: true,
        dirty: statusStdout.trim().length > 0,
        message: null,
      });
    });
  });
});

// GET /api/git/log — [{ hash, message, date }]
router.get('/log', (_req, res) => {
  runGit(
    ['log', '--format=%h\t%s\t%aI', '-20', '--', ...TRACKED_FILES],
    (err, stdout) => {
      if (err || !stdout.trim()) return res.json([]);
      const commits = stdout.trim().split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.split('\t');
          return { hash: parts[0], message: parts[1], date: parts[2] };
        });
      res.json(commits);
    }
  );
});

// GET /api/git/show/:hash — parsed tasks/state at that commit
router.get('/show/:hash', (req, res) => {
  const { hash } = req.params;
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
    return res.status(400).json({ error: 'Invalid hash format' });
  }
  runGit(['show', `${hash}:tasks.json`], (tasksErr, tasksStdout) => {
    if (tasksErr) return res.status(404).json({ error: 'Commit or file not found' });
    runGit(['show', `${hash}:state.json`], (stateErr, stateStdout) => {
      try {
        const tasks = JSON.parse(tasksStdout);
        const state = stateErr ? store.readUiState() : JSON.parse(stateStdout);
        res.json({ tasks, state });
      } catch {
        res.status(500).json({ error: 'Could not parse snapshot files at that commit' });
      }
    });
  });
});

// POST /api/git/commit — stage data files and create a commit
router.post('/commit', (req, res) => {
  const message = (req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Commit message is required' });
  }
  ensureGitRepo(res, () => {
    ensureTrackedFiles();
    runGit(['add', ...TRACKED_FILES], (addErr, _addStdout, addStderr) => {
      if (addErr) {
        const details = classifyGitFailure(addErr, addStderr);
        return res.status(details.available ? 500 : 503).json({ error: details.message });
      }
      runGit(['commit', '-m', message], (commitErr, stdout, stderr) => {
        const output = `${stdout || ''}\n${stderr || ''}`.trim();
        if (commitErr) {
          if (commitErr.message.includes('nothing to commit') || output.includes('nothing to commit')) {
            return res.json({ ok: true, output: 'Nothing to commit.' });
          }
          return res.status(500).json({ error: output || commitErr.message });
        }
        res.json({ ok: true, output });
      });
    });
  });
});

// POST /api/git/restore — overwrite tasks/state with snapshot
router.post('/restore', (req, res) => {
  const tasks = req.body?.tasks;
  const state = req.body?.state;
  if (!tasks || (!Array.isArray(tasks.items) && !Array.isArray(tasks.phases))) {
    return res.status(400).json({ error: 'Invalid tasks payload' });
  }
  // Auto-migrate v1 snapshots
  const migratedTasks = tasks.version === 2 ? tasks : store.migrateV1toV2(tasks);
  try {
    store.writeTasks(migratedTasks);
    if (state) store.writeUiState(state);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
