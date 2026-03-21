import * as THREE from 'three';
import Constants, { healthFromCode } from './constants';

export default class Models {
  missing: number;
  fox: any;
  flamingo: any;
  horse: any;
  zombie: any;
  player: any;

  constructor() {
    this.missing = 0;
    this.fox = null;
    this.flamingo = null;
    this.horse = null;
    this.zombie = null;
    this.player = null;

    const jsonloader = new THREE.JSONLoader(true);

    this.load(jsonloader, '/content/fox.json', (geo: any) => {
      this.fox = geo;
    });
    this.load(jsonloader, '/content/flamingo.json', (geo: any) => {
      this.flamingo = geo;
    });
    this.load(jsonloader, '/content/horse.json', (geo: any) => {
      this.horse = geo;
    });
    this.load(jsonloader, '/content/zombie.json', (geo: any) => {
      this.zombie = geo;
    });
    this.load(jsonloader, '/content/monster.json', (geo: any) => {
      this.player = geo;
    });
  }

  private load(loader: any, file: string, result: (geo: any) => void): void {
    this.missing++;
    console.log('loading ' + file);
    loader.load(file, (geo: any, mat: any) => {
      console.log(file + ' loaded');
      console.log(mat);
      result({
        geometry: geo,
        materials: mat,
      });
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
    const material = new THREE.MeshFaceMaterial(this.player.materials);
    const mesh = new THREE.Mesh(this.player.geometry, material);
    mesh.scale.set(0.05, 0.05, 0.05);
    mesh.rotation.y = Math.PI * 0.5 * direction;
    return mesh;
  }
}
