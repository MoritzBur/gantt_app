const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const store = require('../data-store');

function parseDate(str) {
  const [year, month, day] = String(str).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDays(start, end) {
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function parseMarkdownList(markdown) {
  return String(markdown || '')
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*[-*+](?:\s+(.*))?$/);
      return match ? (match[1] || '').trim() : '';
    })
    .filter((name) => name && !/^[-*+\s]+$/.test(name));
}

function buildEvenlyDistributedSubtasks(node, names) {
  const start = parseDate(node.start);
  const end = parseDate(node.end || node.start);
  const totalDays = Math.max(diffDays(start, end) + 1, 1);
  const taskCount = names.length;
  const segmentDays = Math.max(Math.ceil(totalDays / taskCount), 1);
  const maxStartOffset = Math.max(totalDays - segmentDays, 0);

  return names.map((name, index) => {
    const startOffset = taskCount === 1
      ? 0
      : Math.round((index * maxStartOffset) / (taskCount - 1));
    const taskStart = addDays(start, startOffset);
    const taskEnd = addDays(taskStart, segmentDays - 1);

    return {
      id: crypto.randomUUID(),
      type: 'task',
      name,
      start: formatDate(taskStart),
      end: formatDate(taskEnd > end ? end : taskEnd),
      done: false,
      notes: '',
      milestone: false,
      children: [],
    };
  });
}

function shiftNodeTree(node, daysDelta) {
  if (node.start) {
    node.start = formatDate(addDays(parseDate(node.start), daysDelta));
  }
  if (node.end) {
    node.end = formatDate(addDays(parseDate(node.end || node.start), daysDelta));
  }
  (node.children || []).forEach((child) => shiftNodeTree(child, daysDelta));
}

function readData() {
  return store.readTasks();
}

function writeData(data) {
  store.writeTasks(data);
}

// GET /api/tasks — return full tasks.json (v2 format)
router.get('/', (req, res) => {
  try {
    const data = readData();
    res.json(data);
  } catch (err) {
    console.error('Failed to read tasks:', err);
    res.status(500).json({ error: 'Failed to read tasks' });
  }
});

// PUT /api/tasks — replace full tasks.json
router.put('/', (req, res) => {
  try {
    const nextData = req.body;
    if (!nextData || !Array.isArray(nextData.items)) {
      return res.status(400).json({ error: 'Invalid tasks payload (expected { version: 2, items: [...] })' });
    }
    nextData.version = 2;
    writeData(nextData);
    res.json(nextData);
  } catch (err) {
    console.error('Failed to write tasks:', err);
    res.status(500).json({ error: 'Failed to write tasks' });
  }
});

// POST /api/tasks/node — create a new node (group or task) under a parent
// body: { parentId: null | string, type: 'group' | 'task', name, color, start, end, ... }
router.post('/node', (req, res) => {
  try {
    const data = readData();
    const { parentId, type, name, color, start, end, prefix } = req.body;

    const today = new Date().toISOString().slice(0, 10);
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Check depth limit
    if (parentId) {
      const depth = store.getNodeDepth(data.items, parentId);
      if (depth === -1) return res.status(404).json({ error: 'Parent not found' });
      if (depth + 1 >= store.MAX_DEPTH) {
        return res.status(400).json({ error: `Maximum nesting depth of ${store.MAX_DEPTH} reached` });
      }
    }

    const node = {
      id: crypto.randomUUID(),
      name: name || (type === 'group' ? 'New Group' : 'New Task'),
      type: type || 'task',
      start: start || today,
      end: end || nextMonth,
      children: [],
    };

    if (node.type === 'group') {
      node.color = color || '#4A90D9';
      node.prefix = prefix !== undefined ? prefix : 'WP';
    } else {
      node.done = false;
      node.notes = '';
      node.milestone = false;
    }

    if (parentId) {
      const result = store.findNode(data.items, parentId);
      if (!result) return res.status(404).json({ error: 'Parent not found' });
      if (result.node.type !== 'group') {
        return res.status(400).json({ error: 'Cannot add children to a task node' });
      }
      if (node.type === 'task') {
        node.start = start || result.node.start || today;
        node.end = end || result.node.end || nextMonth;
      }
      result.node.children.push(node);
      store.recomputeAncestorBounds(data, node.id);
    } else {
      data.items.push(node);
    }

    writeData(data);
    res.status(201).json(node);
  } catch (err) {
    console.error('Failed to create node:', err);
    res.status(500).json({ error: 'Failed to create node' });
  }
});

// PUT /api/tasks/node/:id — update a node
router.put('/node/:id', (req, res) => {
  try {
    const data = readData();
    const result = store.findNode(data.items, req.params.id);
    if (!result) return res.status(404).json({ error: 'Node not found' });

    const node = result.node;
    const updates = req.body;
    const prevStart = node.start;
    const prevEnd = node.end;

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id' || key === 'children' || key === 'type') continue;
      node[key] = value;
    }

    if (
      node.type === 'group' &&
      node.children?.length &&
      updates.start !== undefined &&
      updates.end !== undefined &&
      prevStart &&
      prevEnd
    ) {
      const startDelta = diffDays(parseDate(prevStart), parseDate(updates.start));
      const endDelta = diffDays(parseDate(prevEnd), parseDate(updates.end));
      if (startDelta === endDelta && startDelta !== 0) {
        node.children.forEach((child) => shiftNodeTree(child, startDelta));
      }
    }

    if (updates.start !== undefined || updates.end !== undefined) {
      store.recomputeAncestorBounds(data, node.id);
    }

    writeData(data);
    res.json(node);
  } catch (err) {
    console.error('Failed to update node:', err);
    res.status(500).json({ error: 'Failed to update node' });
  }
});

