/**
 * @author Mikael Emtinger
 * Apache license from ROME project.
 */

import * as THREE from 'three';

window.ROME = {};

// animal

ROME.Animal = function (geometry: any, parseMorphTargetsNames: boolean) {
  const result = ROME.AnimalAnimationData.init(geometry, parseMorphTargetsNames);

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
  };
  that.animalB = {
    frames: undefined as any,
    currentFrame: 0,
    lengthInFrames: 0,
    currentTime: 0,
    lengthInMS: 0,
    timeScale: 1.0,
    name: '',
  };
  that.availableAnimals = result.availableAnimals;
  that.mesh = new THREE.Mesh(geometry, result.material);

  let isPlaying = false;
  const morphTargetOrder = that.mesh.morphTargetForcedOrder;
  const material = result.material;

  //--- play ---

  that.play = function (animalA: string, animalB?: string, morph?: number, startTimeAnimalA?: number, startTimeAnimalB?: number) {
    if (!isPlaying) {
      isPlaying = true;
      that.morph = 0;

      THREE.AnimationHandler.play(that);
    }

    animalB = animalB !== undefined ? animalB : animalA;
    morph = morph !== undefined ? morph : 0;

    setAnimalData(animalA, that.animalA);
    setAnimalData(animalB, that.animalB);

    that.animalA.currentTime = startTimeAnimalA ? startTimeAnimalA : 0;
    that.animalB.currentTime = startTimeAnimalB ? startTimeAnimalB : 0;

    that.update(0);
  };

  //--- update ---

  that.update = function (deltaTimeMS: number) {
    if (that.mesh._modelViewMatrix) {
      let data: any;
      const dataNames = ['animalA', 'animalB'];
      let d: number, dl: number;
      let f: number, fl: number;
      let frame: number, nextFrame: number;
      let time: number, nextTime: number;
      let unloopedTime: number;
      let morphTarget: number;
      let scale: number;

      for (d = 0, dl = dataNames.length, morphTarget = 0; d < dl; d++) {
        data = that[dataNames[d]];

        unloopedTime = data.currentTime;
        data.currentTime = (data.currentTime + deltaTimeMS * data.timeScale) % data.lengthInMS;

        // did we loop?

        if (unloopedTime > data.currentTime) {
          data.currentFrame = 0;
        }

        // find frame/nextFrame

        frame = 0;

        for (f = data.currentFrame, fl = data.lengthInFrames - 1; f < fl; f++) {
          if (data.currentTime >= data.frames[f].time && data.currentTime < data.frames[f + 1].time) {
            frame = f;
            break;
          }
        }

        data.currentFrame = frame;
        nextFrame = frame + 1 < fl! ? frame + 1 : 0;

        morphTargetOrder[morphTarget++] = data.frames[frame].index;
        morphTargetOrder[morphTarget++] = data.frames[nextFrame].index;

        time = data.frames[frame].time;
        nextTime =
          data.frames[nextFrame].time > time ? data.frames[nextFrame].time : data.frames[nextFrame].time + data.lengthInMS;

        scale = (data.currentTime - time) / (nextTime - time);

        material.uniforms[dataNames[d] + 'Interpolation'].value = scale;
      }

      material.uniforms.animalMorphValue.value = that.morph;

      if (material.attributes[that.animalA.name] !== undefined) {
        material.attributes.colorAnimalA.buffer = material.attributes[that.animalA.name].buffer;
      }

      if (material.attributes[that.animalB.name] !== undefined) {
        material.attributes.colorAnimalB.buffer = material.attributes[that.animalB.name].buffer;
      }
    }
  };

  //--- set new target animal ---

  that.setNewTargetAnimal = function (animal: string, startTimeAnimalB?: number) {
    if (that.morph === 1) {
      // switch so B -> A

      for (const property in that.animalA) {
        that.animalA[property] = that.animalB[property];
      }

      // set new B and change morph

      that.animalB.currentTime = startTimeAnimalB ? startTimeAnimalB : 0;
      setAnimalData(animal, that.animalB);
      setFrame(that.animalB);
      that.morph = 0;
    } else {
      console.log('Error: Cannot change animal target if morph != 1. Skipping.');
    }
  };

  //--- set animal data ---

  const setAnimalData = function (name: string, data: any) {
    if (ROME.AnimalAnimationData[name] !== undefined) {
      data.frames = ROME.AnimalAnimationData[name];
      data.lengthInFrames = data.frames.length;
      data.lengthInMS = data.frames[data.lengthInFrames - 1].time;
      data.name = name.toLowerCase();
      data.normalsOffset = Math.floor(data.frames.length * 0.5);
    } else {
      console.log('Error: Couldn\'t find data for animal ' + name);
    }
  };

  //--- set frame ---

  const setFrame = function (data: any) {
    let f: number;
    let fl: number;
    const currentTime = data.currentTime;
    const frames = data.frames;

    for (f = 0, fl = frames.length; f < fl; f++) {
      if (currentTime >= frames[f].time) {
        data.currentFrame = f;
        return;
      }
    }
  };

  //--- return public ---

  return that;
};

