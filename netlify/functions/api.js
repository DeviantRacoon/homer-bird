import express from 'express';
import serverless from 'serverless-http';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const router = express.Router();

app.use(cors());
app.use(express.json({ limit: '64kb' }));

// En Netlify Serverless el sistema de archivos temporal permitido para escritura es /tmp
const SCORES_FILE = path.join('/tmp', 'scores.json');

const INITIAL_SCORES = [
  { id: 'seed-1', nickname: 'Sr. Burns', score: 48, timestamp: Date.now() - 86400000 * 2 },
  { id: 'seed-2', nickname: 'Cosme Fulanito', score: 18, timestamp: Date.now() - 3600000 * 5 },
  { id: 'seed-3', nickname: 'Ned Flanders', score: 15, timestamp: Date.now() - 3600000 * 2 },
  { id: 'seed-4', nickname: 'Bart Simpson', score: 12, timestamp: Date.now() - 1800000 },
  { id: 'seed-5', nickname: 'Moe Szyslak', score: 9, timestamp: Date.now() - 7200000 }
];

function sanitizeText(str, maxLength = 16) {
  if (typeof str !== 'string') return 'Homero';
  return str
    .replace(/[&<>'"]/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .trim()
    .slice(0, maxLength) || 'Homero';
}

function loadScores() {
  try {
    if (fs.existsSync(SCORES_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('Error leyendo scores /tmp:', err);
  }
  saveScores(INITIAL_SCORES);
  return INITIAL_SCORES;
}

function saveScores(scores) {
  try {
    fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error guardando scores /tmp:', err);
  }
}

// 1. GET /api/rooms
router.get('/rooms', (req, res) => {
  res.json({
    success: true,
    rooms: [
      {
        code: 'SPRINGFIELD',
        status: 'WAITING',
        playerCount: 1,
        maxPlayers: 20,
        createdAt: Date.now()
      }
    ]
  });
});

// 2. GET /api/leaderboard
router.get('/leaderboard', (req, res) => {
  const scores = loadScores();
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const allTime = [...scores]
    .sort((a, b) => b.score - a.score || a.timestamp - b.timestamp)
    .slice(0, 15);

  const today = [...scores]
    .filter(s => now - s.timestamp < oneDayMs)
    .sort((a, b) => b.score - a.score || a.timestamp - b.timestamp)
    .slice(0, 15);

  res.json({
    success: true,
    allTime,
    today,
    totalPlayers: scores.length
  });
});

// 3. POST /api/score
router.post('/score', (req, res) => {
  const { nickname, score, durationMs } = req.body;

  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 999) {
    return res.status(400).json({ success: false, error: 'Puntuación inválida' });
  }

  if (score > 2) {
    const minTimeNeeded = (score - 1) * 1150;
    if (typeof durationMs !== 'number' || durationMs < minTimeNeeded) {
      return res.status(400).json({ success: false, error: 'Validación de partida fallida' });
    }
  }

  const cleanNick = sanitizeText(nickname);
  const scores = loadScores();
  const newEntry = {
    id: `score-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    nickname: cleanNick,
    score,
    timestamp: Date.now()
  };

  scores.push(newEntry);
  saveScores(scores);

  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const rank = sorted.findIndex(s => s.id === newEntry.id) + 1;

  res.json({
    success: true,
    entry: newEntry,
    rank,
    isTop10: rank <= 10
  });
});

app.use('/api', router);
app.use('/.netlify/functions/api', router);

export const handler = serverless(app);
