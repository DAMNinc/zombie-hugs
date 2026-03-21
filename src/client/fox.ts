/**
 * Animal animation system.
 * Rewritten for modern Three.js (r125+) using morphTargetInfluences
 * instead of the removed AnimationHandler + morphTargetForcedOrder.
 *
 * Original ROME.Animal by Mikael Emtinger (Apache license).
 */

import * as THREE from 'three';
import { LegacyModelData } from './LegacyJSONLoader';

window.ROME = {};

// animation data — maps animal names to frame arrays
const animalAnimationData: Record<string, { index: number; time: number }[]> = {};
const animalNames = ['fox', 'zombie'];

function parseAnimationData(morphTargetNames: string[]): string[] {
  const availableAnimals: string[] = [];

  // Match morph target names against known animal names (substring match,
  // matching the original ROME code behavior). Only add new names if no
  // existing name matches.
  for (const mtName of morphTargetNames) {
    let matched = false;
    for (const existing of animalNames) {
      if (mtName.indexOf(existing) !== -1) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Extract alphabetic prefix as new animal name
      let nameEnd = 0;
      for (let i = 0; i < mtName.length; i++) {
        const c = mtName.charCodeAt(i);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
          nameEnd = i + 1;
        } else {
          break;
        }
      }
      const name = mtName.slice(0, nameEnd);
      if (name && animalNames.indexOf(name) === -1) {
        animalNames.push(name);
      }
    }
  }

  // Build frame data for each animal (only if not already cached)
  for (const animalName of animalNames) {
    if (!animalAnimationData[animalName]?.length) {
      const frames: { index: number; time: number }[] = [];
      let currentTime = 0;

      for (let m = 0; m < morphTargetNames.length; m++) {
        if (morphTargetNames[m].indexOf(animalName) !== -1) {
          frames.push({ index: m, time: currentTime });
          currentTime += Math.floor(1000 / 24); // 24 fps
        }
      }

      if (frames.length > 0) {
        animalAnimationData[animalName] = frames;
      }
    }

    // Always report available animals (even if data was cached from a prior call)
    if (animalAnimationData[animalName]?.length) {
      if (availableAnimals.indexOf(animalName) === -1) {
        availableAnimals.push(animalName);
      }
    }
  }

  return availableAnimals;
}

interface AnimalData {
  frames: { index: number; time: number }[];
  currentFrame: number;
  lengthInFrames: number;
  currentTime: number;
  lengthInMS: number;
  timeScale: number;
  name: string;
}

ROME.Animal = function (modelData: LegacyModelData, parseMorphTargetsNames: boolean) {
  const geometry = modelData.geometry.clone();
  const morphTargetNames = modelData.morphTargetNames;

  if (parseMorphTargetsNames) {
    // Parse animal names from morph target names on first use
  }

  const availableAnimals = parseAnimationData(morphTargetNames);

  // Use a simple material with vertex colors
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);

  // Initialize morph target influences to zero
  if (mesh.morphTargetInfluences) {
    for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
      mesh.morphTargetInfluences[i] = 0;
    }
  }

  const that: any = {};
  that.morph = 0.0;
  that.animalA = {
    frames: undefined as any,
    currentFrame: 0,
    lengthInFrames: 0,
    currentTime: 0,
    lengthInMS: 0,
    timeScale: 1.0,
    name: '',
  } as AnimalData;
  that.animalB = {
    frames: undefined as any,
    currentFrame: 0,
    lengthInFrames: 0,
    currentTime: 0,
    lengthInMS: 0,
    timeScale: 1.0,
    name: '',
  } as AnimalData;
  that.availableAnimals = availableAnimals;
  that.mesh = mesh;

  let isPlaying = false;

  that.play = function (animalA: string, animalB?: string, morph?: number, startTimeAnimalA?: number, startTimeAnimalB?: number) {
    isPlaying = true;
    that.morph = morph || 0;

    animalB = animalB !== undefined ? animalB : animalA;

    setAnimalData(animalA, that.animalA);
    setAnimalData(animalB, that.animalB);

    that.animalA.currentTime = startTimeAnimalA || 0;
    that.animalB.currentTime = startTimeAnimalB || 0;

    that.update(0);
  };

  that.update = function (deltaTimeMS: number) {
    if (!isPlaying || !mesh.morphTargetInfluences) return;

    // Reset all influences
    for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
      mesh.morphTargetInfluences[i] = 0;
    }

    const dataNames = ['animalA', 'animalB'];

    for (let d = 0; d < dataNames.length; d++) {
      const data: AnimalData = that[dataNames[d]];
      if (!data.frames) continue;

      const unloopedTime = data.currentTime;
      data.currentTime = (data.currentTime + deltaTimeMS * data.timeScale) % data.lengthInMS;

      // Did we loop?
      if (unloopedTime > data.currentTime) {
        data.currentFrame = 0;
      }

      // Find frame/nextFrame
      let frame = 0;
      for (let f = data.currentFrame, fl = data.lengthInFrames - 1; f < fl; f++) {
        if (data.currentTime >= data.frames[f].time && data.currentTime < data.frames[f + 1].time) {
          frame = f;
          break;
        }
      }

      data.currentFrame = frame;
      const nextFrame = frame + 1 < data.lengthInFrames - 1 ? frame + 1 : 0;

      const time = data.frames[frame].time;
      let nextTime = data.frames[nextFrame].time;
      if (nextTime <= time) nextTime += data.lengthInMS;

      const scale = (data.currentTime - time) / (nextTime - time);

      // Set morph target influences
      // animalA gets weight (1 - morph), animalB gets weight (morph)
      const animalWeight = d === 0 ? (1 - that.morph) : that.morph;
      const frameIdx = data.frames[frame].index;
      const nextFrameIdx = data.frames[nextFrame].index;

      mesh.morphTargetInfluences[frameIdx] += (1 - scale) * animalWeight;
      mesh.morphTargetInfluences[nextFrameIdx] += scale * animalWeight;
    }
  };

  that.setNewTargetAnimal = function (animal: string, startTimeAnimalB?: number) {
    if (that.morph === 1) {
      for (const property in that.animalA) {
        that.animalA[property] = that.animalB[property];
      }
      that.animalB.currentTime = startTimeAnimalB || 0;
      setAnimalData(animal, that.animalB);
      that.morph = 0;
    } else {
      console.log('Error: Cannot change animal target if morph != 1. Skipping.');
    }
  };

  const setAnimalData = function (name: string, data: AnimalData) {
    const frames = animalAnimationData[name];
    if (frames) {
      data.frames = frames;
      data.lengthInFrames = frames.length;
      data.lengthInMS = frames[frames.length - 1].time;
      data.name = name.toLowerCase();
    } else {
      console.log("Error: Couldn't find data for animal " + name);
    }
  };

  return that;
};

