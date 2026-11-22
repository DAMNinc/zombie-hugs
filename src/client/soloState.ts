export const LANES = [-230, 230] as const;
export type Lane = 0 | 1;

export const ENTRY = -1240;
export const STATION = 950;
export const STATION_HP = 20;
export const CHARGE_MS = 1000;

export const DEFENCES = {
  launcher: { name: 'Fox Launcher', cost: 30, upgrade: 24, range: 320, improvedRange: 440, perk: 'Longer range and faster fire' },
  sticky: { name: 'Sticky Patch', cost: 18, upgrade: 14, range: 240, improvedRange: 330, perk: 'Larger patch and stronger slow' },
  barricade: { name: 'Barricade', cost: 22, upgrade: 18, range: 85, improvedRange: 85, perk: 'Repairs and doubles durability' },
} as const;

export type DefenceKind = keyof typeof DEFENCES;
export const PADS = LANES.flatMap((_, lane) => [-780, -520, 120, 560].map((z, slot) => ({
  id: lane * 4 + slot,
  lane: lane as Lane,
  z,
})));

export const WAVES = [
  { name: 'Scouts', count: 8, interval: 0.9, speed: 190, hp: 1 },
  { name: 'Double Trouble', count: 12, interval: 0.65, speed: 220, hp: 2 },
  { name: 'Heavy Hugs', count: 16, interval: 0.55, speed: 245, hp: 3 },
  { name: 'Rush Hour', count: 20, interval: 0.38, speed: 290, hp: 3 },
  { name: 'Stampede', count: 28, interval: 0.24, speed: 360, hp: 4 },
] as const;

export interface Invader {
  id: number;
  lane: Lane;
  z: number;
  hp: number;
  stride: number;
  sticky: boolean;
}

interface Defence {
  kind: DefenceKind;
  upgraded: boolean;
  durability: number;
  cooldown: number;
}

interface Pulse {
  id: number;
  lane: Lane;
  z: number;
  charged: boolean;
}

export interface Impact {
  lane: Lane;
  z: number;
  kind: 'fox' | 'shot' | 'chain';
  from?: number;
}

type Phase = 'planning' | 'wave' | 'won' | 'lost';

export class SoloState {
  phase: Phase = 'planning';
  cleared = 0;
  health = STATION_HP;
  scrap = 76;
  cooldown = 0;
  chain = 0;
  invaders: Invader[] = [];
  pulses: Pulse[] = [];
  defences = new Map<number, Defence>();
  impacts: Impact[] = [];
  private nextId = 0;
  private spawned = 0;
  private spawnIn = 0;

  placement(id: number, kind: DefenceKind) {
    const existing = this.defences.get(id);
    const info = DEFENCES[kind];
    const cost = existing ? info.upgrade : info.cost;
    const range = existing ? info.improvedRange : info.range;
    let reason = '';
    if (this.phase === 'won' || this.phase === 'lost') reason = 'Run finished';
    else if (!PADS[id]) reason = 'Choose a build pad';
    else if (existing && existing.kind !== kind) reason = 'Pad is occupied';
    else if (existing?.upgraded) reason = 'Already upgraded';
    else if (this.scrap < cost) reason = 'Not enough scrap';
    else if (!existing && this.invaders.some(e => e.lane === PADS[id].lane && Math.abs(e.z - PADS[id].z) < 75)) {
      reason = 'Creatures are on this pad';
    }
    return { cost, range, reason, upgrade: !!existing && existing.kind === kind };
  }

  build(id: number, kind: DefenceKind): boolean {
    const { cost, reason, upgrade } = this.placement(id, kind);
    if (reason) return false;
    this.scrap -= cost;
    this.defences.set(id, { kind, upgraded: upgrade, durability: upgrade ? 24 : 12, cooldown: 0 });
    return true;
  }

  startWave(): boolean {
    if (this.phase !== 'planning') return false;
    this.phase = 'wave';
    this.spawned = 0;
    this.spawnIn = 0;
    this.chain = 0;
    return true;
  }

  fire(lane: Lane, chargeMs: number): boolean {
    if (this.phase !== 'wave' || this.cooldown > 0) return false;
    this.cooldown = 0.42;
    this.pulses.push({ id: this.nextId++, lane, z: STATION, charged: chargeMs >= CHARGE_MS });
    return true;
  }

  private hit(invader: Invader, damage: number, kind: Impact['kind'], from?: number) {
    invader.hp -= damage;
    this.impacts.push({ lane: invader.lane, z: invader.z, kind, from });
    if (invader.hp <= 0) this.scrap += 3;
  }

