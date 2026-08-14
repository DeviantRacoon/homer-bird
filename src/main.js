import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import {
  getStoredNickname,
  setStoredNickname,
  getRandomSpringfieldName,
  fetchLeaderboard,
  fetchActiveRooms,
  getGameMode,
  setGameMode
} from './utils/leaderboardApi.js';

function getGameDimensions() {
  const isMobile = window.innerWidth <= 768;
  const baseWidth = 360;
  if (isMobile) {
    const ratio = window.innerHeight / window.innerWidth;
    const baseHeight = Math.max(640, Math.round(baseWidth * ratio));
    return { width: baseWidth, height: baseHeight };
  }
  return { width: 360, height: 640 };
}

const dimensions = getGameDimensions();

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: dimensions.width,
  height: dimensions.height,
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  scene: [BootScene, GameScene]
};

let gameInstance = null;
let activeTab = 'allTime';
let cachedLeaderboardData = null;

// ==========================================================================
// UI Controllers: Profile, Modes, Leaderboards & Mobile Hub
// ==========================================================================

function setupUI() {
  const displayNick = document.getElementById('display-nickname');
  const openModalBtn = document.getElementById('open-profile-btn');
  const profileModal = document.getElementById('profile-modal');
  const closeModalBtn = document.getElementById('close-profile-btn');
  const saveModalBtn = document.getElementById('save-profile-btn');
  const randomNickBtn = document.getElementById('random-nick-btn');
  const nickInput = document.getElementById('nickname-input');

  // Mobile Hub Modal
  const mobileHubModal = document.getElementById('mobile-arcade-hub-modal');
  const openMobileHubBtn = document.getElementById('open-mobile-hub-btn');
  const closeMobileHubBtn = document.getElementById('close-mobile-hub-btn');
  const mobPlayNowBtn = document.getElementById('mob-play-now-btn');

  // Mode Buttons Desktop & Mobile
  const modeBtnMulti = document.getElementById('mode-btn-multi');
  const modeBtnSingle = document.getElementById('mode-btn-single');
  const mobBtnMulti = document.getElementById('mob-btn-multi');
  const mobBtnSingle = document.getElementById('mob-btn-single');

  const multiCardModule = document.getElementById('multi-card-module');
  const mobMultiCardModule = document.getElementById('mob-multi-card-module');
  const cabinetModeTag = document.getElementById('cabinet-mode-tag');

  // Room Inputs Desktop & Mobile
  const roomCodeInput = document.getElementById('room-code-input');
  const joinRoomBtn = document.getElementById('join-room-btn');
  const mobRoomCodeInput = document.getElementById('mob-room-code-input');
  const mobJoinRoomBtn = document.getElementById('mob-join-room-btn');

  const refreshRoomsBtn = document.getElementById('refresh-rooms-btn');
  const mobRefreshRoomsBtn = document.getElementById('mob-refresh-rooms-btn');

  // Leaderboard Tabs
  const tabAllTime = document.getElementById('tab-alltime');
  const tabToday = document.getElementById('tab-today');
  const mobTabAllTime = document.getElementById('mob-tab-alltime');
  const mobTabToday = document.getElementById('mob-tab-today');

  // 1. Inicializar Nickname
  const currentNick = getStoredNickname();
  if (displayNick) displayNick.textContent = currentNick;

  // 2. Sincronizar Modo de Juego
  function updateModeUI(mode) {
    if (modeBtnSingle) modeBtnSingle.classList.toggle('active', mode === 'single');
    if (modeBtnMulti) modeBtnMulti.classList.toggle('active', mode === 'multiplayer');
    if (mobBtnSingle) mobBtnSingle.classList.toggle('active', mode === 'single');
    if (mobBtnMulti) mobBtnMulti.classList.toggle('active', mode === 'multiplayer');

    if (multiCardModule) multiCardModule.style.display = mode === 'multiplayer' ? 'block' : 'none';
    if (mobMultiCardModule) mobMultiCardModule.style.display = mode === 'multiplayer' ? 'block' : 'none';

    if (cabinetModeTag) {
      cabinetModeTag.textContent = mode === 'multiplayer' ? '🌐 MULTI' : '🕹️ SOLO';
    }
  }

  const currentMode = getGameMode();
  updateModeUI(currentMode);

  function handleModeChange(mode) {
    setGameMode(mode);
    updateModeUI(mode);
    restartPhaserScene();
    if (mode === 'multiplayer') {
      loadActiveRooms();
    }
  }

  if (modeBtnSingle) modeBtnSingle.addEventListener('click', () => handleModeChange('single'));
  if (modeBtnMulti) modeBtnMulti.addEventListener('click', () => handleModeChange('multiplayer'));
  if (mobBtnSingle) mobBtnSingle.addEventListener('click', () => handleModeChange('single'));
  if (mobBtnMulti) mobBtnMulti.addEventListener('click', () => handleModeChange('multiplayer'));

  // 3. Unirse a Salas
  function handleJoinRoom(code) {
    const cleanCode = code.trim().toUpperCase() || 'SPRINGFIELD';
    localStorage.setItem('homer_bird_room_code', cleanCode);
    setGameMode('multiplayer');
    updateModeUI('multiplayer');
    restartPhaserScene();
    loadActiveRooms();
    if (mobileHubModal && mobileHubModal.open) {
      mobileHubModal.close();
    }
  }

  if (joinRoomBtn && roomCodeInput) {
    joinRoomBtn.addEventListener('click', () => handleJoinRoom(roomCodeInput.value));
  }

  if (mobJoinRoomBtn && mobRoomCodeInput) {
    mobJoinRoomBtn.addEventListener('click', () => handleJoinRoom(mobRoomCodeInput.value));
  }

  if (refreshRoomsBtn) refreshRoomsBtn.addEventListener('click', () => loadActiveRooms());
  if (mobRefreshRoomsBtn) mobRefreshRoomsBtn.addEventListener('click', () => loadActiveRooms());

  // 4. Mobile Hub Modal Open/Close
  if (openMobileHubBtn && mobileHubModal) {
    openMobileHubBtn.addEventListener('click', () => {
      mobileHubModal.showModal();
      loadLeaderboard();
      loadActiveRooms();
    });
  }

  if (closeMobileHubBtn && mobileHubModal) {
    closeMobileHubBtn.addEventListener('click', () => mobileHubModal.close());
  }

  if (mobPlayNowBtn && mobileHubModal) {
    mobPlayNowBtn.addEventListener('click', () => {
      mobileHubModal.close();
    });
  }

  // 5. Perfil Modal
  if (openModalBtn && profileModal) {
    openModalBtn.addEventListener('click', () => {
      if (nickInput) nickInput.value = getStoredNickname();
      profileModal.showModal();
    });
  }

  if (closeModalBtn && profileModal) {
    closeModalBtn.addEventListener('click', () => profileModal.close());
  }

  if (randomNickBtn && nickInput) {
    randomNickBtn.addEventListener('click', () => {
      nickInput.value = getRandomSpringfieldName();
    });
  }

  if (saveModalBtn && profileModal) {
    saveModalBtn.addEventListener('click', () => {
      const newNick = setStoredNickname(nickInput.value);
      if (displayNick) displayNick.textContent = newNick;
      profileModal.close();
      renderLeaderboards();
      restartPhaserScene();
    });
  }

  // 6. Tabs de Leaderboard
  function setTab(tab) {
    activeTab = tab;
    [tabAllTime, mobTabAllTime].forEach(t => t && t.classList.toggle('active', tab === 'allTime'));
    [tabToday, mobTabToday].forEach(t => t && t.classList.toggle('active', tab === 'today'));
    renderLeaderboards();
  }

  if (tabAllTime) tabAllTime.addEventListener('click', () => setTab('allTime'));
  if (tabToday) tabToday.addEventListener('click', () => setTab('today'));
  if (mobTabAllTime) mobTabAllTime.addEventListener('click', () => setTab('allTime'));
  if (mobTabToday) mobTabToday.addEventListener('click', () => setTab('today'));

  // Carga inicial
  loadLeaderboard();
  loadActiveRooms();
  window.addEventListener('leaderboard-updated', () => loadLeaderboard());
}