// DELETE /api/tasks/node/:id — delete a node and all its children
router.delete('/node/:id', (req, res) => {
  try {
    const data = readData();
    const result = store.findNode(data.items, req.params.id);
    if (!result) return res.status(404).json({ error: 'Node not found' });

    const parentId = result.parent?.id;
    result.siblings.splice(result.index, 1);

    if (parentId) {
      store.recomputeAncestorBounds(data, parentId);
    }

    writeData(data);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete node:', err);
    res.status(500).json({ error: 'Failed to delete node' });
  }
});

// POST /api/tasks/node/:id/split — convert a task into a group, preserving original as first child
router.post('/node/:id/split', (req, res) => {
  try {
    const data = readData();
    const result = store.findNode(data.items, req.params.id);
    if (!result) return res.status(404).json({ error: 'Node not found' });

    const node = result.node;
    if (node.type !== 'task') {
      return res.status(400).json({ error: 'Only tasks can be split' });
    }

    // Check depth: the new children will be one level deeper
    const depth = store.getNodeDepth(data.items, node.id);
    if (depth + 1 >= store.MAX_DEPTH) {
      return res.status(400).json({ error: `Maximum nesting depth of ${store.MAX_DEPTH} reached` });
    }

    // Create child task with original task data
    const childTask = {
      id: crypto.randomUUID(),
      type: 'task',
      name: node.name,
      start: node.start,
      end: node.end,
      done: node.done || false,
      notes: node.notes || '',
      milestone: node.milestone || false,
      children: [],
    };

    // Inherit color from parent group (if any)
    const parentColor = result.parent?.color || '#4A90D9';

    // Convert node to group
    node.type = 'group';
    node.color = parentColor;
    node.prefix = result.parent?.prefix !== undefined ? result.parent.prefix : 'WP';
    node.children = [childTask];

    // Remove task-specific fields from the group
    delete node.done;
    delete node.notes;
    delete node.milestone;

    writeData(data);
    res.json(node);
  } catch (err) {
    console.error('Failed to split node:', err);
    res.status(500).json({ error: 'Failed to split node' });
  }
});

// POST /api/tasks/node/:id/batch-subtasks — create child tasks from a markdown list
// body: { markdown: "- First\n- Second" }
router.post('/node/:id/batch-subtasks', (req, res) => {
  try {
    const data = readData();
    const result = store.findNode(data.items, req.params.id);
    if (!result) return res.status(404).json({ error: 'Node not found' });

    const node = result.node;
    if (node.type === 'task' && node.milestone) {
      return res.status(400).json({ error: 'Milestones cannot be batch-converted into subtasks' });
    }

    const depth = store.getNodeDepth(data.items, node.id);
    if (depth + 1 >= store.MAX_DEPTH) {
      return res.status(400).json({ error: `Maximum nesting depth of ${store.MAX_DEPTH} reached` });
    }

    const names = parseMarkdownList(req.body?.markdown);
    if (names.length === 0) {
      return res.status(400).json({ error: 'No subtask names found in markdown list' });
    }

    const childTasks = buildEvenlyDistributedSubtasks(node, names);
    if (node.type === 'task') {
      const parentColor = result.parent?.color || '#4A90D9';
      node.type = 'group';
      node.color = parentColor;
      node.prefix = result.parent?.prefix !== undefined ? result.parent.prefix : 'WP';
      node.children = childTasks;
      delete node.done;
      delete node.notes;
      delete node.milestone;
    } else if (node.type === 'group') {
      node.children = [...(node.children || []), ...childTasks];
    } else {
      return res.status(400).json({ error: 'Unsupported node type for batch subtasks' });
    }

    writeData(data);
    res.json(node);
  } catch (err) {
    console.error('Failed to batch-create subtasks:', err);
    res.status(500).json({ error: 'Failed to batch-create subtasks' });
  }
});

// PUT /api/tasks/reorder — reorder children within a parent
// body: { parentId: null | string, childOrder: [id, id, ...] }
router.put('/reorder', (req, res) => {
  try {
    const data = readData();
    const { parentId, childOrder } = req.body;

    if (!Array.isArray(childOrder)) {
      return res.status(400).json({ error: 'childOrder must be an array' });
    }

    let siblings;
    if (parentId) {
      const result = store.findNode(data.items, parentId);
      if (!result) return res.status(404).json({ error: 'Parent not found' });
      siblings = result.node.children;
    } else {
      siblings = data.items;
    }

    const map = Object.fromEntries(siblings.map(n => [n.id, n]));
    const reordered = childOrder.map(id => map[id]).filter(Boolean);
    const orderedSet = new Set(childOrder);
    for (const item of siblings) {
      if (!orderedSet.has(item.id)) reordered.push(item);
    }

    if (parentId) {
      const result = store.findNode(data.items, parentId);
      result.node.children = reordered;
    } else {
      data.items = reordered;
    }

    writeData(data);
    res.json(data);
  } catch (err) {
    console.error('Failed to reorder:', err);
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

module.exports = router;
