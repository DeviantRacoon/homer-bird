// WebSocket Multiplayer Client with Room Locking & Error Handling

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

    let wsUrl = import.meta.env.VITE_WS_URL;
    if (!wsUrl) {
      const backendUrl = import.meta.env.VITE_BACKEND_URL;
      if (backendUrl) {
        wsUrl = backendUrl.replace(/^http/, 'ws');
      } else {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isLocal) {
          wsUrl = `ws://localhost:3001`;
        } else {
          // Si estamos en un hosting serverless como Netlify sin backend configurado
          if (window.location.hostname.includes('netlify.app') || window.location.hostname.includes('vercel.app')) {
            console.info('ℹ️ Netlify Serverless no soporta WebSockets persistentes. Configura VITE_BACKEND_URL para activar multijugador.');
            if (this.callbacks.onJoinError) {
              this.callbacks.onJoinError({
                code: 'SERVERLESS_WS_UNSUPPORTED',
                message: 'Para jugar Multijugador en vivo en la nube, conecta un servidor WebSocket en Render/Railway.'
              });
            }
            return;
          }
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${protocol}//${window.location.host}`;
        }
      }
    }

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.ws.send(JSON.stringify({
          type: 'join_room',
          roomCode: roomCode || 'SPRINGFIELD',
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
        this.peers.clear();
        if (msg.players) {
          msg.players.forEach(p => {
            if (p.id !== this.playerId) this.peers.set(p.id, p);
          });
        }
        if (this.callbacks.onRoomJoined) {
          this.callbacks.onRoomJoined(msg);
        }
        break;

      case 'game_started':
        this.status = 'PLAYING';
        if (this.callbacks.onGameStarted) {
          this.callbacks.onGameStarted(msg);
        }
        break;

      case 'room_reset':
        this.status = 'WAITING';
        this.seed = msg.seed;
        this.peers.forEach(p => { p.isAlive = true; });
        if (this.callbacks.onRoomReset) {
          this.callbacks.onRoomReset(msg);
        }
        break;

      case 'player_joined':
        if (msg.player && msg.player.id !== this.playerId) {
          this.peers.set(msg.player.id, msg.player);
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

  startGame() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'start_game' }));
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
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.peers.clear();
  }
}

export const multiplayer = new MultiplayerClient();
