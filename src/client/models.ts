import * as THREE from 'three';
import Constants, { healthFromCode } from './constants';

interface ModelData {
  geometry: THREE.Geometry;
  materials: THREE.Material[];
}

interface WeaponInfo {
  model: ModelData | null;
  offset: { x: number; y: number; z: number };
  health: number;
}

export default class Models {
  missing: number;
  fox: ModelData | null;
  flamingo: ModelData | null;
  horse: ModelData | null;
  player: ModelData | null;

  constructor() {
    this.missing = 0;
    this.fox = null;
    this.flamingo = null;
    this.horse = null;
    this.player = null;

    const self = this;
    const jsonloader = new THREE.JSONLoader(true);

    load(this, jsonloader, '/content/fox.json', function(geo: ModelData) {
      self.fox = geo;
    });
    load(this, jsonloader, '/content/flamingo.json', function(geo: ModelData) {
      self.flamingo = geo;
    });
    load(this, jsonloader, '/content/horse.json', function(geo: ModelData) {
      self.horse = geo;
    });
    load(this, jsonloader, '/content/monster.json', function(geo: ModelData) {
      self.player = geo;
    });
  }

  isReady(): boolean {
    return this.missing == 0;
  }

  getZombie(): WeaponInfo {
    return { model: this.fox, offset: { x: 0, y: 0, z: 0 }, health: healthFromCode(Constants.FOX) };
  }

  getFlamingo(): WeaponInfo {
    return { model: this.flamingo, offset: { x: 0, y: 50, z: 0 }, health: healthFromCode(Constants.FLAMINGO) };
  }

  getHorse(): WeaponInfo {
    return { model: this.horse, offset: { x: 0, y: -10, z: 0 }, health: healthFromCode(Constants.HORSE) };
  }

  getPlayer(direction: number): THREE.Mesh {
    if (!this.player) throw new Error('Player model not loaded');
    
    const material = new THREE.MeshFaceMaterial(this.player.materials);
    const mesh = new THREE.Mesh(this.player.geometry, material);
    mesh.scale.set(0.05, 0.05, 0.05);

    mesh.rotation.y = Math.PI * 0.5 * direction;

    return mesh;
  }
}

function load(models: Models, loader: THREE.JSONLoader, file: string, result: (geo: ModelData) => void): void {
  models.missing++;
  console.log('loading ' + file);
  loader.load(file, function(geo: THREE.Geometry, mat: THREE.Material[]) {
      console.log(file + ' loaded');
      console.log(mat);
      result({
        geometry: geo,
        materials: mat
      });
      models.missing--;
  });
}