// shader

ROME.AnimalShader = {
  uniforms: function () {
    return THREE.UniformsUtils.merge([
      THREE.UniformsLib['common'],
      THREE.UniformsLib['lights'],
      {
        animalAInterpolation: { type: 'f', value: 0.0 },
        animalBInterpolation: { type: 'f', value: 0.0 },
        animalMorphValue: { type: 'f', value: 0.0 },

        lightScale: { type: 'f', value: 1.0 },
        lightOffset: { type: 'v3', value: new THREE.Vector3(0.0, 0.0, 0.0) },
      },
    ]);
  },

  attributes: function () {
    return {
      colorAnimalA: { type: 'c', boundTo: 'faces', value: [] as any[] },
      colorAnimalB: { type: 'c', boundTo: 'faces', value: [] as any[] },
    };
  },

  vertexShader: [
    'uniform \tfloat\tanimalAInterpolation;',
    'uniform \tfloat\tanimalBInterpolation;',
    'uniform \tfloat\tanimalMorphValue;',

    'attribute\tvec3\tcolorAnimalA;',
    'attribute\tvec3\tcolorAnimalB;',

    'varying vec3 vColor;',
    'varying vec3 vLightWeighting;',

    THREE.ShaderChunk['lights_pars_vertex'],

    'uniform float lightScale;',
    'uniform vec3 lightOffset;',

    'void main() {',

    'vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
    'vColor = mix( colorAnimalA, colorAnimalB, animalMorphValue );',

    'vec3 animalA = mix( morphTarget0, morphTarget1, animalAInterpolation );',
    'vec3 animalB = mix( morphTarget2, morphTarget3, animalBInterpolation );',
    'vec3 morphed = mix( animalA,      animalB,      animalMorphValue );',

    'vec3 transformedNormal = normalize( normalMatrix * normal );',

    // separate lights for animals
    // ( ambient + one directional )

    'vLightWeighting = vec3( 0.2 );',

    'vec4 lDirection = viewMatrix * vec4( vec3( 0.0, 1.0, 1.0 ), 0.0 );',
    'float directionalLightWeighting = dot( transformedNormal, normalize( lDirection.xyz ) ) * 0.5 + 0.5;',
    'vLightWeighting += vec3( 1.0 ) * directionalLightWeighting;',

    'gl_Position = projectionMatrix * modelViewMatrix * vec4( morphed, 1.0 );',

    '}',
  ].join('\n'),

  fragmentShader: [
    'uniform vec3 diffuse;',
    'uniform float opacity;',

    THREE.ShaderChunk['fog_pars_fragment'],
    THREE.ShaderChunk['lights_pars_fragment'],

    'varying vec3 vLightWeighting;',
    'varying vec3 vColor;',

    'void main() {',

    'gl_FragColor = vec4( vLightWeighting, 1.0 );',

    'gl_FragColor = gl_FragColor * vec4( vColor, 1.0 ) * vec4( 0.9, 0.85, 0.8, 1.0 );',

    THREE.ShaderChunk['fog_fragment'],

    '}',
  ].join('\n'),
};

// animation data

