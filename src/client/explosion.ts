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
  geometry: any;
  material: any;
  particle: any;
  particles: Particle[];

  // Secondary burst (sparks)
  sparkGeometry: any;
  sparkMaterial: any;
  sparkCloud: any;
  sparkParticles: Particle[];

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

    this.init(weaponCode);
  }

  init(weaponCode?: number): void {
    const code = weaponCode || 0;
    const baseColor = EXPLOSION_COLORS[code] || EXPLOSION_COLORS[0];
    const accentColor = EXPLOSION_ACCENT[code] || EXPLOSION_ACCENT[0];

    // === Main explosion burst ===
    this.geometry = new THREE.Geometry();

    for (let i = 0; i < this.particleCount; i++) {
      // Spherical distribution for initial spread
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const spreadRadius = 2 + Math.random() * 3;

      const vertex = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * spreadRadius,
        Math.sin(phi) * Math.sin(theta) * spreadRadius - 50,
        Math.cos(phi) * spreadRadius,
      );

      // Velocity: outward burst with randomness
      const speed = 150 + Math.random() * 350;
      const vx = Math.sin(phi) * Math.cos(theta) * speed * (0.7 + Math.random() * 0.6);
      const vy = Math.sin(phi) * Math.sin(theta) * speed * (0.5 + Math.random() * 1.0);
      const vz = Math.cos(phi) * speed * (0.7 + Math.random() * 0.6);

      this.particles.push({
        vx, vy, vz,
        gravity: 200 + Math.random() * 300, // varying gravity per particle
        drag: 0.96 + Math.random() * 0.03,   // air resistance
      });

      // Per-vertex color: blend between base and accent
      const blend = Math.random();
      const r = baseColor[0] * (1 - blend) + accentColor[0] * blend;
      const g = baseColor[1] * (1 - blend) + accentColor[1] * blend;
      const b = baseColor[2] * (1 - blend) + accentColor[2] * blend;
      vertex.color = new THREE.Color(r, g, b);

      this.geometry.vertices.push(vertex);
      this.geometry.colors.push(vertex.color);
    }

    this.material = new THREE.PointCloudMaterial({
      size: 4 + Math.random() * 3,
      vertexColors: THREE.VertexColors,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
    });

    this.particle = new THREE.PointCloud(this.geometry, this.material);
    this.particle.position.set(this.position.x, this.position.y, this.position.z);
    this.scene.add(this.particle);

    // === Spark ring (smaller, faster particles) ===
    const sparkCount = Math.floor(this.particleCount * 0.15);
    this.sparkGeometry = new THREE.Geometry();

    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const vertex = new THREE.Vector3(
        Math.cos(angle) * 2,
        -50 + Math.random() * 5,
        Math.sin(angle) * 2,
      );

      // Fast horizontal ring burst
      const ringSpeed = 400 + Math.random() * 200;
      this.sparkParticles.push({
        vx: Math.cos(angle) * ringSpeed,
        vy: 50 + Math.random() * 100,
        vz: Math.sin(angle) * ringSpeed,
        gravity: 400,
        drag: 0.94,
      });

      vertex.color = new THREE.Color(accentColor[0], accentColor[1], accentColor[2]);
      this.sparkGeometry.vertices.push(vertex);
      this.sparkGeometry.colors.push(vertex.color);
    }

    this.sparkMaterial = new THREE.PointCloudMaterial({
      size: 2,
      vertexColors: THREE.VertexColors,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
    });

    this.sparkCloud = new THREE.PointCloud(this.sparkGeometry, this.sparkMaterial);
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
    for (let i = 0; i < this.geometry.vertices.length; i++) {
      const vertex = this.geometry.vertices[i];
      const p = this.particles[i];

      vertex.x += elapsed * p.vx;
      vertex.y += elapsed * p.vy;
      vertex.z += elapsed * p.vz;

      // Gravity pulls down
      p.vy -= elapsed * p.gravity;

      // Air drag
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.vz *= p.drag;
    }
    this.geometry.verticesNeedUpdate = true;

    // Update sparks
    for (let i = 0; i < this.sparkGeometry.vertices.length; i++) {
      const vertex = this.sparkGeometry.vertices[i];
      const p = this.sparkParticles[i];

      vertex.x += elapsed * p.vx;
      vertex.y += elapsed * p.vy;
      vertex.z += elapsed * p.vz;

      p.vy -= elapsed * p.gravity;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.vz *= p.drag;
    }
    this.sparkGeometry.verticesNeedUpdate = true;

    return true;
  }
}
