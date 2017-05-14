'use strict';

export default class Explosion {
  constructor(scene, position) {
    this.position = position
    this.particleCount = 5000;
    this.scene = scene;
    this.elapsed = 0;
    this.init();
  }

  init() {
    this.geometry = new THREE.Geometry();

    for (let i = 0; i < this.particleCount; i++) {
      const vertex = new THREE.Vector3(Math.random()-0.5, -50, Math.random()-0.5);
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

  update(elapsed) {
    this.elapsed += elapsed;
    if (this.elapsed > 1) {
      this.scene.remove(this.particle);
      return false;
    }

    for (let vertex of this.geometry.vertices) {
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