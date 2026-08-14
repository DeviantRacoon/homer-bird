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
const DATA_DIR = path.resolve(process.env.DATA_DIRECTORY || path.join(__dirname, 'data'));
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || process.env.SERVER_PORT || 3001;
const rawCors = process.env.CORS_ORIGIN || '*';
const allowedOrigins = rawCors.split(',').map(s => s.trim()).filter(Boolean);

// ==============================================================================
// 1. SEGURIDAD HTTP & SANITIZACIÓN
// ==============================================================================

// Habilitar CORS dinámico y universal (permite Netlify, localhost y producción)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (rawCors === '*' || !origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || rawCors === '*' || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Permisivo para evitar bloqueos accidentales
    }
  },
  methods: ['GET', 'POST', 'OPTIONS']
}));

// Límite estricto de tamaño para evitar ataques de denegación de servicio por memoria
app.use(express.json({ limit: '64kb' }));

// Health check para balanceadores de carga / Render / Railway
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/', (req, res) => {
  res.json({
    service: 'Homer Bird Game Server',
    status: 'online',
    version: '1.0.0',
    endpoints: ['/health', '/api/rooms', '/api/leaderboard', '/api/score']
  });
});

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Sanitizador XSS estricto para evitar inyección en el leaderboard y salas
function sanitizeText(str, maxLength = 16) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[&<>'"]/g, '') // Eliminar caracteres peligrosos
    .replace(/[\r\n\t]/g, ' ')
    .trim()
    .slice(0, maxLength);
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

import { storage } from './src/storage/redisStorage.js';

// ==============================================================================
// 3. HTTP REST API
// ==============================================================================

// Lista de salas activas (para el lobby)
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(r => ({
    code: r.code,
    status: r.status, // 'WAITING' | 'COUNTDOWN' | 'PLAYING'
    playerCount: r.players.size,
    maxPlayers: 20,
    createdAt: r.createdAt
  }));

  res.json({
    success: true,
    rooms: roomList
  });
});

// Ranking Global (Histórico y de Hoy) con Redis / Fallback
app.get('/api/leaderboard', async (req, res) => {
  try {
    const data = await storage.getLeaderboard(15);
    res.json(data);
  } catch (err) {
    console.error('Error obteniendo leaderboard:', err);
    res.status(500).json({ success: false, error: 'Error al consultar ranking' });
  }
});

// Guardar Puntuación con Validación Anti-Cheat
app.post('/api/score', async (req, res) => {
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
  const result = await storage.saveScore({
    nickname: cleanNick,
    score,
    durationMs
  });

  res.json(result);
});

// ==============================================================================
// 4. WEBSOCKET SERVER & ROOM STATE MACHINE
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
  const roomCode = sanitizeText(code, 12).toUpperCase();
  if (!roomCode) return null;
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      code: roomCode,
      status: 'WAITING', // 'WAITING' | 'COUNTDOWN' | 'PLAYING'
      seed: Math.floor(Math.random() * 1000000),
      players: new Map(),
      createdAt: Date.now()
    });
    console.log(`🌐 [Sala Creada] Código: ${roomCode}`);
  }
  return rooms.get(roomCode);
}

function cancelRoomCountdown(room) {
  if (room && room.countdownInterval) {
    clearInterval(room.countdownInterval);
    room.countdownInterval = null;
  }
}

