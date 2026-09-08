const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const TASKS = require('./tasks');

const app = express();
app.use(cors());
app.use(express.json());

// ---- Config (override with environment variables in production) ----
const PORT = process.env.PORT || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bappa2026';
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-secret';
const VALID = ['todo', 'progress', 'done'];

// ---- File-based storage (no database needed) ----
const DATA_DIR = path.join(__dirname, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'board.json');

function loadBoard() {
  try {
    const b = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'));
    return { status: b.status || {}, comments: b.comments || {} };
  } catch {
    return { status: {}, comments: {} };
  }
}
function saveBoard(b) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BOARD_FILE, JSON.stringify(b, null, 2));
}

// Ensure every task has a status (default: todo) and a comment slot
let board = loadBoard();
TASKS.forEach((t) => {
  if (!board.status[t.id]) board.status[t.id] = 'todo';
  if (board.comments[t.id] === undefined) board.comments[t.id] = '';
});
saveBoard(board);

// ---- Auth middleware ----
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') throw new Error('bad role');
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired — log in again' });
  }
}

// ---- API ----
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Wrong password' });
});

// Tasks + statuses + comments (public)
app.get('/api/tasks', (req, res) => {
  res.json({ tasks: TASKS, status: board.status, comments: board.comments });
});

// Statuses + comments — used by viewers polling for live updates (public)
app.get('/api/state', (req, res) => {
  res.json({ status: board.status, comments: board.comments });
});

// Update one task's status and/or comment (admin only)
app.patch('/api/tasks/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status: newStatus, comment } = req.body || {};
  if (!TASKS.find((t) => t.id === id)) return res.status(404).json({ error: 'Task not found' });
  if (newStatus !== undefined) {
    if (!VALID.includes(newStatus)) return res.status(400).json({ error: 'Invalid status' });
    board.status[id] = newStatus;
  }
  if (comment !== undefined) {
    board.comments[id] = String(comment).slice(0, 500); // cap note length
  }
  saveBoard(board);
  res.json({ id, status: board.status[id], comment: board.comments[id] });
});

// ---- Serve built React app in production ----
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`\n🙏 Ganesh Utsav server running on http://localhost:${PORT}`);
  console.log(`   Admin password: ${ADMIN_PASSWORD === 'bappa2026' ? 'bappa2026 (change ADMIN_PASSWORD!)' : '(from env)'}\n`);
});
