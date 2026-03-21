import * as THREE from 'three';

const EXPLOSION_COLORS: Record<number, number[]> = {
  0: [1.0, 1.0, 0.3],      // Default - yellow
  1: [1.0, 0.4, 0.0],      // Fox - orange
  2: [0.7, 0.5, 0.2],      // Horse - brown/gold
  3: [1.0, 0.4, 0.7],      // Flamingo - pink
  4: [0.2, 1.0, 0.2],      // Zombie - green
  5: [0.6, 0.2, 1.0],      // Horde - purple
};

// Secondary accent color for each creature (sparks)
const EXPLOSION_ACCENT: Record<number, number[]> = {
  0: [1.0, 0.8, 0.2],
  1: [1.0, 0.8, 0.2],      // Fox - yellow sparks
  2: [1.0, 0.9, 0.4],      // Horse - gold sparks
  3: [1.0, 0.7, 0.9],      // Flamingo - light pink
  4: [0.6, 1.0, 0.4],      // Zombie - light green
  5: [0.8, 0.5, 1.0],      // Horde - light purple
};

interface Particle {
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  drag: number;
}

export default class Explosion {
  position: any;
  particleCount: number;
  scene: any;
  elapsed: number;
  duration: number;
  material: THREE.PointsMaterial;
  particle: THREE.Points;
  particles: Particle[];
  positionAttr: THREE.BufferAttribute;

  // Secondary burst (sparks)
  sparkMaterial: THREE.PointsMaterial;
  sparkCloud: THREE.Points;
  sparkParticles: Particle[];
  sparkPositionAttr: THREE.BufferAttribute;

  constructor(scene: any, position: any, weaponCode?: number) {
    this.position = position;
    this.scene = scene;
    this.elapsed = 0;
    this.duration = 1.5;
    this.particles = [];
    this.sparkParticles = [];

    // Bigger explosions for bigger creatures
    switch (weaponCode) {
      case 2: this.particleCount = 6000; break;  // Horse - big
      case 4: this.particleCount = 8000; break;  // Zombie - huge
      case 5: this.particleCount = 1500; break;  // Horde - small
      default: this.particleCount = 3000;
    }

    // Initialize with defaults (overwritten in init)
    this.material = null!;
    this.particle = null!;
    this.positionAttr = null!;
    this.sparkMaterial = null!;
    this.sparkCloud = null!;
    this.sparkPositionAttr = null!;

    this.init(weaponCode);
  }

  init(weaponCode?: number): void {
    const code = weaponCode || 0;
    const baseColor = EXPLOSION_COLORS[code] || EXPLOSION_COLORS[0];
    const accentColor = EXPLOSION_ACCENT[code] || EXPLOSION_ACCENT[0];

    // === Main explosion burst ===
    const positions = new Float32Array(this.particleCount * 3);
    const colors = new Float32Array(this.particleCount * 3);

    for (let i = 0; i < this.particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const spreadRadius = 2 + Math.random() * 3;

      const i3 = i * 3;
      positions[i3] = Math.sin(phi) * Math.cos(theta) * spreadRadius;
      positions[i3 + 1] = Math.sin(phi) * Math.sin(theta) * spreadRadius - 50;
      positions[i3 + 2] = Math.cos(phi) * spreadRadius;

      const speed = 150 + Math.random() * 350;
      const vx = Math.sin(phi) * Math.cos(theta) * speed * (0.7 + Math.random() * 0.6);
      const vy = Math.sin(phi) * Math.sin(theta) * speed * (0.5 + Math.random() * 1.0);
      const vz = Math.cos(phi) * speed * (0.7 + Math.random() * 0.6);

      this.particles.push({
        vx, vy, vz,
        gravity: 200 + Math.random() * 300,
        drag: 0.96 + Math.random() * 0.03,
      });

      const blend = Math.random();
      colors[i3] = baseColor[0] * (1 - blend) + accentColor[0] * blend;
      colors[i3 + 1] = baseColor[1] * (1 - blend) + accentColor[1] * blend;
      colors[i3 + 2] = baseColor[2] * (1 - blend) + accentColor[2] * blend;
    }

    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(positions, 3);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.PointsMaterial({
      size: 4 + Math.random() * 3,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
    });

    this.particle = new THREE.Points(geometry, this.material);
    this.particle.position.set(this.position.x, this.position.y, this.position.z);
    this.scene.add(this.particle);

    // === Spark ring (smaller, faster particles) ===
    const sparkCount = Math.floor(this.particleCount * 0.15);
    const sparkPositions = new Float32Array(sparkCount * 3);
    const sparkColors = new Float32Array(sparkCount * 3);

    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const i3 = i * 3;
      sparkPositions[i3] = Math.cos(angle) * 2;
      sparkPositions[i3 + 1] = -50 + Math.random() * 5;
      sparkPositions[i3 + 2] = Math.sin(angle) * 2;

      const ringSpeed = 400 + Math.random() * 200;
      this.sparkParticles.push({
        vx: Math.cos(angle) * ringSpeed,
        vy: 50 + Math.random() * 100,
        vz: Math.sin(angle) * ringSpeed,
        gravity: 400,
        drag: 0.94,
      });

      sparkColors[i3] = accentColor[0];
      sparkColors[i3 + 1] = accentColor[1];
      sparkColors[i3 + 2] = accentColor[2];
    }

    const sparkGeometry = new THREE.BufferGeometry();
    this.sparkPositionAttr = new THREE.BufferAttribute(sparkPositions, 3);
    sparkGeometry.setAttribute('position', this.sparkPositionAttr);
    sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));

    this.sparkMaterial = new THREE.PointsMaterial({
      size: 2,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
    });

    this.sparkCloud = new THREE.Points(sparkGeometry, this.sparkMaterial);
    this.sparkCloud.position.set(this.position.x, this.position.y, this.position.z);
    this.scene.add(this.sparkCloud);
  }

  update(elapsed: number): boolean {
    this.elapsed += elapsed;

    if (this.elapsed > this.duration) {
      this.scene.remove(this.particle);
      this.scene.remove(this.sparkCloud);
      return false;
    }

    const progress = this.elapsed / this.duration;

    // Fade out over time
    this.material.opacity = Math.max(0, 1.0 - progress * progress);
    this.sparkMaterial.opacity = Math.max(0, 1.0 - progress * 1.5);

    // Shrink particles as they fade
    this.material.size = Math.max(1, (4 - progress * 3));

    // Update main particles
    const pos = this.positionAttr.array as Float32Array;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const i3 = i * 3;

      pos[i3] += elapsed * p.vx;
      pos[i3 + 1] += elapsed * p.vy;
      pos[i3 + 2] += elapsed * p.vz;

      p.vy -= elapsed * p.gravity;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.vz *= p.drag;
    }
    this.positionAttr.needsUpdate = true;

    // Update sparks
    const sparkPos = this.sparkPositionAttr.array as Float32Array;
    for (let i = 0; i < this.sparkParticles.length; i++) {
      const p = this.sparkParticles[i];
      const i3 = i * 3;

      sparkPos[i3] += elapsed * p.vx;
      sparkPos[i3 + 1] += elapsed * p.vy;
      sparkPos[i3 + 2] += elapsed * p.vz;

      p.vy -= elapsed * p.gravity;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.vz *= p.drag;
    }
    this.sparkPositionAttr.needsUpdate = true;

    return true;
  }
}
