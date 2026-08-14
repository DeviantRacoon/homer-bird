// WebSocket Multiplayer Client with Room Locking & Error Handling

export function normalizeWsUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let clean = url.trim();
  if (/^wss?:\/\//i.test(clean)) {
    return clean.replace(/\/+$/, '');
  }
  if (/^https?:\/\//i.test(clean)) {
    return clean.replace(/^http/i, 'ws').replace(/\/+$/, '');
  }
  const isLocal = clean.includes('localhost') || clean.includes('127.0.0.1');
  const proto = isLocal ? 'ws' : 'wss';
  return `${proto}://${clean.replace(/\/+$/, '')}`;
}

class MultiplayerClient {
  constructor() {
    this.ws = null;
    this.roomCode = null;
    this.playerId = null;
    this.seed = null;
    this.status = 'WAITING';
    this.peers = new Map();
    this.callbacks = {};
    this.isConnected = false;
  }

  connect(roomCode, nickname, callbacks = {}) {
    this.disconnect();
    this.callbacks = callbacks;

    const cleanRoomCode = (roomCode || '').trim().toUpperCase();
    if (!cleanRoomCode) {
      if (this.callbacks.onNoRoomSelected) {
        this.callbacks.onNoRoomSelected();
      }
      return;
    }

    let wsUrl = '';
    const rawWs = import.meta.env.VITE_WS_URL;
    const rawBackend = import.meta.env.VITE_BACKEND_URL;
    const rawApi = import.meta.env.VITE_API_URL;

    if (rawWs) {
      wsUrl = normalizeWsUrl(rawWs);
    } else if (rawBackend) {
      wsUrl = normalizeWsUrl(rawBackend);
    } else if (rawApi && !rawApi.startsWith('/')) {
      wsUrl = normalizeWsUrl(rawApi.replace(/\/api\/?$/, ''));
    } else {
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocal) {
        wsUrl = 'ws://localhost:3001';
      } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}`;
      }
    }

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.ws.send(JSON.stringify({
          type: 'join_room',
          roomCode: cleanRoomCode,
          nickname
        }));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.warn('Error parsing WS message:', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        if (this.callbacks.onDisconnected) this.callbacks.onDisconnected();
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket error:', err);
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
    }
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'join_error':
        if (this.callbacks.onJoinError) {
          this.callbacks.onJoinError(msg);
        }
        break;

      case 'room_joined':
        this.roomCode = msg.roomCode;
        this.playerId = msg.playerId;
        this.seed = msg.seed;
        this.status = msg.status || 'WAITING';
        this.isReady = false;
        this.peers.clear();
        if (msg.players) {
          msg.players.forEach(p => {
            if (p.id !== this.playerId) {
              this.peers.set(p.id, { ...p, isReady: p.isReady || false });
            }
          });
        }
        if (this.callbacks.onRoomJoined) {
          this.callbacks.onRoomJoined(msg);
        }
        break;

      case 'player_ready':
        if (msg.id === this.playerId) {
          this.isReady = true;
        } else {
          const peer = this.peers.get(msg.id);
          if (peer) peer.isReady = true;
        }
        if (this.callbacks.onPlayerReady) {
          this.callbacks.onPlayerReady(msg);
        }
        break;

      case 'countdown_started':
        this.status = 'COUNTDOWN';
        if (msg.seed) this.seed = msg.seed;
        if (this.callbacks.onCountdownStarted) {
          this.callbacks.onCountdownStarted(msg);
        }
        break;

      case 'countdown_tick':
        if (this.callbacks.onCountdownTick) {
          this.callbacks.onCountdownTick(msg);
        }
        break;

      case 'game_started':
        this.status = 'PLAYING';
        if (msg.seed) this.seed = msg.seed;
        if (this.callbacks.onGameStarted) {
          this.callbacks.onGameStarted(msg);
        }
        break;

      case 'room_reset':
        this.status = 'WAITING';
        this.seed = msg.seed;
        this.isReady = false;
        this.peers.forEach(p => { 
          p.isAlive = true;
          p.isReady = false;
        });
        if (this.callbacks.onRoomReset) {
          this.callbacks.onRoomReset(msg);
        }
        break;

      case 'player_joined':
        if (msg.player && msg.player.id !== this.playerId) {
          this.peers.set(msg.player.id, { ...msg.player, isReady: msg.player.isReady || false });
          if (this.callbacks.onPlayerJoined) this.callbacks.onPlayerJoined(msg.player);
        }
        break;

      case 'player_pos':
        if (msg.id !== this.playerId) {
          const peer = this.peers.get(msg.id);
          if (peer) {
            peer.y = msg.y;
            peer.vy = msg.vy;
            peer.angle = msg.a;
            peer.score = msg.score;
          }
          if (this.callbacks.onPlayerPos) this.callbacks.onPlayerPos(msg);
        }
        break;

      case 'player_jump':
        if (msg.id !== this.playerId && this.callbacks.onPlayerJump) {
          this.callbacks.onPlayerJump(msg.id);
        }
        break;

      case 'player_died':
        if (msg.id !== this.playerId) {
          const peer = this.peers.get(msg.id);
          if (peer) peer.isAlive = false;
          if (this.callbacks.onPlayerDied) this.callbacks.onPlayerDied(msg);
        }
        break;

      case 'player_left':
        this.peers.delete(msg.id);
        if (this.callbacks.onPlayerLeft) this.callbacks.onPlayerLeft(msg.id);
        break;
    }
  }

  sendReady() {
    this.isReady = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'player_ready' }));
    }
  }

  sendPosition(y, vy, angle, score) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'pos',
        y: Math.round(y),
        vy: Math.round(vy),
        a: Math.round(angle),
        score
      }));
    }
  }

  sendJump() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'jump' }));
    }
  }

  sendDeath(score) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'die', score }));
    }
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.roomCode = null;
    this.playerId = null;
    this.seed = null;
    this.isReady = false;
    this.isConnected = false;
    this.peers.clear();
  }
}

export const multiplayer = new MultiplayerClient();
