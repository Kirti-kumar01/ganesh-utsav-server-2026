require('dotenv').config(); // loads server/.env locally; no-op if absent (e.g. on Render)
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const TASKS = require('./tasks');

const app = express();
// For separate frontend/backend hosting: set CLIENT_ORIGIN to your frontend URL
// (e.g. https://ganesh-utsav.netlify.app). Left unset, all origins are allowed
// (fine here because auth uses a Bearer token in the header, not cookies).
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;
app.use(cors(CLIENT_ORIGIN ? { origin: CLIENT_ORIGIN } : {}));
app.use(express.json());

// ---- Config (override with environment variables in production) ----
const PORT = process.env.PORT || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bappa2026';
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-secret';
const VALID = ['todo', 'progress', 'done'];

// 10 days of prasad seva — edit these dates/labels if your dates differ
const PRASAD_DAYS = [
  { id: 'd1', date: '14 Sep', dow: 'Mon' },
  { id: 'd2', date: '15 Sep', dow: 'Tue' },
  { id: 'd3', date: '16 Sep', dow: 'Wed' },
  { id: 'd4', date: '17 Sep', dow: 'Thu' },
  { id: 'd5', date: '18 Sep', dow: 'Fri' },
  { id: 'd6', date: '19 Sep', dow: 'Sat' },
  { id: 'd7', date: '20 Sep', dow: 'Sun' },
  { id: 'd8', date: '21 Sep', dow: 'Mon' },
  { id: 'd9', date: '22 Sep', dow: 'Tue' },
  { id: 'd10', date: '23 Sep', dow: 'Wed' },
  { id: 'd11', date: '24 Sep', dow: 'Thu' },
];
const SLOTS = ['morning', 'evening'];

// ---- Storage: Upstash Redis if configured, else local file ----
// Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (from upstash.com) in production.
// Locally, with no env vars, it falls back to server/data/board.json automatically.
const USE_REDIS = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const REDIS_KEY = 'ganesh-utsav-board';
const DATA_DIR = path.join(__dirname, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'board.json');

let redis = null;
if (USE_REDIS) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    retry: { retries: 2, backoff: (n) => Math.min(100 * 2 ** n, 500) },
  });
}

function normalize(b) {
  b = b || {};
  return { status: b.status || {}, comments: b.comments || {}, prasad: b.prasad || {} };
}

async function loadBoard() {
  if (redis) {
    try {
      const b = await redis.get(REDIS_KEY); // @upstash/redis returns the stored object (or null)
      return normalize(typeof b === 'string' ? JSON.parse(b) : b);
    } catch (e) {
      console.error('Redis load failed, starting fresh:', e.message);
      return normalize();
    }
  }
  try {
    return normalize(JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8')));
  } catch {
    return normalize();
  }
}

async function saveBoard(b) {
  if (redis) {
    try { await redis.set(REDIS_KEY, b); }
    catch (e) { console.error('Redis save failed:', e.message); }
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BOARD_FILE, JSON.stringify(b, null, 2));
}

// In-memory working copy; loaded from storage on startup (see initBoard at bottom)
let board = normalize();
function applyDefaults() {
  TASKS.forEach((t) => {
    if (!board.status[t.id]) board.status[t.id] = 'todo';
    if (board.comments[t.id] === undefined) board.comments[t.id] = '';
  });
  PRASAD_DAYS.forEach((d) => {
    if (!board.prasad[d.id]) board.prasad[d.id] = { morning: [], evening: [] };
    SLOTS.forEach((s) => { if (!Array.isArray(board.prasad[d.id][s])) board.prasad[d.id][s] = []; });
  });
}

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

// Tasks + statuses + comments + prasad (public)
app.get('/api/tasks', (req, res) => {
  res.json({ tasks: TASKS, status: board.status, comments: board.comments, prasadDays: PRASAD_DAYS, prasad: board.prasad });
});

// Statuses + comments + prasad — used by viewers polling for live updates (public)
app.get('/api/state', (req, res) => {
  res.json({ status: board.status, comments: board.comments, prasad: board.prasad });
});

// Update one task's status and/or comment (admin only)
app.patch('/api/tasks/:id', requireAdmin, async (req, res) => {
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
  await saveBoard(board);
  res.json({ id, status: board.status[id], comment: board.comments[id] });
});

// Set the list of people giving prasad for a day + slot (admin only)
app.patch('/api/prasad/:day/:slot', requireAdmin, async (req, res) => {
  const { day, slot } = req.params;
  const { names } = req.body || {};
  if (!PRASAD_DAYS.find((d) => d.id === day)) return res.status(404).json({ error: 'Day not found' });
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'Invalid slot' });
  if (!Array.isArray(names)) return res.status(400).json({ error: 'names must be an array' });
  const clean = names
    .map((n) => String(n).trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 20); // cap 20 people per slot
  if (!board.prasad[day]) board.prasad[day] = { morning: [], evening: [] };
  board.prasad[day][slot] = clean;
  await saveBoard(board);
  res.json({ day, slot, names: clean });
});

// ---- Serve built React app in production ----
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// ---- Boot: load board from storage, apply defaults, then start ----
async function start() {
  board = await loadBoard();
  applyDefaults();
  await saveBoard(board);
  app.listen(PORT, () => {
    console.log(`\n🙏 Ganesh Utsav server running on http://localhost:${PORT}`);
    console.log(`   Storage: ${USE_REDIS ? 'Upstash Redis' : 'local file (server/data/board.json)'}`);
    console.log(`   Admin password: ${ADMIN_PASSWORD === 'bappa2026' ? 'bappa2026 (change ADMIN_PASSWORD!)' : '(from env)'}\n`);
  });
}
start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
