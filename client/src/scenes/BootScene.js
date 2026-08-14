import Phaser from 'phaser';
import { generateTextures } from '../utils/textureGenerator.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // 1. Spritesheet principal de Homero volando (8x8 = 64 frames de 256x256)
    this.load.spritesheet('homer', '/assets/sprites/spritesheet.png', {
      frameWidth: 256,
      frameHeight: 256
    });

    // 2. Spritesheet de muerte / impacto / pánico de Homero (8x8 = 64 frames)
    this.load.spritesheet('homer-death', '/assets/sprites/homer-death.png', {
      frameWidth: 256,
      frameHeight: 256
    });

    // 3. Fondo infinito de Springfield
    this.load.image('springfield-bg', '/assets/bakgrounds/6PC0Z.jpg');

    // 4. Sonidos de Homero (salto y muerte)
    this.load.audio('homer-jump', '/assets/sounds/homero-gimiendo.mp3');
    this.load.audio('homer-die', '/assets/sounds/homero-gimiendo222_ZBxsWJA_final.mp3');
  }

  create() {
    generateTextures(this);

    // Animación de vuelo continuo de Homero
    this.anims.create({
      key: 'homer-fly',
      frames: this.anims.generateFrameNumbers('homer', { frames: [0, 1, 2, 3, 2, 1] }),
      frameRate: 10,
      repeat: -1
    });

    // Animación de salto / impulso
    this.anims.create({
      key: 'homer-jump',
      frames: this.anims.generateFrameNumbers('homer', { frames: [6, 7, 14, 0] }),
      frameRate: 14,
      repeat: 0
    });

    // Animación de choque / muerte (nuevo spritesheet)
    this.anims.create({
      key: 'homer-crash-anim',
      frames: this.anims.generateFrameNumbers('homer-death', {
        frames: [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63]
      }),
      frameRate: 16,
      repeat: 0
    });

    // Animación de pánico / caída
    this.anims.create({
      key: 'homer-panic-anim',
      frames: this.anims.generateFrameNumbers('homer-death', {
        frames: [0, 1, 2, 3, 4, 5, 6, 7]
      }),
      frameRate: 12,
      repeat: -1
    });

    this.scene.start('GameScene');
  }
}