ROME.AnimalAnimationData = {
  animalNames: ['fox'],

  colorVariations: {
    fox: { hRange: 0.03, sRange: 0.15, vRange: 0.25, hOffset: -0.012, sOffset: 0.05, vOffset: 0.0 },
    zero: { hRange: 0.0, sRange: 0.0, vRange: 0.0, hOffset: 0.0, sOffset: 0.0, vOffset: 0.0 },
  } as Record<string, any>,

  animalVariationMap: { fox: 'fox' } as Record<string, string>,

  // init frame times and indices

  init: function (geometry: any, parseMorphTargetNames: boolean) {
    let material: any;

    if (!geometry.initialized) {
      geometry.initialized = true;

      const availableAnimals: string[] = [];
      let animal: any;
      let animalName: string;
      let charCode: number;
      let morphTargetName: string;
      const morphTargets = geometry.morphTargets;
      let a: number, al: number, m: number, ml: number, currentTime: number;

      // add animal names to static list?

      if (parseMorphTargetNames) {
        for (m = 0, ml = morphTargets.length; m < ml; m++) {
          // check so not already exists

          for (a = 0, al = this.animalNames.length; a < al; a++) {
            animalName = this.animalNames[a];

            if (morphTargets[m].name.indexOf(animalName) !== -1) {
              break;
            }
          }

          // did not exist?

          if (a === al) {
            morphTargetName = morphTargets[m].name;

            for (a = 0; a < morphTargetName.length; a++) {
              charCode = morphTargetName.charCodeAt(a);

              if (!((charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122))) {
                break;
              }
            }

            this.animalNames.push(morphTargetName.slice(0, a));
          }
        }
      }

      // parse out the names

      for (a = 0, al = this.animalNames.length; a < al; a++) {
        animalName = this.animalNames[a];
        animal = (this as any)[animalName];
        currentTime = 0;

        if (animal === undefined || animal.length === 0) {
          animal = (this as any)[animalName] = [];

          for (m = 0, ml = morphTargets.length; m < ml; m++) {
            if (morphTargets[m].name.indexOf(animalName) !== -1) {
              animal.push({ index: m, time: currentTime });
              currentTime += parseInt(String(1000 / 24), 10); // 24 fps

              if (availableAnimals.indexOf(animalName) === -1) {
                availableAnimals.push(animalName);
              }
            }
          }
        } else {
          for (m = 0, ml = morphTargets.length; m < ml; m++) {
            if (availableAnimals.indexOf(animalName) === -1 && morphTargets[m].name.indexOf(animalName) !== -1) {
              availableAnimals.push(animalName);
            }
          }
        }
      }

      // create material

      material = new THREE.ShaderMaterial({
        uniforms: ROME.AnimalShader.uniforms(),
        attributes: ROME.AnimalShader.attributes(),
        vertexShader: ROME.AnimalShader.vertexShader,
        fragmentShader: ROME.AnimalShader.fragmentShader,

        lights: true,
        morphTargets: true,
        vertexColors: THREE.VertexColors,
      });

      // init custom attributes

      let c: number, cl: number, morphColor: any;
      const morphColors = geometry.morphColors;
      const attributes = material.attributes;

      if (geometry.morphColors && geometry.morphColors.length) {
        for (c = 0, cl = morphColors.length; c < cl; c++) {
          morphColor = morphColors[c];
          morphTargetName = morphColor.name;

          for (a = 0; a < morphTargetName.length; a++) {
            charCode = morphTargetName.charCodeAt(a);

            if (!((charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122))) {
              break;
            }
          }

          morphTargetName = morphTargetName.slice(0, a).toLowerCase();
          attributes[morphTargetName] = { type: 'c', boundTo: 'faces', value: morphColor.colors };

          // color variations per morph color

          let variations = this.colorVariations['zero'];

          if (this.animalVariationMap[morphTargetName] !== undefined) {
            variations = this.colorVariations[this.animalVariationMap[morphTargetName]];
          }

          if (variations.lScale) {
            material.uniforms.lightScale.value = variations.lScale;
          } else {
            material.uniforms.lightScale.value = 0.5;
          }

          if (variations.lOffset) {
            material.uniforms.lightOffset.value.set(variations.lOffset[0], variations.lOffset[1], variations.lOffset[2]);
          } else {
            material.uniforms.lightOffset.value.set(0.6, 0.6, 0.6);
          }

          randomizeColors(attributes[morphTargetName].value, variations);
        }

        attributes.colorAnimalA.value = morphColors[0].colors;
        attributes.colorAnimalB.value = morphColors[0].colors;

        // check so each animal has a morph color

        for (a = 0, al = availableAnimals.length; a < al; a++) {
          animalName = availableAnimals[a].toLowerCase();

          for (c = 0, cl = morphColors.length; c < cl; c++) {
            morphColor = morphColors[c].name.toLowerCase();

            if (morphColor.indexOf(animalName) !== -1) {
              break;
            }
          }

          // didn't exist?

          if (c === cl) {
            console.error('Animal.constructor: Morph Color missing for animal ' + animalName + '. Deploying backup plan.');

            attributes[animalName] = { type: 'c', boundTo: 'faces', value: [] as any[] };

            for (c = 0, cl = geometry.faces.length; c < cl; c++) {
              attributes[animalName].value.push(new THREE.Color(0xff0000));
            }
          }
        }
      } else {
        console.error("Animal.constructor: Morph Colors doesn't exist, deploying fallback!");

        for (c = 0, cl = geometry.faces.length; c < cl; c++) {
          attributes.colorAnimalA.value.push(new THREE.Color(0xff00ff));
        }

        attributes.colorAnimalB.value = attributes.colorAnimalA.value;

        for (a = 0, al = availableAnimals.length as any; a < al; a++) {
          attributes[availableAnimals[a]] = { type: 'c', boundTo: 'faces', value: attributes.colorAnimalA.value };
        }
      }

      // set return values

      geometry.availableAnimals = availableAnimals;
      geometry.customAttributes = material.attributes;
    } else {
      // create material

      material = new THREE.ShaderMaterial({
        uniforms: ROME.AnimalShader.uniforms(),
        attributes: {},
        vertexShader: ROME.AnimalShader.vertexShader,
        fragmentShader: ROME.AnimalShader.fragmentShader,

        fog: true,
        lights: true,
        morphTargets: true,
      });

      // copy custom attributes

      for (const a in geometry.customAttributes) {
        const srcAttribute = geometry.customAttributes[a];

        if (a === 'colorAnimalA' || a === 'colorAnimalB') {
          material.attributes[a] = {
            type: 'c',
            size: 3,
            boundTo: srcAttribute.boundTo,
            value: srcAttribute.value,
            array: undefined,
            buffer: undefined,
            needsUpdate: false,
            __webglInitialized: true,
          };
        } else {
          material.attributes[a] = srcAttribute;
        }
      }
    }

    return {
      availableAnimals: geometry.availableAnimals,
      material: material,
    };
  },
};

