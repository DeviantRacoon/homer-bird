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
      const count = await this.redis.zcard('leaderboard:all_time');
      if (count === 0 && this.localScores.length > 0) {
        console.log(`📦 [Redis] Migrando ${this.localScores.length} puntuaciones locales a Redis Sorted Sets...`);
        const pipeline = this.redis.pipeline();
        for (const s of this.localScores) {
          pipeline.zadd('leaderboard:all_time', s.score, s.id);
          pipeline.hset(`score:${s.id}`, {
            id: s.id,
            nickname: s.nickname,
            score: s.score.toString(),
            timestamp: s.timestamp.toString()
          });
        }
        await pipeline.exec();
        console.log('✅ [Redis] Sincronización inicial completada.');
      }
    } catch (err) {
      console.warn('⚠️ [Redis] Error en sincronización inicial:', err.message);
    }
  }

  // ============================================================================
  // 3. OBTENER LEADERBOARD (REDIS / FALLBACK)
  // ============================================================================

  async getLeaderboard(limit = 15) {
    if (this.isConnected && this.redis) {
      try {
        const todayKey = this.getTodayKey();
        
        // 1. Top Histórico con ZREVRANGE
        const allTimeIds = await this.redis.zrevrange('leaderboard:all_time', 0, limit - 1);
        const allTime = await this.fetchScoresMetadata(allTimeIds);

        // 2. Top de Hoy con ZREVRANGE
        const todayIds = await this.redis.zrevrange(todayKey, 0, limit - 1);
        let today = [];
        if (todayIds.length > 0) {
          today = await this.fetchScoresMetadata(todayIds);
        } else {
          // Si no hay datos en la clave del día, filtramos de las últimas 24h
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

    // Fallback Local
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const allTime = [...this.localScores]
      .sort((a, b) => b.score - a.score || a.timestamp - b.timestamp)
      .slice(0, limit);

    const today = [...this.localScores]
      .filter(s => now - s.timestamp < oneDayMs)
      .sort((a, b) => b.score - a.score || a.timestamp - b.timestamp)
      .slice(0, limit);

    return {
      success: true,
      allTime,
      today,
      totalPlayers: this.localScores.length,
      driver: 'json'
    };
  }

  async fetchScoresMetadata(ids) {
    if (!ids || ids.length === 0) return [];
    const pipeline = this.redis.pipeline();
    ids.forEach(id => pipeline.hgetall(`score:${id}`));
    const results = await pipeline.exec();

    return results
      .map(([err, data]) => {
        if (err || !data || !data.id) return null;
        return {
          id: data.id,
          nickname: data.nickname,
          score: parseInt(data.score, 10),
          timestamp: parseInt(data.timestamp, 10)
        };
      })
      .filter(Boolean);
  }

  // ============================================================================
  // 4. GUARDAR PUNTUACIÓN (REDIS / FALLBACK)
  // ============================================================================

  async saveScore({ nickname, score, durationMs }) {
    const entry = {
      id: `score-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      nickname,
      score,
      timestamp: Date.now()
    };

    if (this.isConnected && this.redis) {
      try {
        const todayKey = this.getTodayKey();
        const pipeline = this.redis.pipeline();

        // 1. Guardar en Sorted Set global
        pipeline.zadd('leaderboard:all_time', score, entry.id);

        // 2. Guardar en Sorted Set diario con TTL de 48 horas
        pipeline.zadd(todayKey, score, entry.id);
        pipeline.expire(todayKey, 172800); // 48 horas

        // 3. Guardar hash con detalles
        pipeline.hset(`score:${entry.id}`, {
          id: entry.id,
          nickname: entry.nickname,
          score: entry.score.toString(),
          timestamp: entry.timestamp.toString(),
          durationMs: (durationMs || 0).toString()
        });

        await pipeline.exec();

        // 4. Obtener rango exacto con ZREVRANK (0-indexed)
        const rank0 = await this.redis.zrevrank('leaderboard:all_time', entry.id);
        const rank = (rank0 !== null ? rank0 : 0) + 1;

        // Mantener copia local actualizada en segundo plano
        this.localScores.push(entry);
        this.saveLocalScores();

        return {
          success: true,
          entry,
          rank,
          isTop10: rank <= 10,
          driver: 'redis'
        };
      } catch (err) {
        console.warn('⚠️ [Redis] Fallo al guardar en Redis, guardando en fallback local:', err.message);
      }
    }

    // Fallback Local
    this.localScores.push(entry);
    this.saveLocalScores();

    const sorted = [...this.localScores].sort((a, b) => b.score - a.score || a.timestamp - b.timestamp);
    const rank = sorted.findIndex(s => s.id === entry.id) + 1;

    return {
      success: true,
      entry,
      rank,
      isTop10: rank <= 10,
      driver: 'json'
    };
  }
}

export const storage = new StorageManager();
