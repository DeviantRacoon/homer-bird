import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(process.env.DATA_DIRECTORY || path.join(__dirname, '../data'));
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || process.env.SERVER_PORT || 3001;

// ==============================================================================
// 1. SEGURIDAD HTTP & SANITIZACIÓN
// ==============================================================================

app.use(cors({
  origin: true,
  methods: ['GET', 'POST']
}));

// Límite estricto de tamaño para evitar ataques de denegación de servicio por memoria
app.use(express.json({ limit: '64kb' }));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Sanitizador XSS estricto para evitar inyección en el leaderboard
function sanitizeText(str, maxLength = 16) {
  if (typeof str !== 'string') return 'Homero';
  return str
    .replace(/[&<>'"]/g, '') // Eliminar etiquetas HTML
    .replace(/[\r\n\t]/g, ' ')
    .trim()
    .slice(0, maxLength) || 'Homero';
}

// Control de Rate Limiting por IP para evitar spam en POST /api/score
const ipRateLimits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const history = ipRateLimits.get(ip) || [];
  const validHistory = history.filter(t => now - t < 60000); // Ventana de 1 minuto

  if (validHistory.length >= 10) {
    return true; // Más de 10 envíos por minuto
  }

  validHistory.push(now);
  ipRateLimits.set(ip, validHistory);
  return false;
}

// ==============================================================================
// 2. PERSISTENCIA DE PUNTUACIONES SEGURA
// ==============================================================================

const INITIAL_SCORES = [
  { id: 'seed-1', nickname: 'Sr. Burns', score: 48, timestamp: Date.now() - 86400000 * 2 },
  { id: 'seed-2', nickname: 'Cosme Fulanito', score: 18, timestamp: Date.now() - 3600000 * 5 },
  { id: 'seed-3', nickname: 'Ned Flanders', score: 15, timestamp: Date.now() - 3600000 * 2 },
  { id: 'seed-4', nickname: 'Bart Simpson', score: 12, timestamp: Date.now() - 1800000 },
  { id: 'seed-5', nickname: 'Moe Szyslak', score: 9, timestamp: Date.now() - 7200000 }
];

function loadScores() {
  try {
    if (fs.existsSync(SCORES_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('Error leyendo scores.json:', err);
  }
  saveScores(INITIAL_SCORES);
  return INITIAL_SCORES;
}

function saveScores(scores) {
  try {
    fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error guardando scores.json:', err);
  }
}

// ==============================================================================
// 3. HTTP REST API
// ==============================================================================

// Lista de salas activas (para el lobby)
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(r => ({
    code: r.code,
    status: r.status, // 'WAITING' | 'PLAYING'
    playerCount: r.players.size,
    maxPlayers: 20,
    createdAt: r.createdAt
  }));

  res.json({
    success: true,
    rooms: roomList
  });
});

// Ranking Global (Histórico y de Hoy)
app.get('/api/leaderboard', (req, res) => {
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

// Guardar Puntuación con Validación Anti-Cheat
app.post('/api/score', (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  if (isRateLimited(clientIp)) {
    return res.status(429).json({ success: false, error: 'Demasiadas peticiones. Intenta más tarde.' });
  }

  const { nickname, score, durationMs } = req.body;

  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 999) {
    return res.status(400).json({ success: false, error: 'Puntuación inválida' });
  }

  // Validación de Física y Tiempo: un obstáculo tarda mín. ~1.15 segundos en pasarse
  if (score > 2) {
    const minTimeNeeded = (score - 1) * 1150;
    if (typeof durationMs !== 'number' || durationMs < minTimeNeeded) {
      console.warn(`🚨 [Anti-Cheat Bloqueado] Intento sospechoso: ${score} pts en ${durationMs}ms desde IP: ${clientIp}`);
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

// ==============================================================================
// 4. STATIC FRONTEND SERVING (Monolito Fullstack)
// ==============================================================================

const DIST_DIR = path.resolve(__dirname, '../dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// ==============================================================================
// 5. WEBSOCKET SERVER & ROOM STATE MACHINE
// ==============================================================================

const wss = new WebSocketServer({ server });
const rooms = new Map(); // roomCode -> Room

const PLAYER_COLORS = [
  0xfacc15, // Amarillo Homero
  0x38bdf8, // Azul cielo
  0xf43f5e, // Rosa dona
  0x4ade80, // Verde radioactivo
  0xa855f7, // Púrpura Bart
  0xfb923c, // Naranja Duff
  0x2dd4bf  // Turquesa
];

function getOrCreateRoom(code) {
  const roomCode = sanitizeText(code, 12).toUpperCase() || 'SPRINGFIELD';
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      code: roomCode,
      status: 'WAITING', // 'WAITING' | 'PLAYING'
      seed: Math.floor(Math.random() * 1000000),
      players: new Map(),
      createdAt: Date.now()
    });
    console.log(`🌐 [Sala Creada] Código: ${roomCode}`);
  }
  return rooms.get(roomCode);
}

wss.on('connection', (ws) => {
  const playerId = `p-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
  let currentRoom = null;
  let playerNick = 'Homero';

  ws.on('message', (message) => {
    try {
      // Protección de tamaño de paquete WS
      if (message.length > 2048) return;

      const data = JSON.parse(message);

      switch (data.type) {
        case 'join_room': {
          const roomCode = sanitizeText(data.roomCode, 12).toUpperCase() || 'SPRINGFIELD';
          playerNick = sanitizeText(data.nickname, 16);
          const targetRoom = getOrCreateRoom(roomCode);

          // VALIDACIÓN CRÍTICA: Bloquear entrada si la partida ya comenzó
          if (targetRoom.status === 'PLAYING') {
            ws.send(JSON.stringify({
              type: 'join_error',
              code: 'GAME_IN_PROGRESS',
              message: `La partida en la sala "${roomCode}" ya ha comenzado. Espera a que termine o crea una nueva sala.`
            }));
            return;
          }

          if (targetRoom.players.size >= 20) {
            ws.send(JSON.stringify({
              type: 'join_error',
              code: 'ROOM_FULL',
              message: `La sala "${roomCode}" está llena (máx. 20 jugadores).`
            }));
            return;
          }

          currentRoom = targetRoom;
          const playerColor = PLAYER_COLORS[currentRoom.players.size % PLAYER_COLORS.length];

          const playerInfo = {
            id: playerId,
            nickname: playerNick,
            color: playerColor,
            y: 280,
            vy: 0,
            angle: 0,
            score: 0,
            isAlive: true,
            ws
          };

          currentRoom.players.set(playerId, playerInfo);

          const peerList = Array.from(currentRoom.players.values()).map(p => ({
            id: p.id,
            nickname: p.nickname,
            color: p.color,
            y: p.y,
            score: p.score,
            isAlive: p.isAlive
          }));

          ws.send(JSON.stringify({
            type: 'room_joined',
            roomCode: currentRoom.code,
            playerId,
            seed: currentRoom.seed,
            status: currentRoom.status,
            players: peerList
          }));

          broadcastToRoom(currentRoom, {
            type: 'player_joined',
            player: {
              id: playerId,
              nickname: playerNick,
              color: playerColor,
              y: 280,
              score: 0,
              isAlive: true
            }
          }, playerId);

          console.log(`👤 ${playerNick} entró a la sala ${currentRoom.code} (${currentRoom.players.size} jugadores)`);
          break;
        }

        case 'start_game': {
          // El host o un jugador inicia la partida en la sala -> Se bloquea la sala
          if (!currentRoom) return;
          currentRoom.status = 'PLAYING';
          broadcastToRoom(currentRoom, {
            type: 'game_started',
            roomCode: currentRoom.code
          });
          console.log(`🚀 Partida iniciada en la sala ${currentRoom.code}. Sala bloqueada para nuevos ingresos.`);
          break;
        }

        case 'pos': {
          if (!currentRoom) return;
          const player = currentRoom.players.get(playerId);
          if (player) {
            player.y = typeof data.y === 'number' ? data.y : player.y;
            player.vy = typeof data.vy === 'number' ? data.vy : player.vy;
            player.angle = typeof data.a === 'number' ? data.a : player.angle;
            player.score = typeof data.score === 'number' ? data.score : player.score;

            broadcastToRoom(currentRoom, {
              type: 'player_pos',
              id: playerId,
              y: player.y,
              vy: player.vy,
              a: player.angle,
              score: player.score
            }, playerId);
          }
          break;
        }

        case 'jump': {
          if (!currentRoom) return;
          broadcastToRoom(currentRoom, {
            type: 'player_jump',
            id: playerId
          }, playerId);
          break;
        }

        case 'die': {
          if (!currentRoom) return;
          const player = currentRoom.players.get(playerId);
          if (player) {
            player.isAlive = false;
            player.score = data.score || player.score;

            broadcastToRoom(currentRoom, {
              type: 'player_died',
              id: playerId,
              nickname: player.nickname,
              score: player.score
            });

            // Verificar si todos han muerto para reabrir la sala
            const anyAlive = Array.from(currentRoom.players.values()).some(p => p.isAlive);
            if (!anyAlive) {
              currentRoom.status = 'WAITING';
              currentRoom.seed = Math.floor(Math.random() * 1000000); // Nueva semilla para la siguiente
              // Restaurar estado de vivos
              currentRoom.players.forEach(p => { p.isAlive = true; });
              broadcastToRoom(currentRoom, {
                type: 'room_reset',
                seed: currentRoom.seed
              });
              console.log(`🔄 Todos los jugadores murieron en la sala ${currentRoom.code}. Sala reabierta.`);
            }
          }
          break;
        }
      }
    } catch (err) {
      console.warn('Error procesando mensaje WS:', err);
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.players.delete(playerId);
      broadcastToRoom(currentRoom, {
        type: 'player_left',
        id: playerId
      });
      if (currentRoom.players.size === 0) {
        rooms.delete(currentRoom.code);
        console.log(`🧹 Sala ${currentRoom.code} eliminada por estar vacía.`);
      }
    }
  });
});

function broadcastToRoom(room, messageObj, excludePlayerId = null) {
  const json = JSON.stringify(messageObj);
  room.players.forEach((player) => {
    if (player.id !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(json);
    }
  });
}

server.listen(PORT, () => {
  console.log(`🛡️ Homer Bird API Segura & Servidor WebSockets corriendo en http://localhost:${PORT}`);
});
