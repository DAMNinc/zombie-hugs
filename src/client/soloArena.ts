import * as THREE from 'three';
import Constants from './constants';
import Fox from './fox';
import { loadLegacyJSON, type LegacyModelData } from './LegacyJSONLoader';
import Terrain from './terrain';
import { DEFENCES, ENTRY, LANES, PADS, STATION, SoloState, type DefenceKind, type Impact, type Lane } from './soloState';

const FLOOR = -50;
const PAD_RADIUS = 83;
const CREATURE_HALF_WIDTH = 79;
const CREATURE_HEIGHT = 145;
const COLOURS: Record<DefenceKind, number> = { launcher: 0xffa64b, sticky: 0x86e98d, barricade: 0xbcb0ff };
const LANE_COLOURS = [0x6c493c, 0x33516a];

function box(width: number, height: number, depth: number, color: number) {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshLambertMaterial({ color }));
}

function disc(radius: number, color: number, opacity = 1) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({ color, opacity, transparent: opacity < 1, depthWrite: opacity === 1 }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function remove(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>) {
  mesh.removeFromParent();
  mesh.geometry.dispose();
  mesh.material.dispose();
}

interface Creature {
  fox?: Fox;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
}

export class SoloArena {
  private scene = new THREE.Scene();
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private combat = new THREE.PerspectiveCamera(45, 1, 1, 10000);
  private overhead = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10000);
  private ray = new THREE.Raycaster();
  private floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR);
  private zombieModel?: LegacyModelData;
  private envelope = new THREE.Box3();
  private hitPoint = new THREE.Vector3();
  private padGroup = new THREE.Group();
  private range = disc(1, 0xffffff, 0.32);
  private ghost = disc(64, 0xffffff, 0.65);
  private creatures = new Map<number, Creature>();
  private obstacles = new Map<number, { mesh: ReturnType<typeof box>; kind: DefenceKind }>();
  private effects: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>; remaining: number }[] = [];
  private pulseMeshes = new Map<number, ReturnType<typeof box>>();
  private padMeshes = PADS.map(pad => {
    const mesh = disc(PAD_RADIUS, 0xf3d996, 0.75);
    mesh.position.set(LANES[pad.lane], FLOOR + 5, pad.z);
    this.padGroup.add(mesh);
    return mesh;
  });

  get canvas() { return this.renderer.domElement; }

  constructor(private host: HTMLElement) {
    void loadLegacyJSON('/content/zombie.json').then(model => {
      this.zombieModel = model;
    }).catch(error => {
      console.warn('Using the solo invader placeholder', error);
    });
    this.scene.background = new THREE.Color(0xa9d8e8);
    const light = new THREE.HemisphereLight(0xe8f5ff, 0x958779, 2.1);
    this.scene.add(light, new Terrain(128, 128, 0).getMesh(), this.padGroup, this.range, this.ghost);
    for (const [lane, x] of LANES.entries()) {
      const path = box(212, 3, STATION - ENTRY + 135, LANE_COLOURS[lane]);
      path.position.set(x, FLOOR + 2, (STATION + ENTRY) / 2);
      this.scene.add(path);
      const gate = box(206, 68, 34, lane === 0 ? 0xe5a080 : 0x92ccff);
      gate.position.set(x, FLOOR + 34, ENTRY - 60);
      this.scene.add(gate);
      for (let z = ENTRY + 70; z < STATION; z += 260) {
        for (const side of [-1, 1]) {
          const dash = box(8, 3, 70, 0xd9dfc5);
          dash.position.set(x + side * 96, FLOOR + 4, z);
          this.scene.add(dash);
        }
      }
    }
    const station = box(690, 22, 95, 0xffd267);
    station.position.set(0, FLOOR + 11, STATION + 72);
    this.scene.add(station);
    const shelter = box(153, 80, 92, 0x55b8ad);
    shelter.position.set(0, FLOOR + 40, STATION + 72);
    const roof = box(178, 18, 108, 0xdf7956);
    roof.position.set(0, FLOOR + 89, STATION + 72);
    this.scene.add(shelter, roof);
    this.combat.position.set(0, 200, STATION + 400);
    this.combat.rotation.x = -0.35;
    this.overhead.position.set(0, 2100, 410);
    this.overhead.lookAt(0, FLOOR, -120);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.append(this.canvas);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.host;
    if (!width || !height) return;
    const aspect = width / height;
    this.renderer.setSize(width, height, false);
    this.combat.aspect = aspect;
    this.combat.fov = Math.max(45, THREE.MathUtils.radToDeg(2 * Math.atan(0.6 / aspect)));
    this.combat.updateProjectionMatrix();
    const halfHeight = Math.max(1300, 475 / aspect);
    this.overhead.left = -halfHeight * aspect;
    this.overhead.right = halfHeight * aspect;
    this.overhead.top = halfHeight;
    this.overhead.bottom = -halfHeight;
    this.overhead.updateProjectionMatrix();
  }

  private aim(event: PointerEvent, camera: THREE.Camera) {
    const bounds = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(
      (event.clientX - bounds.left) / bounds.width * 2 - 1,
      1 - (event.clientY - bounds.top) / bounds.height * 2,
    ), camera);
  }

  padPoint(event: PointerEvent) {
    this.aim(event, this.overhead);
    return this.ray.ray.intersectPlane(this.floor, this.hitPoint);
  }

  combatLane(event: PointerEvent, state: SoloState): Lane | undefined {
    this.aim(event, this.combat);
    let nearest = Infinity;
    let lane: Lane | undefined;
    for (const enemy of state.invaders) {
      const x = this.creatureX(enemy.lane, enemy.id);
      this.envelope.min.set(x - CREATURE_HALF_WIDTH, FLOOR, enemy.z - 45);
      this.envelope.max.set(x + CREATURE_HALF_WIDTH, FLOOR + CREATURE_HEIGHT, enemy.z + 45);
      const hit = this.ray.ray.intersectBox(this.envelope, this.hitPoint);
      if (!hit) continue;
      const distance = hit.distanceToSquared(this.combat.position);
      if (distance < nearest) {
        nearest = distance;
        lane = enemy.lane;
      }
    }
    if (lane !== undefined) return lane;

    const point = this.ray.ray.intersectPlane(this.floor, this.hitPoint);
    if (!point || point.z < ENTRY - 100 || point.z > STATION + 120) return;
    const groundLane = point.x < 0 ? 0 : 1;
    if (Math.abs(point.x - LANES[groundLane]) <= 142) return groundLane;
  }

  private creatureX(lane: Lane, id: number) {
    return LANES[lane] + ((id * 7) % 9 - 4) * 18;
  }

  private createCreature(): Creature {
    if (!this.zombieModel) {
      const mesh = box(73, 106, 57, 0xadd66d);
      mesh.geometry.translate(0, 53, 0);
      return { mesh };
    }
    const fox = new Fox(1, { model: this.zombieModel, offset: { x: 0, y: 0, z: 0 } },
      undefined, Constants.ZOMBIE, undefined, 0);
    const mesh = fox.getMesh() as Creature['mesh'];
    mesh.scale.setScalar(15);
    return { fox, mesh };
  }

  padAt(point: THREE.Vector3 | null) {
    return point ? PADS.find(pad => Math.hypot(point.x - LANES[pad.lane], point.z - pad.z) <= PAD_RADIUS)?.id ?? -1 : -1;
  }

  impact(impact: Impact) {
    const color = impact.kind === 'chain' ? 0xcaff8c : impact.kind === 'fox' ? 0xffa64b : 0xa9eaff;
    const splash = disc(impact.kind === 'chain' ? 92 : 57, color, 0.73);
    splash.position.set(LANES[impact.lane], FLOOR + 12, impact.z);
    this.effects.push({ mesh: splash, remaining: 0.36 });
    this.scene.add(splash);
    if (impact.from !== undefined) {
      const trail = box(19, 13, Math.max(15, Math.abs(impact.from - impact.z)), color);
      trail.position.set(LANES[impact.lane], FLOOR + 43, (impact.from + impact.z) / 2);
      this.effects.push({ mesh: trail, remaining: 0.19 });
      this.scene.add(trail);
    }
  }

  resetEffects() {
    for (const effect of this.effects) remove(effect.mesh);
    this.effects = [];
  }

  render(state: SoloState, building: boolean, selected: number, kind: DefenceKind, dt: number) {
    this.padGroup.visible = building;
    const pad = PADS[selected];
    this.range.visible = this.ghost.visible = building && !!pad;
    if (building && pad) {
      const { range, reason } = state.placement(selected, kind);
      this.range.scale.setScalar(range);
      this.range.position.set(LANES[pad.lane], FLOOR + 7, pad.z);
      this.range.material.color.setHex(reason ? 0xff786b : COLOURS[kind]);
      this.ghost.position.set(LANES[pad.lane], FLOOR + 9, pad.z);
      this.ghost.material.color.copy(this.range.material.color);
    }
    for (const p of PADS) {
      const defence = state.defences.get(p.id);
      const current = this.obstacles.get(p.id);
      if (current && current.kind !== defence?.kind) {
        remove(current.mesh);
        this.obstacles.delete(p.id);
      }
      this.padMeshes[p.id].material.color.setHex(defence ? COLOURS[defence.kind] : 0xf3d996);
      if (!defence) continue;
      let obstacle = this.obstacles.get(p.id);
      if (!obstacle) {
        const mesh = defence.kind === 'barricade' ? box(195, 46, 35, COLOURS.barricade)
          : defence.kind === 'sticky' ? box(175, 6, 155, COLOURS.sticky)
          : box(80, 90, 80, COLOURS.launcher);
        mesh.position.set(LANES[p.lane], FLOOR + mesh.geometry.parameters.height / 2 + 4, p.z);
        this.scene.add(mesh);
        obstacle = { mesh, kind: defence.kind };
        this.obstacles.set(p.id, obstacle);
      }
      obstacle.mesh.scale.y = defence.upgraded ? 1.25 : 1;
      if (defence.kind === 'barricade') {
        obstacle.mesh.material.color.setHex(COLOURS.barricade).multiplyScalar(0.5 + defence.durability / 48);
      }
    }

    for (const [id, creature] of this.creatures) {
      if (state.invaders.some(enemy => enemy.id === id)) continue;
      remove(creature.mesh);
      this.creatures.delete(id);
    }
    for (const enemy of state.invaders) {
      let creature = this.creatures.get(enemy.id);
      if (!creature || (!creature.fox && this.zombieModel)) {
        if (creature) remove(creature.mesh);
        creature = this.createCreature();
        this.scene.add(creature.mesh);
        this.creatures.set(enemy.id, creature);
      }
      creature.mesh.position.set(this.creatureX(enemy.lane, enemy.id), FLOOR, enemy.z);
      creature.fox?.update(dt * enemy.stride);
    }

    for (const [id, mesh] of this.pulseMeshes) {
      if (state.pulses.some(pulse => pulse.id === id)) continue;
      remove(mesh);
      this.pulseMeshes.delete(id);
    }
    for (const pulse of state.pulses) {
      let mesh = this.pulseMeshes.get(pulse.id);
      if (!mesh) {
        mesh = box(pulse.charged ? 85 : 38, 30, 76, pulse.charged ? 0xffdf81 : 0x9ae3ff);
        this.pulseMeshes.set(pulse.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(LANES[pulse.lane], FLOOR + 36, pulse.z);
    }
    this.effects = this.effects.filter(effect => {
      effect.remaining -= dt;
      if (effect.remaining > 0) return true;
      remove(effect.mesh);
      return false;
    });
    this.renderer.render(this.scene, building ? this.overhead : this.combat);
  }
}
