import * as THREE from 'three';

interface Position {
  x: number;
  y: number;
  z: number;
}

interface ExtendedVertex extends THREE.Vector3 {
  velocityX?: number;
  velocityY?: number;
  velocityZ?: number;
}

export default class Explosion {
  position: Position;
  particleCount: number;
  scene: THREE.Scene;
  elapsed: number;
  geometry?: THREE.Geometry;
  material?: THREE.PointCloudMaterial;
  particle?: THREE.PointCloud;

  constructor(scene: THREE.Scene, position: Position) {
    this.position = position;
    this.particleCount = 5000;
    this.scene = scene;
    this.elapsed = 0;
    this.init();
  }

  init(): void {
    this.geometry = new THREE.Geometry();

    for (let i = 0; i < this.particleCount; i++) {
      const vertex: ExtendedVertex = new THREE.Vector3(Math.random()-0.5, -50, Math.random()-0.5);
      vertex.velocityX = vertex.x * 500;
      vertex.velocityY = Math.random() * 500;
      vertex.velocityZ = vertex.z * 500;
      this.geometry.vertices.push(vertex);
    }

    const size = 5;

    this.material = new THREE.PointCloudMaterial({
      size: size,
      color: '#ff0'
    });
    this.particle = new THREE.PointCloud(this.geometry, this.material);
    this.particle.position.set(
      this.position.x,
      this.position.y,
      this.position.z
    );

    this.scene.add(this.particle);
  }

  update(elapsed: number): boolean {
    this.elapsed += elapsed;
    if (this.elapsed > 1) {
      if (this.particle) {
        this.scene.remove(this.particle);
      }
      return false;
    }

    if (this.geometry) {
      for (const vertex of this.geometry.vertices as ExtendedVertex[]) {
        const diffX = elapsed * (vertex.velocityX || 0);
        const diffY = elapsed * (vertex.velocityY || 0);
        const diffZ = elapsed * (vertex.velocityZ || 0);

        vertex.x += diffX;
        vertex.y += diffY;
        vertex.z += diffZ;
      }

      this.geometry.verticesNeedUpdate = true;
    }

    return true;
  }
}