function startRoomCountdown(room) {
  cancelRoomCountdown(room);
  room.status = 'COUNTDOWN';
  room.seed = Math.floor(Math.random() * 1000000);
  let secondsRemaining = 3;

  console.log(`⏱️ [Countdown 3s] Iniciando cuenta regresiva en sala ${room.code} (Seed: ${room.seed})`);

  broadcastToRoom(room, {
    type: 'countdown_started',
    roomCode: room.code,
    durationSec: 3,
    count: 3,
    seed: room.seed,
    startTime: Date.now()
  });

  room.countdownInterval = setInterval(() => {
    secondsRemaining--;
    if (secondsRemaining > 0) {
      broadcastToRoom(room, {
        type: 'countdown_tick',
        roomCode: room.code,
        count: secondsRemaining
      });
    } else {
      cancelRoomCountdown(room);
      room.status = 'PLAYING';
      broadcastToRoom(room, {
        type: 'game_started',
        roomCode: room.code,
        seed: room.seed
      });
      console.log(`🚀 [Partida Iniciada] Sala ${room.code} en marcha con ${room.players.size} jugadores.`);
    }
  }, 1000);
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
          const roomCode = sanitizeText(data.roomCode, 12).toUpperCase();
          if (!roomCode) {
            ws.send(JSON.stringify({
              type: 'join_error',
              code: 'INVALID_ROOM_CODE',
              message: 'Debes proporcionar un código de sala válido.'
            }));
            return;
          }

          playerNick = sanitizeText(data.nickname, 16) || 'Homero';
          const targetRoom = getOrCreateRoom(roomCode);

          if (!targetRoom) {
            ws.send(JSON.stringify({
              type: 'join_error',
              code: 'INVALID_ROOM_CODE',
              message: 'No se pudo crear o acceder a la sala especificada.'
            }));
            return;
          }

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
            isReady: false,
            ws
          };

          currentRoom.players.set(playerId, playerInfo);

          const peerList = Array.from(currentRoom.players.values()).map(p => ({
            id: p.id,
            nickname: p.nickname,
            color: p.color,
            y: p.y,
            score: p.score,
            isAlive: p.isAlive,
            isReady: p.isReady || false
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
              isAlive: true,
              isReady: false
            }
          }, playerId);

          console.log(`👤 ${playerNick} entró a la sala ${currentRoom.code} (${currentRoom.players.size} jugadores)`);
          break;
        }

        case 'player_ready': {
          if (!currentRoom || currentRoom.status !== 'WAITING') return;
          const player = currentRoom.players.get(playerId);
          if (player) {
            player.isReady = true;
            const readyPlayers = Array.from(currentRoom.players.values()).filter(p => p.isReady).length;
            const totalPlayers = currentRoom.players.size;

            broadcastToRoom(currentRoom, {
              type: 'player_ready',
              id: playerId,
              nickname: player.nickname,
              readyCount: readyPlayers,
              totalPlayers
            });

            // Si todos los jugadores en la sala están listos, iniciar cuenta regresiva sincronizada (3, 2, 1...)
            const allReady = totalPlayers > 0 && Array.from(currentRoom.players.values()).every(p => p.isReady);
            if (allReady) {
              startRoomCountdown(currentRoom);
            }
          }
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
              cancelRoomCountdown(currentRoom);
              currentRoom.status = 'WAITING';
              currentRoom.seed = Math.floor(Math.random() * 1000000); // Nueva semilla para la siguiente
              // Restaurar estado de vivos y listos
              currentRoom.players.forEach(p => { 
                p.isAlive = true; 
                p.isReady = false; 
              });
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
        cancelRoomCountdown(currentRoom);
        rooms.delete(currentRoom.code);
        console.log(`🧹 Sala ${currentRoom.code} eliminada por estar vacía.`);
      } else if (currentRoom.status === 'COUNTDOWN') {
        // Si un jugador se sale durante la cuenta regresiva, abortar y regresar a WAITING
        cancelRoomCountdown(currentRoom);
        currentRoom.status = 'WAITING';
        currentRoom.players.forEach(p => { p.isReady = false; });
        broadcastToRoom(currentRoom, {
          type: 'room_reset',
          reason: 'player_left_during_countdown',
          seed: currentRoom.seed
        });
      } else if (currentRoom.status === 'WAITING') {
        // Verificar si los restantes están todos listos
        const readyPlayers = Array.from(currentRoom.players.values()).filter(p => p.isReady).length;
        const totalPlayers = currentRoom.players.size;
        const allReady = totalPlayers > 0 && Array.from(currentRoom.players.values()).every(p => p.isReady);
        if (allReady) {
          startRoomCountdown(currentRoom);
        }
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
