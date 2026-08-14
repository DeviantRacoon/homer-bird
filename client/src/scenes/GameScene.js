import Phaser from 'phaser';
import { sounds } from '../utils/soundFx.js';
import {
  submitScore,
  isMultiplayerActive,
  getStoredNickname
} from '../utils/leaderboardApi.js';
import { multiplayer } from '../utils/multiplayerClient.js';

function createSeededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    return (s = (s * 16807) % 2147483647) / 2147483647;
  };
}

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    this.gameState = 'READY'; // READY | PLAYING | GAMEOVER
    this.isReady = false;
    this.score = 0;
    this.highScore = parseInt(localStorage.getItem('homer_bird_highscore') || '0', 10);
    this.lastPosSentTime = 0;
    this.peerSprites = new Map();

    const gameW = this.scale.width;
    const gameH = this.scale.height;

    // Parámetros de física y progresión
    this.baseSpeed = 165;
    this.currentSpeed = this.baseSpeed;
    this.baseGap = Math.round(gameH * 0.22);
    this.currentGap = this.baseGap;
    this.spawnInterval = 1500;

    // 1. Fondo Infinito de Springfield
    this.bgScale = gameH / 784;
    this.bg = this.add.tileSprite(
      gameW / 2,
      gameH / 2,
      gameW / this.bgScale,
      784,
      'springfield-bg'
    );
    this.bg.setScale(this.bgScale);

    // 2. Grupo de Obstáculos (Pipes)
    this.pipes = this.physics.add.group();

    // 3. Suelo y Techo
    const groundHeight = 110 * this.bgScale;
    const groundY = gameH - (groundHeight / 2);
    this.ground = this.add.zone(gameW / 2, groundY, gameW, groundHeight);
    this.physics.add.existing(this.ground, true);

    this.ceiling = this.add.zone(gameW / 2, -10, gameW, 20);
    this.physics.add.existing(this.ceiling, true);

    // 4. Interfaz & Audio (Crear UI primero para tener los contenedores y textos listos)
    this.createUI();
    this.initAudio();
    this.syncDashboard();

    // 5. Modo Multijugador en Vivo (WebSockets)
    if (isMultiplayerActive()) {
      this.initMultiplayer(gameW, gameH);
    }

    // 6. Personaje Homero (Jugador Local)
    this.homer = this.physics.add.sprite(gameW * 0.25, gameH * 0.45, 'homer', 0);
    this.homer.setScale(0.24);
    this.homer.setCircle(70, 58, 60);
    this.homer.body.allowGravity = false;
    this.homer.play('homer-fly');
    this.homer.setDepth(15);

    // Nametag flotante para el jugador local en la sala de espera
    this.localTag = this.add.text(this.homer.x, this.homer.y - 26, '⭐ Tú', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '8px',
      color: '#f8fafc',
      stroke: '#0f172a',
      strokeThickness: 3,
      backgroundColor: '#0f172ab3',
      padding: { x: 5, y: 3 }
    }).setOrigin(0.5).setDepth(16).setVisible(isMultiplayerActive());

    // Flotación en pantalla de inicio
    this.readyTween = this.tweens.add({
      targets: this.homer,
      y: gameH * 0.42,
      duration: 550,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // 7. Partículas
    this.particles = this.add.particles(0, 0, 'particle-spark', {
      speed: { min: 80, max: 220 },
      scale: { start: 1, end: 0 },
      lifespan: 600,
      gravityY: 450,
      emitting: false
    }).setDepth(20);

    // 8. Colisiones
    this.physics.add.collider(this.homer, this.ground, () => this.handleHitGround(), null, this);
    this.physics.add.collider(this.homer, this.ceiling, () => this.homer.setVelocityY(20), null, this);
    this.physics.add.overlap(this.homer, this.pipes, () => this.handleHitPipe(), null, this);

    // 9. Controles
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.upKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.input.on('pointerdown', () => this.flap());
  }

  initMultiplayer(gameW, gameH) {
    const roomCode = localStorage.getItem('homer_bird_room_code');
    if (!roomCode) {
      if (this.instructText) {
        this.instructText.setText('SELECCIONA O CREA UNA SALA\nEN EL PANEL LATERAL');
      }
      return;
    }
    const nickname = getStoredNickname();

    multiplayer.connect(roomCode, nickname, {
      onNoRoomSelected: () => {
        if (this.instructText) {
          this.instructText.setText('SELECCIONA O CREA UNA SALA\nEN EL PANEL LATERAL');
        }
      },
      onJoinError: (err) => {
        if (this.statusText) {
          this.statusText.setText(`⚠️ ${err.code === 'SERVERLESS_WS_UNSUPPORTED' ? 'MODO OFFLINE' : 'SALA BLOQUEADA'}`);
          this.statusText.setColor('#ef4444');
        }
        if (this.readyContainer) {
          const banner = this.add.text(gameW / 2, gameH * 0.28, `⚠️ ${err.message || 'SALA BLOQUEADA'}`, {
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '8px',
            color: '#fef08a',
            align: 'center',
            backgroundColor: '#1e1b4b',
            padding: { x: 10, y: 8 },
            lineSpacing: 6,
            wordWrap: { width: gameW - 48, useAdvancedWrap: true }
          }).setOrigin(0.5).setDepth(40);
          this.time.delayedCall(4500, () => banner.destroy());
        }
      },
      onRoomJoined: (msg) => {
        this.rng = createSeededRandom(msg.seed || 12345);
        if (msg.players) {
          msg.players.forEach(p => this.addPeerSprite(p, gameW, gameH));
        }
        this.updateReadyUI();
      },
      onPlayerJoined: (player) => {
        this.addPeerSprite(player, gameW, gameH);
        this.updateReadyUI();
      },
      onPlayerReady: (msg) => {
        const peer = this.peerSprites.get(msg.id);
        if (peer && peer.sprite) {
          peer.sprite.play('homer-jump');
          peer.sprite.once('animationcomplete', () => {
            if (this.gameState === 'READY' || this.gameState === 'COUNTDOWN') peer.sprite.play('homer-fly');
          });
        }
        this.updateReadyUI();
      },
      onCountdownStarted: (msg) => {
        if (msg.seed) {
          this.rng = createSeededRandom(msg.seed);
        }
        this.gameState = 'COUNTDOWN';
        if (this.readyContainer) this.readyContainer.setVisible(false);
        if (this.localTag) this.localTag.setVisible(false);

        // Mover a todos los jugadores ordenadamente a la línea de salida
        this.tweens.add({
          targets: this.homer,
          x: gameW * 0.25,
          y: gameH * 0.45,
          duration: 300,
          ease: 'Cubic.easeOut'
        });

        this.peerSprites.forEach((peer) => {
          if (peer.sprite) {
            this.tweens.add({
              targets: peer.sprite,
              x: gameW * 0.25,
              y: gameH * 0.45,
              duration: 300,
              ease: 'Cubic.easeOut'
            });
          }
          if (peer.tag) {
            peer.tag.setText(`${peer.nickname} (0)`);
            peer.tag.setColor('#f8fafc');
            this.tweens.add({
              targets: peer.tag,
              x: gameW * 0.25,
              y: gameH * 0.45 - 24,
              duration: 300,
              ease: 'Cubic.easeOut'
            });
          }
        });

        this.showCountdownNumber('3', '#fed90f');
      },
      onCountdownTick: (msg) => {
        const count = msg.count;
        const colors = { 2: '#facc15', 1: '#fb923c' };
        this.showCountdownNumber(String(count), colors[count] || '#fed90f');
      },
      onGameStarted: (msg) => {
        if (msg.seed) {
          this.rng = createSeededRandom(msg.seed);
        }
        this.showCountdownNumber('¡A VOLAR!', '#4ade80');
        this.time.delayedCall(600, () => {
          if (this.countdownText) this.countdownText.setVisible(false);
        });
        if (this.gameState === 'READY' || this.gameState === 'COUNTDOWN') {
          this.startGame();
        }
      },
      onRoomReset: (msg) => {
        this.isReady = false;
        this.gameState = 'READY';
        if (this.countdownText) this.countdownText.setVisible(false);
        if (this.readyContainer) this.readyContainer.setVisible(true);
        if (this.localTag) this.localTag.setVisible(true);
        if (msg.seed) {
          this.rng = createSeededRandom(msg.seed);
        }
        this.updateReadyUI();
      },
      onPlayerPos: (data) => {
        const peer = this.peerSprites.get(data.id);
        if (peer) {
          peer.targetY = data.y;
          peer.targetAngle = data.a;
          if (peer.tag && this.gameState === 'PLAYING') {
            peer.tag.setText(`${peer.nickname} (${data.score || 0})`);
          }
        }
      },
      onPlayerJump: (id) => {
        const peer = this.peerSprites.get(id);
        if (peer && peer.sprite) {
          peer.sprite.play('homer-jump');
          peer.sprite.once('animationcomplete', () => {
            if (peer.sprite) peer.sprite.play('homer-fly');
          });
        }
      },
      onPlayerDied: (data) => {
        const peer = this.peerSprites.get(data.id);
        if (peer && peer.sprite) {
          this.particles.emitParticleAt(peer.sprite.x, peer.sprite.y, 12);
          peer.sprite.setAlpha(0.3);
          peer.sprite.play('homer-crash-anim');
          if (peer.tag) peer.tag.setText(`💀 ${data.nickname} (${data.score})`);
        }
      },
      onPlayerLeft: (id) => {
        const peer = this.peerSprites.get(id);
        if (peer) {
          if (peer.sprite) peer.sprite.destroy();
          if (peer.tag) peer.tag.destroy();
          this.peerSprites.delete(id);
        }
        this.updateReadyUI();
      }
    });
  }

  addPeerSprite(player, gameW, gameH) {
    if (this.peerSprites.has(player.id)) return;

    const sprite = this.add.sprite(gameW * 0.25, player.y || gameH * 0.45, 'homer', 0);
    sprite.setScale(0.24);
    sprite.setAlpha(0.85);
    if (player.color) sprite.setTint(player.color);
    sprite.play('homer-fly');
    sprite.setDepth(8);

    const initialTag = this.gameState === 'READY'
      ? `${player.isReady ? '✅' : '⏳'} ${player.nickname}`
      : `${player.nickname} (${player.score || 0})`;

    const tag = this.add.text(sprite.x, sprite.y - 26, initialTag, {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '8px',
      color: player.isReady ? '#4ade80' : '#f8fafc',
      stroke: '#0f172a',
      strokeThickness: 3,
      backgroundColor: '#0f172ab3',
      padding: { x: 5, y: 3 }
    }).setOrigin(0.5).setDepth(9);

    this.peerSprites.set(player.id, {
      id: player.id,
      sprite,
      tag,
      nickname: player.nickname,
      color: player.color,
      targetY: sprite.y,
      targetAngle: 0
    });

    this.repositionLobbyAvatars();
  }

  repositionLobbyAvatars() {
    if (this.gameState !== 'READY' || !isMultiplayerActive()) return;

    const gameW = this.scale.width;
    const gameH = this.scale.height;
    const total = 1 + this.peerSprites.size;
    const rowY = gameH * 0.28;

    const peersList = Array.from(this.peerSprites.values());
    const allAvatars = [
      {
        isLocal: true,
        sprite: this.homer,
        tag: this.localTag,
        nickname: getStoredNickname() || 'Homero',
        isReady: this.isReady
      },
      ...peersList.map(p => ({
        isLocal: false,
        sprite: p.sprite,
        tag: p.tag,
        nickname: p.nickname,
        isReady: multiplayer.peers.get(p.id)?.isReady || false
      }))
    ];

    allAvatars.forEach((p, idx) => {
      let posX;
      let posY = rowY + ((idx % 2 === 1) ? -10 : 8);

      if (total === 1) {
        posX = gameW * 0.5;
        posY = rowY;
      } else if (total === 2) {
        posX = gameW * (idx === 0 ? 0.35 : 0.65);
        posY = rowY;
      } else if (total === 3) {
        posX = gameW * (0.2 + idx * 0.3);
      } else {
        const spacing = (gameW * 0.72) / (total - 1);
        posX = gameW * 0.14 + idx * spacing;
      }

      if (p.sprite) {
        this.tweens.add({
          targets: p.sprite,
          x: posX,
          y: posY,
          duration: 250,
          ease: 'Cubic.easeOut'
        });
      }

      if (p.tag) {
        p.tag.setVisible(true);
        const statusIcon = p.isReady ? '✅' : '⏳';
        const displayName = p.isLocal ? `${p.nickname} (Tú)` : p.nickname;
        p.tag.setText(`${statusIcon} ${displayName}`);
        p.tag.setColor(p.isReady ? '#4ade80' : '#f8fafc');

        this.tweens.add({
          targets: p.tag,
          x: posX,
          y: posY - 26,
          duration: 250,
          ease: 'Cubic.easeOut'
        });
      }
    });
  }

  updateReadyUI() {
    if (!isMultiplayerActive() || !this.instructText || this.gameState !== 'READY') return;

    const roomCode = localStorage.getItem('homer_bird_room_code');
    if (!roomCode) {
      this.instructText.setText('SELECCIONA O CREA UNA SALA\nEN EL PANEL LATERAL');
      this.instructText.setColor('#ffffff');
      if (this.localTag) this.localTag.setVisible(false);
      return;
    }

    let readyCount = this.isReady ? 1 : 0;
    const peerRoster = [];

    const localNick = getStoredNickname() || 'Homero';
    peerRoster.push(`⭐ ${(localNick + ' (Tú)').slice(0, 14).padEnd(14, ' ')} ${this.isReady ? '✅ LISTO' : '⏳ ESPERA'}`);

    this.peerSprites.forEach((peer, id) => {
      const peerData = multiplayer.peers.get(id);
      const isPeerReady = peerData?.isReady || false;
      if (isPeerReady) readyCount++;
      const nick = (peer.nickname || 'Jugador').slice(0, 14).padEnd(14, ' ');
      peerRoster.push(`👤 ${nick} ${isPeerReady ? '✅ LISTO' : '⏳ ESPERA'}`);
    });

    const totalCount = 1 + this.peerSprites.size;
    const rosterLines = peerRoster.slice(0, 4).join('\n');
    const callToAction = this.isReady ? '✅ ¡LISTO! ESPERANDO A TODOS...' : '👉 SALTA PARA ESTAR LISTO';

    this.instructText.setText(
      `SALA: ${roomCode} (${readyCount}/${totalCount} LISTOS)\n\n` +
      `${rosterLines}\n\n` +
      `${callToAction}`
    );
    this.instructText.setColor(this.isReady ? '#4ade80' : '#ffffff');

    this.repositionLobbyAvatars();
  }

  initAudio() {
    try {
      if (this.sound && this.cache.audio.exists('homer-jump')) {
        this.jumpSound = this.sound.add('homer-jump', {
          volume: 1.6,
          rate: 1.2
        });
      }
      if (this.sound && this.cache.audio.exists('homer-die')) {
        this.dieSound = this.sound.add('homer-die', {
          volume: 1.6,
          rate: 1.0
        });
      }
    } catch (e) {
      console.warn('Audio init warning:', e);
    }
  }

  createUI() {
    const gameW = this.scale.width;
    const gameH = this.scale.height;

    // Marcador central
    this.scoreText = this.add.text(gameW / 2, 65, '0', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '36px',
      color: '#ffffff',
      stroke: '#0f172a',
      strokeThickness: 6
    }).setOrigin(0.5).setDepth(20).setVisible(false);

    // Pantalla de Inicio / Ready
    this.readyContainer = this.add.container(gameW / 2, gameH * 0.18).setDepth(20);
    const modeLabel = isMultiplayerActive() ? '🌐 MULTIJUGADOR EN VIVO' : '🕹️ MODO SOLO';
    const titleText = this.add.text(0, -40, 'HOMER BIRD', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '22px',
      color: '#facc15',
      stroke: '#0f172a',
      strokeThickness: 5
    }).setOrigin(0.5);

    const subText = this.add.text(0, -15, modeLabel, {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '9px',
      color: '#38bdf8'
    }).setOrigin(0.5);

    const savedRoom = localStorage.getItem('homer_bird_room_code');
    const defaultInstruct = isMultiplayerActive()
      ? (savedRoom
          ? `SALA: ${savedRoom} (0/1 LISTOS)\n\n⭐ Homero (Tú)  ⏳ ESPERA\n\n👉 SALTA PARA ESTAR LISTO`
          : 'SELECCIONA O CREA UNA SALA\nEN EL PANEL LATERAL')
      : 'TOCA O ESPACIO\nPARA VOLAR';

    this.instructText = this.add.text(0, 205, defaultInstruct, {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '9px',
      color: '#ffffff',
      align: 'center',
      lineSpacing: 8,
      stroke: '#0f172a',
      strokeThickness: 3,
      backgroundColor: '#0f172ae0',
      padding: { x: 14, y: 12 }
    }).setOrigin(0.5);

    this.readyContainer.add([titleText, subText, this.instructText]);

    // Pantalla Game Over
    this.gameOverContainer = this.add.container(gameW / 2, gameH * 0.46).setDepth(30).setVisible(false);

    const panelBg = this.add.graphics();
    panelBg.fillStyle(0x0f172a, 0.92);
    panelBg.fillRoundedRect(-140, -125, 280, 250, 16);
    panelBg.lineStyle(4, 0xfacc15, 1);
    panelBg.strokeRoundedRect(-140, -125, 280, 250, 16);

    const goTitle = this.add.text(0, -90, 'D\'OH!', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '28px',
      color: '#ef4444',
      stroke: '#ffffff',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.finalScoreText = this.add.text(0, -40, 'SCORE: 0', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '14px',
      color: '#f8fafc'
    }).setOrigin(0.5);

    this.bestScoreText = this.add.text(0, -10, 'BEST: 0', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '14px',
      color: '#facc15'
    }).setOrigin(0.5);

    this.statusText = this.add.text(0, 20, isMultiplayerActive() ? '🌐 MULTIJUGADOR' : '', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '10px',
      color: '#38bdf8',
      align: 'center'
    }).setOrigin(0.5);

    this.restartBtn = this.add.text(0, 72, 'JUGAR DE NUEVO', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#22c55e',
      padding: { x: 14, y: 10 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.restartBtn.on('pointerdown', (e) => {
      e.event?.stopPropagation();
      this.restartGame();
    });

    this.gameOverContainer.add([panelBg, goTitle, this.finalScoreText, this.bestScoreText, this.statusText, this.restartBtn]);

    // 4. Texto de Cuenta Regresiva Sincronizada (3, 2, 1... ¡YA!)
    this.countdownText = this.add.text(gameW / 2, gameH * 0.36, '', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '44px',
      color: '#facc15',
      stroke: '#0f172a',
      strokeThickness: 8,
      align: 'center'
    }).setOrigin(0.5).setDepth(45).setVisible(false);
  }

  showCountdownNumber(text, color = '#facc15') {
    if (!this.countdownText) return;
    this.countdownText.setText(text);
    this.countdownText.setColor(color);
    this.countdownText.setScale(0.4);
    this.countdownText.setAlpha(1);
    this.countdownText.setVisible(true);

    this.tweens.killTweensOf(this.countdownText);
    this.tweens.add({
      targets: this.countdownText,
      scale: 1.25,
      duration: 280,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: this.countdownText,
          scale: 1.0,
          alpha: 0.85,
          duration: 350
        });
      }
    });

    try {
      sounds.point();
    } catch {}
  }

  update(time, delta) {
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.upKey)) {
      this.flap();
    }

    if (this.gameState === 'PLAYING') {
      const speedPxPerSec = this.currentSpeed;
      this.bg.tilePositionX += (speedPxPerSec * (delta / 1000)) / this.bgScale;

      const elapsed = Date.now() - this.gameStartTime;

      // Transmisión multijugador WebSocket (cada 60ms)
      if (isMultiplayerActive() && elapsed - this.lastPosSentTime >= 60) {
        this.lastPosSentTime = elapsed;
        multiplayer.sendPosition(this.homer.y, this.homer.body.velocity.y, this.homer.angle, this.score);
      }

      // Interpolación de rivales en vivo (Multiplayer)
      this.peerSprites.forEach((peer) => {
        if (peer.sprite) {
          peer.sprite.y = Phaser.Math.Linear(peer.sprite.y, peer.targetY, 0.35);
          peer.sprite.setAngle(peer.targetAngle);
          if (peer.tag) peer.tag.setPosition(peer.sprite.x, peer.sprite.y - 24);
        }
      });

      // Rotación de Homero local
      if (this.homer.body.velocity.y < 0) {
        this.homer.setAngle(Math.max(-20, this.homer.angle - 4));
      } else {
        this.homer.setAngle(Math.min(75, this.homer.angle + 3));
      }

      // Puntuación y reciclaje de tubos
      this.pipes.getChildren().forEach(pipe => {
        if (!pipe.scored && pipe.pipeType === 'bottom' && pipe.x + pipe.width / 2 < this.homer.x) {
          pipe.scored = true;
          this.addScore();
        }

        if (pipe.x < -100) {
          this.pipes.killAndHide(pipe);
          pipe.body.enable = false;
          pipe.destroy();
        }
      });
    }
  }

  flap() {
    if (this.gameState === 'COUNTDOWN') {
      this.playHomerSound();
      return;
    }

    if (this.gameState === 'READY') {
      if (!isMultiplayerActive()) {
        this.startGame();
        return;
      }

      // En multijugador, verificar si ya se seleccionó una sala
      const currentRoomCode = localStorage.getItem('homer_bird_room_code');
      if (!currentRoomCode) {
        this.playHomerSound();
        const roomInput = document.getElementById('room-code-input') || document.getElementById('mob-room-code-input');
        if (roomInput) roomInput.focus();
        return;
      }

      // El salto confirma el estado "LISTO"
      if (!this.isReady) {
        this.isReady = true;
        this.homer.play('homer-jump');
        this.homer.once('animationcomplete', () => {
          if (this.gameState === 'READY') this.homer.play('homer-fly');
        });
        this.playHomerSound();
        multiplayer.sendReady();
        this.updateReadyUI();
      } else {
        // Ya estaba listo, pero hace el efecto de aletazo visual
        this.homer.play('homer-jump');
        this.homer.once('animationcomplete', () => {
          if (this.gameState === 'READY') this.homer.play('homer-fly');
        });
        this.playHomerSound();
      }
      return;
    }

    if (this.gameState === 'PLAYING') {
      this.homer.setVelocityY(-320);
      this.homer.setAngle(-20);
      this.playHomerSound();

      if (isMultiplayerActive()) {
        multiplayer.sendJump();
      }

      this.homer.play('homer-jump');
      this.homer.once('animationcomplete', () => {
        if (this.gameState === 'PLAYING') {
          this.homer.play('homer-fly');
        }
      });
    }
  }

  playHomerSound() {
    try {
      if (this.jumpSound) {
        this.jumpSound.stop();
        this.jumpSound.play({ volume: 1.6, rate: 1.2 });
      } else if (this.sound && this.cache.audio.exists('homer-jump')) {
        this.jumpSound = this.sound.add('homer-jump', { volume: 1.6, rate: 1.2 });
        this.jumpSound.play();
      } else {
        sounds.jump();
      }
    } catch {
      sounds.jump();
    }
  }

  startGame() {
    this.gameState = 'PLAYING';
    this.gameStartTime = Date.now();
    this.lastPosSentTime = 0;

    this.readyTween.stop();
    this.readyContainer.setVisible(false);
    this.scoreText.setVisible(true);

    // Actualizar etiquetas de rivales para mostrar puntajes en juego
    this.peerSprites.forEach((peer) => {
      if (peer.tag) peer.tag.setText(`${peer.nickname} (0)`);
    });

    this.homer.body.allowGravity = true;
    this.homer.body.setGravityY(920);
    this.homer.setVelocityY(-320);
    this.playHomerSound();

    this.pipeTimer = this.time.addEvent({
      delay: this.spawnInterval,
      callback: this.spawnPipePair,
      callbackScope: this,
      loop: true
    });

    this.spawnPipePair();
  }

  spawnPipePair() {
    if (this.gameState !== 'PLAYING') return;

    const gameW = this.scale.width;
    const gameH = this.scale.height;
    const groundLimit = gameH - (110 * this.bgScale);

    const minY = 130;
    const maxY = groundLimit - this.currentGap - 60;

    let gapCenterY;
    if (this.rng) {
      gapCenterY = Math.floor(minY + (this.currentGap / 2) + this.rng() * (maxY - minY));
    } else {
      gapCenterY = Phaser.Math.Between(minY + (this.currentGap / 2), maxY + (this.currentGap / 2));
    }

    const gap = this.currentGap;
    const spawnX = gameW + 40;

    // Tubo Superior
    const topPipe = this.pipes.create(spawnX, gapCenterY - (gap / 2), 'pipe');
    topPipe.setOrigin(0.5, 1);
    topPipe.setFlipY(true);
    topPipe.body.allowGravity = false;
    topPipe.body.immovable = true;
    topPipe.body.setVelocityX(-this.currentSpeed);
    topPipe.body.setSize(56, 480);
    topPipe.pipeType = 'top';

    // Tubo Inferior
    const bottomPipe = this.pipes.create(spawnX, gapCenterY + (gap / 2), 'pipe');
    bottomPipe.setOrigin(0.5, 0);
    bottomPipe.body.allowGravity = false;
    bottomPipe.body.immovable = true;
    bottomPipe.body.setVelocityX(-this.currentSpeed);
    bottomPipe.body.setSize(56, 480);
    bottomPipe.pipeType = 'bottom';
    bottomPipe.scored = false;
  }

  addScore() {
    this.score++;
    this.scoreText.setText(this.score.toString());
    sounds.point();

    this.particles.emitParticleAt(this.homer.x, this.homer.y, 8);

    this.tweens.add({
      targets: this.scoreText,
      scale: 1.25,
      duration: 100,
      yoyo: true
    });

    if (this.score % 3 === 0 && this.currentSpeed < 240) {
      this.currentSpeed += 6;
      this.currentGap = Math.max(105, this.currentGap - 2);
      this.pipes.setVelocityX(-this.currentSpeed);
    }

    this.syncDashboard();
  }

  handleHitPipe() {
    if (this.gameState !== 'PLAYING') return;
    sounds.hit();
    this.cameras.main.shake(180, 0.02);
    this.gameOver();
  }

  handleHitGround() {
    if (this.gameState === 'GAMEOVER') return;
    if (this.gameState === 'PLAYING') {
      sounds.hit();
      this.cameras.main.shake(200, 0.025);
    }
    this.gameOver();
  }

  async gameOver() {
    if (this.gameState === 'GAMEOVER') return;
    this.gameState = 'GAMEOVER';

    if (this.jumpSound) this.jumpSound.stop();

    if (this.dieSound) {
      this.dieSound.stop();
      this.dieSound.play({ volume: 1.6, rate: 1.0 });
    } else {
      sounds.die();
    }

    if (this.pipeTimer) this.pipeTimer.remove();
    this.pipes.setVelocityX(0);

    this.homer.play('homer-crash-anim');
    this.homer.setVelocityY(160);
    this.homer.setAngle(30);

    this.particles.emitParticleAt(this.homer.x, this.homer.y, 18);

    if (isMultiplayerActive()) {
      multiplayer.sendDeath(this.score);
    }

    const isNewBest = this.score > this.highScore;
    if (isNewBest) {
      this.highScore = this.score;
      localStorage.setItem('homer_bird_highscore', this.highScore.toString());
    }

    this.finalScoreText.setText(`SCORE: ${this.score}`);
    this.bestScoreText.setText(`BEST: ${this.highScore}`);
    this.scoreText.setVisible(false);

    this.syncDashboard();

    // Enviar puntuación
    if (this.score > 0) {
      const durationMs = this.gameStartTime ? Date.now() - this.gameStartTime : 3000;
      submitScore(this.score, durationMs).then((res) => {
        if (res && res.success && res.rank) {
          this.finalScoreText.setText(`SCORE: ${this.score} (#${res.rank})`);
        }
        window.dispatchEvent(new CustomEvent('leaderboard-updated'));
      });
    }

    // 2 segundos de espera
    this.time.delayedCall(2000, () => {
      this.gameOverContainer.setVisible(true);
      this.gameOverContainer.setScale(0.7);
      this.tweens.add({
        targets: this.gameOverContainer,
        scale: 1,
        duration: 250,
        ease: 'Back.easeOut'
      });
    });
  }

  syncDashboard() {
    const scoreEl = document.getElementById('dash-current-score');
    const bestEl = document.getElementById('dash-best-score');
    const dangerEl = document.getElementById('dash-danger-level');
    const dangerFill = document.getElementById('dash-danger-bar');

    if (scoreEl) scoreEl.textContent = this.score.toString();
    if (bestEl) bestEl.textContent = this.highScore.toString();
    if (dangerEl && dangerFill) {
      const dangerScale = Math.min(1, Math.max(0.1, this.score * 0.05));
      dangerFill.style.transform = `scaleX(${dangerScale})`;
      if (this.score < 5) {
        dangerEl.textContent = 'ESTABLE';
        dangerEl.className = 'status-badge status-green';
      } else if (this.score < 15) {
        dangerEl.textContent = 'PRECAUCIÓN';
        dangerEl.className = 'status-badge status-yellow';
      } else {
        dangerEl.textContent = '¡MELTDOWN CRÍTICO!';
        dangerEl.className = 'status-badge status-red';
      }
    }
  }

  restartGame() {
    if (this.jumpSound) this.jumpSound.stop();
    if (this.dieSound) this.dieSound.stop();
    sounds.swoosh();
    this.scene.restart();
  }
}
