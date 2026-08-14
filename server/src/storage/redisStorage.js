import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(process.env.DATA_DIRECTORY || path.join(__dirname, '../../data'));
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

const INITIAL_SCORES = [
  { id: 'seed-1', nickname: 'Sr. Burns', score: 48, timestamp: Date.now() - 86400000 * 2 },
  { id: 'seed-2', nickname: 'Cosme Fulanito', score: 35, timestamp: Date.now() - 3600000 * 5 },
  { id: 'seed-3', nickname: 'Ned Flanders', score: 28, timestamp: Date.now() - 3600000 * 2 },
  { id: 'seed-4', nickname: 'Bart Simpson', score: 24, timestamp: Date.now() - 1800000 },
  { id: 'seed-5', nickname: 'Moe Szyslak', score: 19, timestamp: Date.now() - 7200000 },
  { id: 'seed-6', nickname: 'Barney Gumble', score: 14, timestamp: Date.now() - 3600000 * 10 },
  { id: 'seed-7', nickname: 'Milhouse V.', score: 9, timestamp: Date.now() - 3600000 * 3 },
  { id: 'seed-8', nickname: 'Rafa Gorgory', score: 4, timestamp: Date.now() - 3600000 * 1 }
];

export class StorageManager {
  constructor() {
    this.redis = null;
    this.isConnected = false;
    this.localScores = [];
    this.initFallback();
    this.initRedis();
  }

  // ============================================================================
  // 1. INICIALIZACIÓN Y FALLBACK LOCAL
  // ============================================================================

  initFallback() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    try {
      if (fs.existsSync(SCORES_FILE)) {
        const raw = fs.readFileSync(SCORES_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.localScores = parsed;
          return;
        }
      }
    } catch (err) {
      console.warn('⚠️ [Storage] Error leyendo scores.json local:', err.message);
    }