function randomizeColors(colors: any[], variations: any): void {
  for (let i = 0, il = colors.length; i < il; i++) {
    const _c = colors[i];
    const _hd = variations.hRange * Math.random() + variations.hOffset;
    const _sd = variations.sRange * Math.random() + variations.sOffset;
    const _vd = variations.vRange * Math.random() + variations.vOffset;
    // Color adjustment was commented out in original code
    void _c;
    void _hd;
    void _sd;
    void _vd;
  }
}

/**
 * Represents a fox.
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

  constructor(direction: number, zombieModel: any, name?: string, weaponCode?: number) {
    this.offset = zombieModel.offset;
    this.health = zombieModel.health;
    this.direction = direction || -1;
    this.name = name || '';
    this.weaponCode = weaponCode || 1;
    this.spawnTime = Date.now();
    this.baseX = 0;

    this.speed = (weaponCode === 4) ? 200 : 300;
    this.foxObj = new ROME.Animal(zombieModel.model.geometry, true);
    this.foxObj.play(this.foxObj.availableAnimals[0], this.foxObj.availableAnimals[0]);
    this.foxObj.animalA.timeScale = this.foxObj.animalB.timeScale = 0.9;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  update(elapsed: number): void {
    this.foxObj.mesh.position.z += elapsed * this.speed * this.direction;

    // Fox zigzag
    if (this.weaponCode === 1 && this.speed > 0) {
      const timeSinceSpawn = (Date.now() - this.spawnTime) / 1000;
      this.foxObj.mesh.position.x = this.baseX + this.offset.x + Math.sin(timeSinceSpawn * 4) * 50;
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
    this.foxObj.mesh.position.set(
      position.x + this.offset.x,
      position.y - 50 + this.offset.y,
      position.z + this.offset.z,
    );
  }
}
