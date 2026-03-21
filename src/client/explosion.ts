import * as THREE from 'three';

const EXPLOSION_COLORS: Record<number, string> = {
  1: '#ff6600', // Fox - orange
  2: '#aa8833', // Horse - brown/gold
  3: '#ff69b4', // Flamingo - pink
  4: '#33ff33', // Horde - green
};

export default class Explosion {
  position: any;
  particleCount: number;
  scene: any;
  elapsed: number;
  geometry: any;
  material: any;
  particle: any;

  constructor(scene: any, position: any, weaponCode?: number) {
    this.position = position;
    this.particleCount = weaponCode === 2 ? 8000 : weaponCode === 4 ? 2000 : 5000;
    this.scene = scene;
    this.elapsed = 0;
    this.init(weaponCode);
  }

  init(weaponCode?: number): void {
    this.geometry = new THREE.Geometry();

    for (let i = 0; i < this.particleCount; i++) {
      const vertex = new THREE.Vector3(Math.random() - 0.5, -50, Math.random() - 0.5);
      vertex.velocityX = vertex.x * 500;
      vertex.velocityY = Math.random() * 500;
      vertex.velocityZ = vertex.z * 500;
      this.geometry.vertices.push(vertex);
    }

    const size = 5;
    const color = EXPLOSION_COLORS[weaponCode || 0] || '#ff0';

    this.material = new THREE.PointCloudMaterial({
      size: size,
      color: color,
    });
    this.particle = new THREE.PointCloud(this.geometry, this.material);
    this.particle.position.set(this.position.x, this.position.y, this.position.z);

    this.scene.add(this.particle);
  }

  update(elapsed: number): boolean {
    this.elapsed += elapsed;
    if (this.elapsed > 1) {
      this.scene.remove(this.particle);
      return false;
    }

    for (const vertex of this.geometry.vertices) {
      const diffX = elapsed * vertex.velocityX;
      const diffY = elapsed * vertex.velocityY;
      const diffZ = elapsed * vertex.velocityZ;

      vertex.x += diffX;
      vertex.y += diffY;
      vertex.z += diffZ;
    }

    this.geometry.verticesNeedUpdate = true;

    return true;
  }
}
