const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const express = require('express');

const router = express.Router();
const ROOT = path.join(__dirname, '../../');
const DATA_FILE = path.join(ROOT, 'data/tasks.json');

// GET /api/git/status — { dirty: bool }
router.get('/status', (_req, res) => {
  execFile('git', ['status', '--porcelain', 'data/tasks.json'], { cwd: ROOT }, (err, stdout) => {
    if (err) return res.json({ dirty: false });
    res.json({ dirty: stdout.trim().length > 0 });
  });
});

// GET /api/git/log — [{ hash, message, date }]
router.get('/log', (_req, res) => {
  execFile(
    'git',
    ['log', '--format=%h\t%s\t%aI', '-20', '--', 'data/tasks.json'],
    { cwd: ROOT },
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

// GET /api/git/show/:hash — parsed tasks.json at that commit
router.get('/show/:hash', (req, res) => {
  const { hash } = req.params;
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
    return res.status(400).json({ error: 'Invalid hash format' });
  }
  execFile(
    'git',
    ['show', `${hash}:data/tasks.json`],
    { cwd: ROOT },
    (err, stdout) => {
      if (err) return res.status(404).json({ error: 'Commit or file not found' });
      try {
        res.json(JSON.parse(stdout));
      } catch {
        res.status(500).json({ error: 'Could not parse tasks.json at that commit' });
      }
    }
  );
});

// POST /api/git/commit — stage data/tasks.json and create a commit
router.post('/commit', (req, res) => {
  const message = (req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Commit message is required' });
  }
  execFile('git', ['add', 'data/tasks.json'], { cwd: ROOT }, (addErr) => {
    if (addErr) return res.status(500).json({ error: addErr.message });
    execFile('git', ['commit', '-m', message], { cwd: ROOT }, (commitErr, stdout) => {
      if (commitErr) {
        // "nothing to commit" is not really an error
        if (commitErr.message.includes('nothing to commit') || stdout.includes('nothing to commit')) {
          return res.json({ ok: true, output: 'Nothing to commit.' });
        }
        return res.status(500).json({ error: commitErr.message });
      }
      res.json({ ok: true, output: stdout.trim() });
    });
  });
});

// POST /api/git/restore — overwrite data/tasks.json with the provided snapshot
router.post('/restore', (req, res) => {
  const data = req.body;
  if (!data || !Array.isArray(data.phases)) {
    return res.status(400).json({ error: 'Invalid data: expected { phases: [...] }' });
  }
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
