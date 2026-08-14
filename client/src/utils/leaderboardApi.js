// API Client & State Manager for Nicknames, Leaderboards, Rooms, and Game Modes

const SPRINGFIELD_NICKNAMES = [
  'Cosme Fulanito',
  'Homero Dona',
  'Mr. Chispa',
  'El Barto',
  'Gordo Friki',
  'Santos Inocentes',
  'Peligro Nuclear',
  'Duffman',
  'Granjero Cletus',
  'Jefe Gorgory',
  'Krusty Clown',
  'Otto Man',
  'Capitán McCallister',
  'Prof. Frink',
  'Disco Stu'
];

export function getRandomSpringfieldName() {
  const base = SPRINGFIELD_NICKNAMES[Math.floor(Math.random() * SPRINGFIELD_NICKNAMES.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${base} #${num}`;
}

export function getStoredNickname() {
  let nick = localStorage.getItem('homer_bird_nickname');
  if (!nick) {
    nick = getRandomSpringfieldName();
    localStorage.setItem('homer_bird_nickname', nick);
  }
  return nick;
}

export function setStoredNickname(name) {
  const clean = String(name).trim().slice(0, 16) || getRandomSpringfieldName();
  localStorage.setItem('homer_bird_nickname', clean);
  return clean;
}

// Game Modes: 'single' | 'multiplayer'
export function getGameMode() {
  return localStorage.getItem('homer_bird_game_mode') || 'single';
}

export function setGameMode(mode) {
  localStorage.setItem('homer_bird_game_mode', mode);
  window.dispatchEvent(new CustomEvent('gamemode-changed', { detail: mode }));
  return mode;
}

export function isMultiplayerActive() {
  return getGameMode() === 'multiplayer';
}

export function getApiBaseUrl() {
  const envBackend = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL;
  if (envBackend) {
    return envBackend.replace(/\/+$/, '') + (envBackend.endsWith('/api') ? '' : '/api');
  }
  return '/api';
}

export async function fetchActiveRooms() {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/rooms`);
    if (!res.ok) throw new Error('Network error');
    const data = await res.json();
    return data.success ? data.rooms : [];
  } catch (err) {
    console.warn('Could not fetch active rooms:', err);
    return [];
  }
}

export async function fetchLeaderboard() {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/leaderboard`);
    if (!res.ok) throw new Error('Network error');
    return await res.json();
  } catch (err) {
    console.warn('Could not fetch online leaderboard, using local fallback:', err);
    return {
      success: false,
      allTime: [
        { id: 'seed-1', nickname: 'Sr. Burns', score: 48 },
        { id: 'seed-2', nickname: 'Cosme Fulanito', score: 18 },
        { id: 'seed-3', nickname: 'Ned Flanders', score: 15 },
        { id: 'seed-4', nickname: 'Bart Simpson', score: 12 },
        { id: 'seed-5', nickname: 'Moe Szyslak', score: 9 }
      ],
      today: []
    };
  }
}

export async function submitScore(score, durationMs) {
  const nickname = getStoredNickname();
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname,
        score,
        durationMs
      })
    });
    if (!res.ok) throw new Error('Failed to submit score');
    return await res.json();
  } catch (err) {
    console.warn('Offline score submission fallback:', err);
    return { success: false };
  }
}
