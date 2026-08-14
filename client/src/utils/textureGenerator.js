// Generates dynamic placeholder textures and a multi-frame spritesheet
// Allows full spritesheet animation, parallax scrolling, and physics without missing asset files.

export function generateTextures(scene) {
  generateBirdSpritesheet(scene);
  generateBackgroundTextures(scene);
  generatePipeTextures(scene);
  generateGroundTexture(scene);
  generateParticleTexture(scene);
}

function generateBirdSpritesheet(scene) {
  const frameWidth = 36;
  const frameHeight = 26;
  const totalFrames = 3;
  const width = frameWidth * totalFrames;
  const height = frameHeight;

  const canvas = scene.textures.createCanvas('bird-spritesheet', width, height);
  const ctx = canvas.getContext();

  for (let i = 0; i < totalFrames; i++) {
    const ox = i * frameWidth;

    // Body (Yellow egg shape)
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.ellipse(ox + 18, 13, 14, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body shadow
    ctx.strokeStyle = '#ca8a04';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Belly (lighter yellow)
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.ellipse(ox + 15, 16, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Big Eye (White circle + black pupil + sparkle)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ox + 25, 8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Pupil
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(ox + 26, 8, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Eye highlight
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ox + 25.5, 7, 1, 0, Math.PI * 2);
    ctx.fill();

    // Beak (Orange)
    ctx.fillStyle = '#ea580c';
    ctx.beginPath();
    ctx.moveTo(ox + 26, 12);
    ctx.lineTo(ox + 35, 15);
    ctx.lineTo(ox + 26, 18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Animated Wing (White & Orange)
    // Frame 0: Wing down, Frame 1: Wing middle, Frame 2: Wing up
    ctx.fillStyle = '#fed7aa';
    ctx.strokeStyle = '#ea580c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    if (i === 0) {
      // Down
      ctx.ellipse(ox + 11, 17, 7, 4, 0.4, 0, Math.PI * 2);
    } else if (i === 1) {
      // Mid
      ctx.ellipse(ox + 11, 13, 7, 4, 0, 0, Math.PI * 2);
    } else {
      // Up
      ctx.ellipse(ox + 11, 9, 7, 4, -0.4, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  }

  canvas.refresh();

  // Register frames for the spritesheet in Phaser
  for (let i = 0; i < totalFrames; i++) {
    scene.textures.get('bird-spritesheet').add(i, 0, i * frameWidth, 0, frameWidth, frameHeight);
  }
}

function generateBackgroundTextures(scene) {
  // 1. Sky & Clouds
  const skyCanvas = scene.textures.createCanvas('bg-sky', 360, 640);
  const skyCtx = skyCanvas.getContext();
  
  const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 640);
  skyGrad.addColorStop(0, '#38bdf8');
  skyGrad.addColorStop(0.7, '#7dd3fc');
  skyGrad.addColorStop(1, '#bae6fd');
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 360, 640);

  // Soft Clouds
  skyCtx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  const drawCloud = (cx, cy, scale) => {
    skyCtx.beginPath();
    skyCtx.arc(cx, cy, 20 * scale, 0, Math.PI * 2);
    skyCtx.arc(cx + 20 * scale, cy - 6 * scale, 24 * scale, 0, Math.PI * 2);
    skyCtx.arc(cx + 45 * scale, cy, 18 * scale, 0, Math.PI * 2);
    skyCtx.arc(cx + 25 * scale, cy + 10 * scale, 16 * scale, 0, Math.PI * 2);
    skyCtx.fill();
  };
  drawCloud(60, 100, 1.2);
  drawCloud(240, 160, 0.9);
  drawCloud(320, 70, 1.1);
  skyCanvas.refresh();

  // 2. City Silhouette (Parallax Layer 1)
  const cityCanvas = scene.textures.createCanvas('bg-city', 360, 180);
  const cityCtx = cityCanvas.getContext();
  cityCtx.fillStyle = 'rgba(71, 85, 105, 0.45)';

  // Procedural buildings
  const buildings = [
    { x: 0, w: 40, h: 120 },
    { x: 35, w: 30, h: 90 },
    { x: 60, w: 55, h: 140 },
    { x: 110, w: 35, h: 80 },
    { x: 140, w: 45, h: 150 },
    { x: 180, w: 50, h: 100 },
    { x: 225, w: 40, h: 130 },
    { x: 260, w: 60, h: 110 },
    { x: 315, w: 50, h: 145 },
  ];

  buildings.forEach(b => {
    cityCtx.fillRect(b.x, 180 - b.h, b.w, b.h);
    // Windows
    cityCtx.fillStyle = 'rgba(254, 240, 138, 0.4)';
    for (let wy = 180 - b.h + 10; wy < 170; wy += 18) {
      for (let wx = b.x + 6; wx < b.x + b.w - 6; wx += 10) {
        cityCtx.fillRect(wx, wy, 4, 8);
      }
    }
    cityCtx.fillStyle = 'rgba(71, 85, 105, 0.45)';
  });
  cityCanvas.refresh();

  // 3. Trees / Bushes (Parallax Layer 2)
  const treesCanvas = scene.textures.createCanvas('bg-trees', 360, 80);
  const treesCtx = treesCanvas.getContext();
  treesCtx.fillStyle = '#22c55e';

  for (let x = 0; x < 360; x += 30) {
    treesCtx.beginPath();
    treesCtx.arc(x + 15, 60, 24, 0, Math.PI * 2);
    treesCtx.fill();
  }
  treesCtx.fillStyle = '#16a34a';
  for (let x = 15; x < 360; x += 35) {
    treesCtx.beginPath();
    treesCtx.arc(x + 15, 65, 20, 0, Math.PI * 2);
    treesCtx.fill();
  }
  treesCanvas.refresh();
}

function generatePipeTextures(scene) {
  const pipeWidth = 64;
  const pipeHeight = 480;
  const capHeight = 32;

  // Pipe Canvas (Full pipe with cap)
  const canvas = scene.textures.createCanvas('pipe', pipeWidth, pipeHeight);
  const ctx = canvas.getContext();

  // Base stem gradient
  const grad = ctx.createLinearGradient(0, 0, pipeWidth, 0);
  grad.addColorStop(0, '#15803d');
  grad.addColorStop(0.15, '#22c55e');
  grad.addColorStop(0.35, '#86efac');
  grad.addColorStop(0.65, '#22c55e');
  grad.addColorStop(1, '#14532d');

  ctx.fillStyle = grad;
  ctx.fillRect(4, capHeight, pipeWidth - 8, pipeHeight - capHeight);

  // Border lines on stem
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(4, capHeight, 2, pipeHeight - capHeight);
  ctx.fillRect(pipeWidth - 6, capHeight, 2, pipeHeight - capHeight);

  // Pipe Head / Cap
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, pipeWidth, capHeight);
  
  // Cap borders & bevels
  ctx.fillStyle = '#0f172a';
  ctx.strokeRect(1, 1, pipeWidth - 2, capHeight - 2);
  
  // Highlight strip
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillRect(16, 2, 8, capHeight - 4);
  ctx.fillRect(16, capHeight + 2, 8, pipeHeight - capHeight - 4);

  canvas.refresh();
}

function generateGroundTexture(scene) {
  const width = 360;
  const height = 112;

  const canvas = scene.textures.createCanvas('ground', width, height);
  const ctx = canvas.getContext();

  // Dirt base
  ctx.fillStyle = '#ded895';
  ctx.fillRect(0, 0, width, height);

  // Top grass layer
  ctx.fillStyle = '#73bf2e';
  ctx.fillRect(0, 0, width, 16);

  // Grass shadow / edge
  ctx.fillStyle = '#558022';
  ctx.fillRect(0, 16, width, 4);

  // Diagonal dirt stripes pattern
  ctx.fillStyle = '#d0c870';
  for (let x = -height; x < width + height; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, 20);
    ctx.lineTo(x + 12, 20);
    ctx.lineTo(x - 20, height);
    ctx.lineTo(x - 32, height);
    ctx.closePath();
    ctx.fill();
  }

  // Border line at the top
  ctx.fillStyle = '#2e4d14';
  ctx.fillRect(0, 0, width, 2);

  canvas.refresh();
}

function generateParticleTexture(scene) {
  const canvas = scene.textures.createCanvas('particle-spark', 12, 12);
  const ctx = canvas.getContext();
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.arc(6, 6, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(5, 5, 2, 0, Math.PI * 2);
  ctx.fill();
  canvas.refresh();
}
