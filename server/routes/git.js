const { execFile } = require('child_process');
const express = require('express');
const store = require('../data-store');

const router = express.Router();
const DATA_ROOT = store.DATA_DIR;
const TASKS_FILE = store.FILES.tasks;
const STATE_FILE = store.FILES.state;
const TRACKED_FILES = ['tasks.json', 'state.json'];

function runGit(args, callback) {
  execFile('git', args, { cwd: DATA_ROOT }, callback);
}

function ensureTrackedFiles() {
  store.ensureDataDir();
  if (!require('fs').existsSync(TASKS_FILE)) store.writeTasks(store.readTasks());
  if (!require('fs').existsSync(STATE_FILE)) store.writeUiState(store.readUiState());
}

// GET /api/git/status — { dirty: bool, repo: bool }
router.get('/status', (_req, res) => {
  runGit(['rev-parse', '--is-inside-work-tree'], (repoErr) => {
    if (repoErr) return res.json({ dirty: false, repo: false });
    runGit(['status', '--porcelain', '--', ...TRACKED_FILES], (err, stdout) => {
      if (err) return res.json({ dirty: false, repo: true });
      res.json({ dirty: stdout.trim().length > 0, repo: true });
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
  ensureTrackedFiles();
  runGit(['add', ...TRACKED_FILES], (addErr) => {
    if (addErr) return res.status(500).json({ error: addErr.message });
    runGit(['commit', '-m', message], (commitErr, stdout, stderr) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      if (commitErr) {
        if (commitErr.message.includes('nothing to commit') || output.includes('nothing to commit')) {
          return res.json({ ok: true, output: 'Nothing to commit.' });
        }
        return res.status(500).json({ error: commitErr.message });
      }
      res.json({ ok: true, output });
    });
  });
});

// POST /api/git/restore — overwrite tasks/state with snapshot
router.post('/restore', (req, res) => {
  const tasks = req.body?.tasks;
  const state = req.body?.state;
  if (!tasks || !Array.isArray(tasks.phases)) {
    return res.status(400).json({ error: 'Invalid tasks payload: expected { tasks: { phases: [...] } }' });
  }
  try {
    store.writeTasks(tasks);
    if (state) store.writeUiState(state);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