/**
 * Represents a fox (or any weapon model).
 */
export default class Fox {
  offset: any;
  health: number;
  direction: number;
  name: string;
  speed: number;
  foxObj: any;
  weaponCode: number;
  spawnTime: number;
  baseX: number;

  // Interpolation targets
  private targetX: number | null = null;
  private targetZ: number | null = null;

  constructor(direction: number, zombieModel: any, name?: string, weaponCode?: number) {
    this.offset = zombieModel.offset;
    this.health = zombieModel.health;
    this.direction = direction || -1;
    this.name = name || '';
    this.weaponCode = weaponCode || 1;
    this.spawnTime = Date.now();
    this.baseX = 0;

    this.speed = (weaponCode === 4) ? 200 : 300;
    this.foxObj = new ROME.Animal(zombieModel.model, true);
    this.foxObj.play(this.foxObj.availableAnimals[0], this.foxObj.availableAnimals[0]);
    this.foxObj.animalA.timeScale = this.foxObj.animalB.timeScale = 0.9;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  update(elapsed: number): void {
    // Smooth interpolation toward server target
    const lerpFactor = Math.min(1, elapsed * 10); // ~10x per second convergence

    if (this.targetZ !== null) {
      const currentZ = this.foxObj.mesh.position.z;
      const diff = (this.targetZ + this.offset.z) - currentZ;
      // If close enough, let client-side prediction take over
      if (Math.abs(diff) < 5) {
        this.targetZ = null;
      } else {
        this.foxObj.mesh.position.z += diff * lerpFactor;
      }
    }

    // Client-side prediction: keep moving forward
    this.foxObj.mesh.position.z += elapsed * this.speed * this.direction;

    // Fox zigzag
    if (this.weaponCode === 1 && this.speed > 0) {
      const timeSinceSpawn = (Date.now() - this.spawnTime) / 1000;
      this.foxObj.mesh.position.x = this.baseX + this.offset.x + Math.sin(timeSinceSpawn * 4) * 50;
    } else if (this.targetX !== null) {
      const currentX = this.foxObj.mesh.position.x;
      const diffX = (this.targetX + this.offset.x) - currentX;
      if (Math.abs(diffX) < 5) {
        this.targetX = null;
      } else {
        this.foxObj.mesh.position.x += diffX * lerpFactor;
      }
    }

    this.foxObj.update(elapsed * 1000);
  }

  getMesh(): any {
    return this.foxObj.mesh;
  }

  getPosition(): any {
    return this.foxObj.mesh.position;
  }

  setPosition(position: any): void {
    // Set interpolation targets instead of snapping
    this.targetX = position.x;
    this.targetZ = position.z;
    // Y can snap — it doesn't change during gameplay
    this.foxObj.mesh.position.y = position.y - 50 + this.offset.y;
  }
}
