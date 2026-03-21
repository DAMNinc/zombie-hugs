import * as THREE from 'three';
import Constants, { healthFromCode } from './constants';
import { loadLegacyJSON, LegacyModelData } from './LegacyJSONLoader';

export default class Models {
  missing: number;
  fox: LegacyModelData | null;
  flamingo: LegacyModelData | null;
  horse: LegacyModelData | null;
  zombie: LegacyModelData | null;
  player: LegacyModelData | null;

  constructor() {
    this.missing = 0;
    this.fox = null;
    this.flamingo = null;
    this.horse = null;
    this.zombie = null;
    this.player = null;

    this.load('/content/fox.json', (data) => { this.fox = data; });
    this.load('/content/flamingo.json', (data) => { this.flamingo = data; });
    this.load('/content/horse.json', (data) => { this.horse = data; });
    this.load('/content/zombie.json', (data) => { this.zombie = data; });
    this.load('/content/monster.json', (data) => { this.player = data; });
  }

  private load(file: string, result: (data: LegacyModelData) => void): void {
    this.missing++;
    console.log('loading ' + file);
    loadLegacyJSON(file).then((data) => {
      console.log(file + ' loaded');
      result(data);
      this.missing--;
    });
  }

  isReady(): boolean {
    return this.missing === 0;
  }

  getZombie(): any {
    return { model: this.fox, offset: { x: 0, y: 0, z: 0 }, health: healthFromCode(Constants.FOX) };
  }

  getFlamingo(): any {
    return { model: this.flamingo, offset: { x: 0, y: 50, z: 0 }, health: healthFromCode(Constants.FLAMINGO) };
  }

  getHorse(): any {
    return { model: this.horse, offset: { x: 0, y: -10, z: 0 }, health: healthFromCode(Constants.HORSE) };
  }

  getZombieModel(): any {
    return { model: this.zombie, offset: { x: 0, y: -10, z: 0 }, health: healthFromCode(Constants.ZOMBIE), scale: 15 };
  }

  getHorde(): any {
    return { model: this.fox, offset: { x: 0, y: 0, z: 0 }, health: healthFromCode(Constants.HORDE), scale: 0.4 };
  }

  getPlayer(direction: number): any {
    const data = this.player!;
    const material = data.materials.length > 1 ? data.materials : data.materials[0];
    const mesh = new THREE.Mesh(data.geometry.clone(), material);
    mesh.scale.set(0.05, 0.05, 0.05);
    mesh.rotation.y = Math.PI * 0.5 * direction;
    return mesh;
  }
}
