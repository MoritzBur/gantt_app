const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const store = require('../data-store');

function readData() {
  return store.readTasks();
}

function writeData(data) {
  store.writeTasks(data);
}

// GET /api/tasks — return full tasks.json
router.get('/', (req, res) => {
  try {
    const data = readData();
    res.json(data);
  } catch (err) {
    console.error('Failed to read tasks:', err);
    res.status(500).json({ error: 'Failed to read tasks' });
  }
});

// POST /api/tasks/phase — create new phase
router.post('/phase', (req, res) => {
  try {
    const data = readData();
    const { name, color, start, end } = req.body;
    const phase = {
      id: crypto.randomUUID(),
      name: name || 'New Phase',
      color: color || '#4A90D9',
      start: start || new Date().toISOString().slice(0, 10),
      end: end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      tasks: [],
    };
    data.phases.push(phase);
    writeData(data);
    res.status(201).json(phase);
  } catch (err) {
    console.error('Failed to create phase:', err);
    res.status(500).json({ error: 'Failed to create phase' });
  }
});

// PUT /api/tasks/phase/:id — update phase name/color/dates
router.put('/phase/:id', (req, res) => {
  try {
    const data = readData();
    const phase = data.phases.find(p => p.id === req.params.id);
    if (!phase) return res.status(404).json({ error: 'Phase not found' });

    const { name, color, start, end, prefix } = req.body;
    if (name !== undefined) phase.name = name;
    if (color !== undefined) phase.color = color;
    if (start !== undefined) phase.start = start;
    if (end !== undefined) phase.end = end;
    if (prefix !== undefined) phase.prefix = prefix;

    writeData(data);
    res.json(phase);
  } catch (err) {
    console.error('Failed to update phase:', err);
    res.status(500).json({ error: 'Failed to update phase' });
  }
});

// DELETE /api/tasks/phase/:id — delete phase and all its tasks
router.delete('/phase/:id', (req, res) => {
  try {
    const data = readData();
    const idx = data.phases.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Phase not found' });

    data.phases.splice(idx, 1);
    writeData(data);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete phase:', err);
    res.status(500).json({ error: 'Failed to delete phase' });
  }
});

// POST /api/tasks/phase/:phaseId/task — create new task in a phase
router.post('/phase/:phaseId/task', (req, res) => {
  try {
    const data = readData();
    const phase = data.phases.find(p => p.id === req.params.phaseId);
    if (!phase) return res.status(404).json({ error: 'Phase not found' });

    const { name, start, end, notes } = req.body;
    const task = {
      id: crypto.randomUUID(),
      name: name || 'New Task',
      start: start || phase.start,
      end: end || phase.end,
      done: false,
      notes: notes || '',
    };
    phase.tasks.push(task);
    writeData(data);
    res.status(201).json(task);
  } catch (err) {
    console.error('Failed to create task:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /api/tasks/task/:id — update task
router.put('/task/:id', (req, res) => {
  try {
    const data = readData();
    let foundTask = null;
    for (const phase of data.phases) {
      const task = phase.tasks.find(t => t.id === req.params.id);
      if (task) { foundTask = task; break; }
    }
    if (!foundTask) return res.status(404).json({ error: 'Task not found' });

    const { name, start, end, done, notes, milestone } = req.body;
    if (name !== undefined) foundTask.name = name;
    if (start !== undefined) foundTask.start = start;
    if (end !== undefined) foundTask.end = end;
    if (done !== undefined) foundTask.done = done;
    if (notes !== undefined) foundTask.notes = notes;
    if (milestone !== undefined) foundTask.milestone = milestone;

    writeData(data);
    res.json(foundTask);
  } catch (err) {
    console.error('Failed to update task:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// PUT /api/tasks/reorder — reorder phases and/or tasks within phases
router.put('/reorder', (req, res) => {
  try {
    const data = readData();
    const { phaseOrder, taskOrders } = req.body;

    if (phaseOrder && Array.isArray(phaseOrder)) {
      const phaseMap = Object.fromEntries(data.phases.map(p => [p.id, p]));
      data.phases = phaseOrder.map(id => phaseMap[id]).filter(Boolean);
    }

    if (taskOrders && typeof taskOrders === 'object') {
      for (const [phaseId, taskOrder] of Object.entries(taskOrders)) {
        const phase = data.phases.find(p => p.id === phaseId);
        if (phase && Array.isArray(taskOrder)) {
          const taskMap = Object.fromEntries(phase.tasks.map(t => [t.id, t]));
          phase.tasks = taskOrder.map(id => taskMap[id]).filter(Boolean);
        }
      }
    }

    writeData(data);
    res.json(data);
  } catch (err) {
    console.error('Failed to reorder:', err);
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

// DELETE /api/tasks/task/:id — delete task
router.delete('/task/:id', (req, res) => {
  try {
    const data = readData();
    let deleted = false;
    for (const phase of data.phases) {
      const idx = phase.tasks.findIndex(t => t.id === req.params.id);
      if (idx !== -1) {
        phase.tasks.splice(idx, 1);
        deleted = true;
        break;
      }
    }
    if (!deleted) return res.status(404).json({ error: 'Task not found' });

    writeData(data);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete task:', err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

module.exports = router;