    this.localScores = [...INITIAL_SCORES];
    this.saveLocalScores();
  }

  saveLocalScores() {
    try {
      fs.writeFileSync(SCORES_FILE, JSON.stringify(this.localScores, null, 2), 'utf-8');
    } catch (err) {
      console.error('❌ [Storage] Error guardando scores.json:', err.message);
    }
  }

  // ============================================================================
  // 2. CONEXIÓN A REDIS (CON RESILIENCIA)
  // ============================================================================

  initRedis() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.info('ℹ️ [Storage] REDIS_URL no configurada. Usando persistencia local (JSON en disco).');
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 2,
        connectTimeout: 5000,
        retryStrategy: (times) => {
          if (times > 3) {
            console.warn('⚠️ [Redis] No se pudo conectar a Redis después de 3 intentos. Conmutando a modo fallback.');
            return null; // Detener reintentos automáticos continuos
          }
          return Math.min(times * 1000, 3000);
        }
      });

      this.redis.on('connect', async () => {
        this.isConnected = true;
        console.log('⚡ [Redis] Conectado exitosamente a Redis. Sorted Sets & Cache listos.');
        await this.syncInitialToRedis();
      });

      this.redis.on('error', (err) => {
        if (this.isConnected) {
          console.warn('⚠️ [Redis Error]:', err.message);
        }
        this.isConnected = false;
      });

      this.redis.on('close', () => {
        this.isConnected = false;
      });
    } catch (err) {
      console.warn('⚠️ [Redis] Error al inicializar cliente:', err.message);
      this.isConnected = false;
    }
  }

  getTodayKey() {
    const d = new Date();
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `leaderboard:today:${year}-${month}-${day}`;
  }

  async syncInitialToRedis() {
    if (!this.isConnected || !this.redis) return;
    try {
      console.log('🔄 [Redis] Normalizando y migrando leaderboard a registros únicos...');
      
      // 1. Obtener todos los miembros actuales con sus puntuaciones
      const membersWithScores = await this.redis.zrevrange('leaderboard:all_time', 0, -1, 'WITHSCORES');
      const existingPlayers = new Map(); // memberKey -> { nickname, score, timestamp }

      // 2. Extraer datos existentes soportando formato nuevo (player:) y legacy (score:)
      if (membersWithScores.length > 0) {
        const pipeInspect = this.redis.pipeline();
        for (let i = 0; i < membersWithScores.length; i += 2) {
          const m = membersWithScores[i];
          pipeInspect.hgetall(`player:${m}`);
          pipeInspect.hgetall(`score:${m}`);
        }
        const results = await pipeInspect.exec();
        
        let resIdx = 0;
        for (let i = 0; i < membersWithScores.length; i += 2) {
          const m = membersWithScores[i];
          const zScore = parseInt(membersWithScores[i + 1], 10) || 0;
          const [errP, dataP] = results[resIdx++];
          const [errS, dataS] = results[resIdx++];

          const data = (dataP && dataP.nickname) ? dataP : ((dataS && dataS.nickname) ? dataS : null);
          const rawNick = data?.nickname || m;
          const cleanNick = String(rawNick).trim().replace(/^score-.*$/, '');

          if (cleanNick && !cleanNick.startsWith('seed-') && !cleanNick.startsWith('score-')) {
            const key = cleanNick.toLowerCase();
            const existing = existingPlayers.get(key);
            const score = (data && data.score) ? parseInt(data.score, 10) : zScore;
            const ts = (data && data.timestamp) ? parseInt(data.timestamp, 10) : Date.now();
            if (!existing || score > existing.score) {
              existingPlayers.set(key, { nickname: cleanNick, score, timestamp: ts });
            }
          }
        }
      }

      // 3. Fusionar con puntuaciones locales / iniciales
      this.localScores.forEach(s => {
        const cleanNick = (s.nickname || '').trim();
        if (!cleanNick || cleanNick.startsWith('score-')) return;
        const key = cleanNick.toLowerCase();
        const existing = existingPlayers.get(key);
        if (!existing || s.score > existing.score) {
          existingPlayers.set(key, { nickname: cleanNick, score: s.score, timestamp: s.timestamp || Date.now() });
        }
      });

      // 4. Limpiar set legacy y reconstruir limpio con claves únicas
      const cleanPipe = this.redis.pipeline();
      cleanPipe.del('leaderboard:all_time');

      for (const [key, p] of existingPlayers.entries()) {
        cleanPipe.zadd('leaderboard:all_time', p.score, key);
        cleanPipe.hset(`player:${key}`, {
          id: key,
          nickname: p.nickname,
          score: p.score.toString(),
          timestamp: p.timestamp.toString()
        });
      }

      await cleanPipe.exec();
      console.log(`✅ [Redis] Leaderboard normalizado con ${existingPlayers.size} jugadores únicos.`);
    } catch (err) {
      console.warn('⚠️ [Redis] Error en normalización inicial:', err.message);
    }
  }

  // ============================================================================
  // 3. OBTENER LEADERBOARD (REDIS / FALLBACK CON UNICIDAD DE JUGADOR)
  // ============================================================================

  async getLeaderboard(limit = 15) {
    if (this.isConnected && this.redis) {
      try {
        const todayKey = this.getTodayKey();
        
        // 1. Top Histórico con ZREVRANGE y WITHSCORES
        const allTimeMembers = await this.redis.zrevrange('leaderboard:all_time', 0, limit - 1, 'WITHSCORES');
        let allTime = [];
        if (allTimeMembers.length > 0) {
          const pipeAll = this.redis.pipeline();
          for (let i = 0; i < allTimeMembers.length; i += 2) {
            const m = allTimeMembers[i];
            pipeAll.hgetall(`player:${m}`);
            pipeAll.hgetall(`score:${m}`);
          }
          const allResults = await pipeAll.exec();
          
          let resIdx = 0;
          for (let i = 0; i < allTimeMembers.length; i += 2) {
            const m = allTimeMembers[i];
            const zScore = parseInt(allTimeMembers[i + 1], 10) || 0;
            const [errP, dataP] = allResults[resIdx++];
            const [errS, dataS] = allResults[resIdx++];
            const data = (dataP && dataP.nickname) ? dataP : ((dataS && dataS.nickname) ? dataS : null);

            const nick = (data && data.nickname) ? data.nickname : m;
            const score = (data && data.score) ? parseInt(data.score, 10) : zScore;
            const ts = (data && data.timestamp) ? parseInt(data.timestamp, 10) : Date.now();

            allTime.push({
              id: m,
              nickname: nick,
              score,
              timestamp: ts
            });
          }
        }

        // 2. Top Hoy con ZREVRANGE y WITHSCORES
        const todayMembers = await this.redis.zrevrange(todayKey, 0, limit - 1, 'WITHSCORES');
        let today = [];
        if (todayMembers.length > 0) {
          const pipeToday = this.redis.pipeline();
          for (let i = 0; i < todayMembers.length; i += 2) {
            const m = todayMembers[i];
            pipeToday.hgetall(`player_today:${todayKey}:${m}`);
            pipeToday.hgetall(`player:${m}`);
          }
          const todayResults = await pipeToday.exec();
          
          let resIdx = 0;
          for (let i = 0; i < todayMembers.length; i += 2) {
            const m = todayMembers[i];
            const zScore = parseInt(todayMembers[i + 1], 10) || 0;
            const [errPT, dataPT] = todayResults[resIdx++];
            const [errP, dataP] = todayResults[resIdx++];
            const data = (dataPT && dataPT.nickname) ? dataPT : ((dataP && dataP.nickname) ? dataP : null);

            const nick = (data && data.nickname) ? data.nickname : m;
            const score = (data && data.score) ? parseInt(data.score, 10) : zScore;
            const ts = (data && data.timestamp) ? parseInt(data.timestamp, 10) : Date.now();

            today.push({
              id: m,
              nickname: nick,
              score,
              timestamp: ts
            });
          }
        } else {
          const oneDayMs = 24 * 60 * 60 * 1000;
          const now = Date.now();
          today = allTime.filter(s => now - s.timestamp < oneDayMs);
        }

        const totalPlayers = await this.redis.zcard('leaderboard:all_time');

        return {
          success: true,
          allTime,
          today,
          totalPlayers: totalPlayers || allTime.length,
          driver: 'redis'
        };
      } catch (err) {
        console.warn('⚠️ [Redis] Fallo al consultar leaderboard, usando fallback:', err.message);
      }
    }

    // Fallback Local (JSON) con unicidad por jugador
    const uniqueMap = new Map();
    this.localScores.forEach(s => {
      const key = (s.nickname || '').trim().toLowerCase();
      if (!key) return;
      const existing = uniqueMap.get(key);
      if (!existing || s.score > existing.score) {
        uniqueMap.set(key, s);
      }
    });

    const uniqueScores = Array.from(uniqueMap.values());
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const allTime = [...uniqueScores]
      .sort((a, b) => b.score - a.score || a.timestamp - b.timestamp)
      .slice(0, limit);

    const today = [...uniqueScores]
      .filter(s => now - s.timestamp < oneDayMs)
      .sort((a, b) => b.score - a.score || a.timestamp - b.timestamp)
      .slice(0, limit);

    return {
      success: true,
      allTime,
      today,
      totalPlayers: uniqueScores.length,
      driver: 'json'
    };
  }

  // ============================================================================
  // 4. GUARDAR PUNTUACIÓN (REDIS / FALLBACK CON RÉCORD ÚNICO POR JUGADOR)
  // ============================================================================

  async saveScore({ nickname, score, durationMs }) {
    const cleanNick = (nickname || 'Homero').trim().slice(0, 16) || 'Homero';
    const memberKey = cleanNick.toLowerCase();
    const now = Date.now();

    const entry = {
      id: memberKey,
      nickname: cleanNick,
      score,
      timestamp: now
    };

    if (this.isConnected && this.redis) {
      try {
        const todayKey = this.getTodayKey();
        
        // 1. Guardar en Sorted Set global si supera el récord histórico
        const prevAllTime = await this.redis.zscore('leaderboard:all_time', memberKey);
        const prevAllScore = prevAllTime !== null ? parseInt(prevAllTime, 10) : -1;

        if (score >= prevAllScore) {
          const pipeAll = this.redis.pipeline();
          pipeAll.zadd('leaderboard:all_time', score, memberKey);
          pipeAll.hset(`player:${memberKey}`, {
            id: memberKey,
            nickname: cleanNick,
            score: score.toString(),
            timestamp: now.toString(),
            durationMs: (durationMs || 0).toString()
          });
          await pipeAll.exec();
        }

        // 2. Guardar en Sorted Set de Hoy si supera el récord del día
        const prevToday = await this.redis.zscore(todayKey, memberKey);
        const prevTodayScore = prevToday !== null ? parseInt(prevToday, 10) : -1;

        if (score >= prevTodayScore) {
          const pipeToday = this.redis.pipeline();
          pipeToday.zadd(todayKey, score, memberKey);
          pipeToday.expire(todayKey, 172800); // 48 horas
          pipeToday.hset(`player_today:${todayKey}:${memberKey}`, {
            id: memberKey,
            nickname: cleanNick,
            score: score.toString(),
            timestamp: now.toString()
          });
          await pipeToday.exec();
        }

        // Obtener ranking del jugador
        const rank0 = await this.redis.zrevrank('leaderboard:all_time', memberKey);
        const rank = (rank0 !== null ? rank0 : 0) + 1;

        // Mantener copia local única
        this.updateLocalScore(cleanNick, score, now);

        return {
          success: true,
          entry,
          rank,
          isTop10: rank <= 10,
          driver: 'redis'
        };
      } catch (err) {
        console.warn('⚠️ [Redis] Fallo al guardar en Redis, usando fallback local:', err.message);
      }
    }

    // Fallback Local
    this.updateLocalScore(cleanNick, score, now);

    const sorted = [...this.localScores].sort((a, b) => b.score - a.score || a.timestamp - b.timestamp);
    const rank = sorted.findIndex(s => s.nickname.toLowerCase() === memberKey) + 1;

    return {
      success: true,
      entry,
      rank: rank > 0 ? rank : 1,
      isTop10: rank > 0 && rank <= 10,
      driver: 'json'
    };
  }

  updateLocalScore(nickname, score, timestamp) {
    const memberKey = nickname.trim().toLowerCase();
    const existingIdx = this.localScores.findIndex(s => (s.nickname || '').trim().toLowerCase() === memberKey);
    if (existingIdx >= 0) {
      if (score >= this.localScores[existingIdx].score) {
        this.localScores[existingIdx].score = score;
        this.localScores[existingIdx].timestamp = timestamp;
        this.localScores[existingIdx].nickname = nickname;
      }
    } else {
      this.localScores.push({
        id: `p-${memberKey}`,
        nickname,
        score,
        timestamp
      });
    }
    this.saveLocalScores();
  }
}

export const storage = new StorageManager();
