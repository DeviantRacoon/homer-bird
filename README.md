# 🍩 Homer Bird • Springfield Sector 7-G Arcade

<p align="center">
  <img src="public/icons/icon-192.png" alt="Homer Bird Logo" width="128" style="border-radius: 24px;" />
</p>

<p align="center">
  <strong>Un juego web 2D inspirado en Flappy Bird con temática de Homero Simpson, multijugador en tiempo real con salas sincronizadas, ranking mundial, animaciones de pánico/derrota y soporte PWA offline.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Phaser-3.88-blue?logo=phaser&logoColor=white" alt="Phaser 3" />
  <img src="https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Node.js-Express%20%2B%20WebSockets-green?logo=node.js&logoColor=white" alt="Node.js" />
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
  - **Móviles (`<= 768px`):** Pantalla completa real edge-to-edge (`100dvh` / `100vw`) sin barras negras.
  - **Desktop (`> 768px`):** Cabina arcade temática *Sector 7-G* de la Planta Nuclear con líneas CRT, telemetría LED del reactor y monitor de peligro meltdown.
  - **PWA:** Instalable en Android, iOS, Windows y macOS; funciona 100% sin conexión a internet.
- **🔊 Audio Dinámico:**
  - Efectos de voz originales de Homero Simpson con modulación de velocidad (+20%), corte instantáneo al aletear y audio de derrota.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología |
| :--- | :--- |
| **Motor de Juego** | [Phaser 3](https://phaser.io/) (Arcade Physics + TileSprites) |
| **Frontend Tooling** | [Vite](https://vitejs.dev/) |
| **Backend API** | [Express](https://expressjs.com/) (Node.js / Bun) |
| **Multijugador** | [ws](https://github.com/websockets/ws) (WebSockets nativo ultra ligero) |
| **Audio** | HTML5 Audio & Web Audio API |
| **Estilos** | CSS3 Vanilla con diseño industrial Sector 7-G |

---

## 📁 Estructura del Proyecto

```text
├── assets/                  # Spritesheets, audios y fondos originales
├── data/                    # Persistencia de puntuaciones (JSON / SQLite)
├── public/                  # Assets estáticos servidos por Vite y PWA
│   ├── icons/               # Favicons, apple-touch-icon y splash icons
│   ├── manifest.webmanifest # Manifiesto PWA instalable
│   └── sw.js                # Service Worker con caché offline
├── server/
│   └── server.js            # Servidor API REST + Servidor WebSockets
├── src/
│   ├── main.js              # Inicialización de Phaser y controladores UI
│   ├── scenes/
│   │   ├── BootScene.js     # Carga de assets y registro de animaciones
│   │   └── GameScene.js     # Lógica de juego, físicas y peers multijugador
│   └── utils/
│       ├── leaderboardApi.js    # Cliente API de ranking e identidad
│       ├── multiplayerClient.js # Cliente WebSocket de salas
│       ├── soundFx.js           # Sintetizador de audio de respaldo
│       └── textureGenerator.js  # Generador de texturas procedurales
├── .env.example             # Plantilla de variables de entorno
├── index.html               # Layout arcade y modales
├── style.css                # Sistema de diseño Springfield Sector 7-G
└── vite.config.js           # Configuración de proxy y puerto Vite
```

---

## 🚀 Instalación y Ejecución Local

### 1. Clonar el repositorio
```bash
git clone https://github.com/tu-usuario/homer-bird.git
cd homer-bird
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar entorno
Copia la plantilla de entorno:
```bash
cp .env.example .env
```

### 4. Iniciar servidores
En una terminal, arranca el servidor backend (API & WebSockets):
```bash
npm run server
```

En otra terminal, arranca el cliente web (Vite):
```bash
npm run dev
```

Abre tu navegador en 👉 **`http://localhost:5174/`** (o el puerto que indique Vite).

---

## 📦 Compilación para Producción

```bash
# Generar bundle optimizado en dist/
npm run build

# Previsualizar bundle de producción
npm run preview
```

---

## 📄 Licencia

Distribuido bajo la Licencia MIT. Consulta `LICENSE` para más información.