  private strike(target: Invader, charged: boolean) {
    this.hit(target, charged ? 5 : 1, 'shot');
    if (!charged) return;

    const pack = [target];
    const reached = new Set(pack);
    for (const source of pack) {
      for (const enemy of this.invaders) {
        if (enemy.hp <= 0 || reached.has(enemy) || enemy.lane !== target.lane) continue;
        const radius = source.sticky || enemy.sticky ? 155 : 65;
        if (Math.abs(source.z - enemy.z) <= radius) {
          reached.add(enemy);
          pack.push(enemy);
          this.hit(enemy, 5, 'chain', source.z);
        }
      }
    }
    this.chain = pack.length > 1 ? pack.length : this.chain;
  }

  // Called with small simulation steps. Rendering and input never own invader positions.
  tick(dt: number) {
    this.impacts = [];
    if (this.phase !== 'wave') return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const wave = WAVES[this.cleared];
    this.spawnIn -= dt;
    if (this.spawned < wave.count && this.spawnIn <= 0) {
      const lane = (Math.floor(this.spawned / 3) % 2) as Lane;
      this.invaders.push({ id: this.nextId++, lane, z: ENTRY, hp: wave.hp, stride: 0, sticky: false });
      this.spawned++;
      this.spawnIn += wave.interval;
    }

    for (const enemy of this.invaders) {
      let pace = 1;
      for (const pad of PADS) {
        const defence = this.defences.get(pad.id);
        if (pad.lane !== enemy.lane || defence?.kind !== 'sticky') continue;
        const range = defence.upgraded ? DEFENCES.sticky.improvedRange : DEFENCES.sticky.range;
        if (Math.abs(pad.z - enemy.z) <= range) pace = Math.min(pace, defence.upgraded ? 0.22 : 0.38);
      }
      enemy.sticky = pace < 1;
      const advance = wave.speed * dt * pace;
      const block = PADS.find(pad => pad.lane === enemy.lane && pad.z - 52 >= enemy.z &&
        pad.z - 52 <= enemy.z + advance &&
        this.defences.get(pad.id)?.kind === 'barricade');
      const next = block ? block.z - 52 : enemy.z + advance;
      enemy.stride = (next - enemy.z) / dt / wave.speed;
      enemy.z = next;
      if (block) {
        const defence = this.defences.get(block.id)!;
        defence.durability -= dt * 0.9;
        if (defence.durability <= 0) this.defences.delete(block.id);
      }
    }

    for (const pad of PADS) {
      const defence = this.defences.get(pad.id);
      if (defence?.kind !== 'launcher') continue;
      defence.cooldown -= dt;
      const range = defence.upgraded ? DEFENCES.launcher.improvedRange : DEFENCES.launcher.range;
      const target = this.invaders.find(enemy => enemy.hp > 0 && enemy.lane === pad.lane && Math.abs(enemy.z - pad.z) <= range);
      if (target && defence.cooldown <= 0) {
        this.hit(target, 1, 'fox', pad.z);
        defence.cooldown = defence.upgraded ? 0.38 : 0.78;
      }
    }

    this.pulses = this.pulses.filter(pulse => {
      // Test the whole travelled segment so a pulse cannot skip a creature.
      const next = pulse.z - dt * 2700;
      const target = this.invaders.reduce<Invader | undefined>((closest, enemy) => {
        if (enemy.hp <= 0 || enemy.lane !== pulse.lane || enemy.z < next - 35 || enemy.z > pulse.z + 35) return closest;
        return !closest || enemy.z > closest.z ? enemy : closest;
      }, undefined);
      if (target) {
        this.strike(target, pulse.charged);
        return false;
      }
      pulse.z = next;
      return next >= ENTRY;
    });

    this.invaders = this.invaders.filter(enemy => {
      if (enemy.hp <= 0) return false;
      if (enemy.z < STATION) return true;
      this.health = Math.max(0, this.health - (this.cleared === 4 ? 2 : 1));
      return false;
    });

    if (this.health === 0) {
      this.phase = 'lost';
    } else if (this.spawned === wave.count && this.invaders.length === 0) {
      this.cleared++;
      this.scrap += 14;
      this.phase = this.cleared === WAVES.length ? 'won' : 'planning';
    }
    if (this.phase !== 'wave') {
      this.pulses = [];
      this.cooldown = 0;
    }
  }
}
