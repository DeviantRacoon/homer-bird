# 🍩 Homer Bird • Springfield Sector 7-G Arcade

<p align="center">
  <img src="client/public/icons/icon-192.png" alt="Homer Bird Logo" width="128" style="border-radius: 24px;" />
</p>

<p align="center">
  <strong>Un juego web 2D inspirado en Flappy Bird con temática de Homero Simpson, multijugador en tiempo real con salas sincronizadas, ranking mundial, animaciones de pánico/derrota y soporte PWA offline.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Phaser-4.2-blue?logo=phaser&logoColor=white" alt="Phaser" />
  <img src="https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Node.js-Express%20%2B%20WebSockets-green?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Bun-Compatible-fbf0df?logo=bun&logoColor=black" alt="Bun" />
  <img src="https://img.shields.io/badge/PWA-100%25%20Offline-orange?logo=pwa&logoColor=white" alt="PWA" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License" />
</p>

---

## 🕹️ Características Principales

- **🎮 Modos de Juego:**
  - **Modo Solo:** Circuito aleatorio procedural infinito con progresión de dificultad.
  - **Multijugador en Vivo (WebSockets):** Salas privadas con código (ej. `DONA`) o públicas con **semilla matemática sincronizada (PRNG)** para que todos los jugadores compitan con las mismas alturas y tuberías en tiempo real.
- **🏆 Ranking Mundial & Anti-Cheat:**
  - Tablas de clasificación en tiempo real: *Top Histórico* y *Top de Hoy*.
  - Validación de tiempo vs puntuación en backend para evitar trampas.
- **🎨 Animaciones & Spritesheets Personalizados:**
  - Spritesheet de vuelo continuo y aleteo.
  - Spritesheet de impacto/derrota con expresiones de pánico y choque.
- **📱 Responsive & PWA Offline:**
  - **Móviles (`<= 768px`):** Pantalla completa real edge-to-edge (`100dvh` / `100vw`) con controles táctiles optimizados.
  - **Desktop (`> 768px`):** Cabina arcade temática *Sector 7-G* de la Planta Nuclear con líneas CRT, telemetría LED del reactor y monitor de peligro meltdown.
  - **PWA:** Instalable en Android, iOS, Windows y macOS; funciona 100% sin conexión a internet.
- **🔊 Audio Dinámico:**
  - Efectos de voz originales de Homero Simpson con modulación de velocidad, corte instantáneo al aletear y audio de derrota.

---

## 🛠️ Arquitectura Desacoplada (Frontend & Backend)

El proyecto está estructurado como un monorrepósito limpio con dos servicios independientes:

```text
homer-brd/
├── client/                     # FRONTEND (Phaser + Vite PWA)
│   ├── public/                 # Favicons, audios, sprites y manifest PWA
│   ├── src/                    # Escenas de juego, UI y clientes API/WS
│   ├── index.html
│   ├── style.css
│   ├── vite.config.js
│   └── package.json            # Dependencias exclusivas de frontend
│
├── server/                     # BACKEND (Express + WebSockets + Anti-Cheat)
│   ├── data/                   # Persistencia de puntuaciones (scores.json)
│   ├── server.js               # API REST (/api/leaderboard, /api/score) y WS
│   ├── Dockerfile              # Contenedor universal para despliegue
│   └── package.json            # Dependencias exclusivas de backend
│
├── package.json                # Workspaces y orquestación local
└── netlify.toml                # Configuración de despliegue estático para client/
```

---

## 🚀 Inicio Rápido en Desarrollo Local

### 1. Instalar dependencias
```bash
# Con Bun (Recomendado):
bun install

# O con npm:
npm install
```

### 2. Ejecutar ambos servicios en paralelo
```bash
bun dev
# o npm run dev
```
Esto levantará simultáneamente:
- **Backend API & WebSockets**: `http://localhost:3001`
- **Frontend Arcade Client**: `http://localhost:5173`

---

## 💻 Comandos Individuales

| Acción | Comando |
| :--- | :--- |
| **Solo Cliente (Dev)** | `bun run dev:client` |
| **Solo Servidor (Dev)** | `bun run dev:server` |
| **Build de Producción Cliente** | `bun run build` |
| **Iniciar Servidor de Producción** | `bun run start` |

---

## 🌐 Despliegue en Producción

### Frontend (Client)
El cliente es una SPA estática y PWA que puede alojarse en:
- **Netlify / Vercel / Cloudflare Pages / GitHub Pages**:
  - Directorio base / Root: `client`
  - Build command: `bun run build` (o `npm run build`)
  - Publish directory: `dist`
  - Variables de entorno en la plataforma:
    - `VITE_API_URL=https://tu-backend.com/api`
    - `VITE_WS_URL=wss://tu-backend.com`

### Backend (Server)
El backend requiere soporte de conexiones WebSocket persistentes:
- **Render / Railway / Fly.io / VPS Docker**:
  - Usar el `Dockerfile` incluido en `server/` o configurar comando `node server.js` dentro de `server/`.
  - Configurar variable de entorno `CORS_ORIGIN=https://tu-frontend.netlify.app`.

---

## 📄 Licencia

Distribuido bajo la Licencia MIT. Consulta `LICENSE` para más información.