async function loadActiveRooms() {
  const containers = [
    document.getElementById('rooms-list-container'),
    document.getElementById('mob-rooms-list-container')
  ].filter(Boolean);

  if (containers.length === 0) return;

  const rooms = await fetchActiveRooms();

  containers.forEach(container => {
    if (rooms.length === 0) {
      container.innerHTML = '<div class="lb-loading">No hay salas activas. ¡Ingresa un código para crear una!</div>';
      return;
    }

    container.innerHTML = rooms
      .map(r => {
        const isPlaying = r.status === 'PLAYING';
        const statusLabel = isPlaying ? '🔴 EN JUEGO' : '🟢 ESPERANDO';
        const statusClass = isPlaying ? 'state-playing' : 'state-waiting';

        return `
          <div class="room-item-row">
            <div>
              <span class="room-code-badge">${escapeHTML(r.code)}</span>
              <span style="font-size: 0.68rem; color: #94a3b8; margin-left: 4px;">(${r.playerCount} jug.)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="room-state-tag ${statusClass}">${statusLabel}</span>
              <button class="btn-quick-join" data-code="${escapeHTML(r.code)}" ${isPlaying ? 'disabled title="Partida en curso"' : ''}>
                ${isPlaying ? 'BLOQUEADA' : 'ENTRAR'}
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('.btn-quick-join:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        const roomCodeInput = document.getElementById('room-code-input');
        const mobRoomCodeInput = document.getElementById('mob-room-code-input');
        if (roomCodeInput) roomCodeInput.value = code;
        if (mobRoomCodeInput) mobRoomCodeInput.value = code;

        localStorage.setItem('homer_bird_room_code', code);
        setGameMode('multiplayer');
        restartPhaserScene();
        loadActiveRooms();

        const mobileHubModal = document.getElementById('mobile-arcade-hub-modal');
        if (mobileHubModal && mobileHubModal.open) {
          mobileHubModal.close();
        }
      });
    });
  });
}

function restartPhaserScene() {
  if (gameInstance) {
    const scene = gameInstance.scene.getScene('GameScene');
    if (scene) scene.restartGame();
  }
}

async function loadLeaderboard() {
  const data = await fetchLeaderboard();
  cachedLeaderboardData = data;
  renderLeaderboards();
}

function renderLeaderboards() {
  const containers = [
    document.getElementById('leaderboard-list'),
    document.getElementById('mob-leaderboard-list')
  ].filter(Boolean);

  if (containers.length === 0) return;

  const currentNick = getStoredNickname();
  const list = cachedLeaderboardData ? cachedLeaderboardData[activeTab] || [] : [];

  containers.forEach(container => {
    if (list.length === 0) {
      container.innerHTML = '<div class="lb-loading">Sin puntuaciones registradas aún.</div>';
      return;
    }

    container.innerHTML = list
      .map((entry, index) => {
        const rank = index + 1;
        const isUser = entry.nickname.toLowerCase() === currentNick.toLowerCase();
        const rankClass = rank <= 3 ? `rank-${rank}` : '';

        return `
          <div class="lb-item ${isUser ? 'is-user' : ''}">
            <div class="lb-player-group">
              <span class="lb-rank ${rankClass}">#${rank}</span>
              <span class="lb-name">${escapeHTML(entry.nickname)}</span>
            </div>
            <span class="lb-score">${entry.score} pts</span>
          </div>
        `;
      })
      .join('');
  });
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// ==========================================================================
// Initialization
// ==========================================================================

window.addEventListener('load', () => {
  gameInstance = new Phaser.Game(config);

  setupUI();

  if ('serviceWorker' in navigator && !window.location.host.includes('localhost:51740')) {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('PWA Service Worker:', reg.scope))
      .catch((err) => console.warn('PWA Error:', err));
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
      const newDim = getGameDimensions();
      gameInstance.scale.resize(newDim.width, newDim.height);
    }
  });
});
