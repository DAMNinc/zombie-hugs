import * as THREE from 'three';
import ImprovedNoise from './ImprovedNoise';

let terrainWidth: number = 0;
let terrainHeight: number = 0;
let yOffset: number = 0;

function generateHeight(): Uint8Array {
  const size = terrainWidth * terrainHeight;
  const data = new Uint8Array(size);
  const perlin = ImprovedNoise();
  let quality = 2;
  const z = Math.random() * 100;

  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < size; i++) {
      const x = i % terrainWidth;
      const y = ~~(i / terrainWidth);
      data[i] += Math.abs(perlin.noise(x / quality, y / quality, z) * quality * 1.75);
    }

    quality *= 2;
  }

  return data;
}

function isArenaFlat(x: number, y: number): boolean {
  return x > terrainWidth / 4 && x < (3 * terrainWidth) / 4 &&
         y > terrainHeight / 4 && y < (3 * terrainHeight) / 4;
}

function generateTexture(data: Uint8Array): HTMLCanvasElement {
  const vector3 = new THREE.Vector3(0, 0, 0);
  const sun = new THREE.Vector3(1, 1, 1);
  sun.normalize();

  const canvas = document.createElement('canvas');
  canvas.width = terrainWidth;
  canvas.height = terrainHeight;

  let context = canvas.getContext('2d')!;
  context.fillStyle = '#000';
  context.fillRect(0, 0, terrainWidth, terrainHeight);

  let image = context.getImageData(0, 0, canvas.width, canvas.height);
  let imageData = image.data;

  for (let i = 0, j = 0, l = imageData.length; i < l; i += 4, j++) {
    const x = j % terrainWidth;
    const y = ~~(j / terrainWidth);

    vector3.x = data[j - 2] - data[j + 2];
    vector3.y = 2;
    vector3.z = data[j - terrainWidth * 2] - data[j + terrainWidth * 2];
    vector3.normalize();

    const shade = vector3.dot(sun);
    const height = data[j];

    if (isArenaFlat(x, y)) {
      // Arena floor: lush green grass
      const grassVariation = (Math.sin(x * 0.5) * Math.cos(y * 0.7)) * 8;
      imageData[i] = 45 + shade * 30 + grassVariation;       // R
      imageData[i + 1] = 120 + shade * 60 + grassVariation;  // G
      imageData[i + 2] = 35 + shade * 20;                    // B

      // Subtle grid lines every ~16 pixels
      if (x % 16 === 0 || y % 16 === 0) {
        imageData[i] += 8;
        imageData[i + 1] += 12;
        imageData[i + 2] += 8;
      }

      // Arena boundary lines (white)
      const edgeX1 = Math.floor(terrainWidth / 4) + 1;
      const edgeX2 = Math.floor(3 * terrainWidth / 4) - 1;
      const edgeY1 = Math.floor(terrainHeight / 4) + 1;
      const edgeY2 = Math.floor(3 * terrainHeight / 4) - 1;
      if (x === edgeX1 || x === edgeX2 || y === edgeY1 || y === edgeY2 ||
          x === edgeX1 + 1 || x === edgeX2 - 1 || y === edgeY1 + 1 || y === edgeY2 - 1) {
        imageData[i] = 220;
        imageData[i + 1] = 220;
        imageData[i + 2] = 220;
      }

      // Center line
      const centerY = Math.floor(terrainHeight / 2);
      if (y === centerY || y === centerY + 1) {
        imageData[i] = 180;
        imageData[i + 1] = 180;
        imageData[i + 2] = 180;
      }
    } else {
      // Outside arena: height-based coloring
      // Low = green-brown grass, mid = brown dirt/rock, high = gray rock
      const t = Math.min(height / 60, 1); // 0 = low, 1 = high

      if (t < 0.3) {
        // Low: brownish-green grass transition
        const blend = t / 0.3;
        imageData[i] = (50 + shade * 40) * (1 - blend) + (110 + shade * 60) * blend;
        imageData[i + 1] = (100 + shade * 50) * (1 - blend) + (80 + shade * 40) * blend;
        imageData[i + 2] = (35 + shade * 20) * (1 - blend) + (40 + shade * 20) * blend;
      } else if (t < 0.7) {
        // Mid: brown dirt and rock
        const blend = (t - 0.3) / 0.4;
        imageData[i] = (110 + shade * 60) * (1 - blend) + (130 + shade * 50) * blend;
        imageData[i + 1] = (80 + shade * 40) * (1 - blend) + (110 + shade * 40) * blend;
        imageData[i + 2] = (40 + shade * 20) * (1 - blend) + (90 + shade * 30) * blend;
      } else {
        // High: gray rock with snow hints
        imageData[i] = 130 + shade * 50 + (height - 40) * 0.5;
        imageData[i + 1] = 120 + shade * 45 + (height - 40) * 0.5;
        imageData[i + 2] = 110 + shade * 40 + (height - 40) * 0.6;
      }
    }
  }

  context.putImageData(image, 0, 0);

  // Scaled 4x
  const canvasScaled = document.createElement('canvas');
  canvasScaled.width = terrainWidth * 4;
  canvasScaled.height = terrainHeight * 4;

  context = canvasScaled.getContext('2d')!;
  context.scale(4, 4);
  context.drawImage(canvas, 0, 0);

  image = context.getImageData(0, 0, canvasScaled.width, canvasScaled.height);
  imageData = image.data;

  for (let i = 0, l = imageData.length; i < l; i += 4) {
    const v = ~~(Math.random() * 4);
    imageData[i] += v;
    imageData[i + 1] += v;
    imageData[i + 2] += v;
  }

  context.putImageData(image, 0, 0);

  return canvasScaled;
}

export default class Terrain {
  yOffset: number;

  constructor(width: number, height: number, offset: number) {
    terrainWidth = width * 2;
    terrainHeight = height * 2;
    this.yOffset = offset;
    yOffset = offset;
  }

  getMesh(): any {
    const data = generateHeight();

    const geometry = new THREE.PlaneGeometry(7500, 7500, terrainWidth - 1, terrainHeight - 1);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

    const vertices = geometry.attributes.position.array;

    for (let i = 0, j = 0, l = vertices.length; i < l; i++, j += 3) {
      const x = i % terrainWidth;
      const y = ~~(i / terrainWidth);
      if (isArenaFlat(x, y)) {
        vertices[j + 1] = yOffset - 50;
      } else {
        vertices[j + 1] = data[i] * 10;
      }
    }

    const texture = new THREE.CanvasTexture(generateTexture(data));
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture }));
  }
}
