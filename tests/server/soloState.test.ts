import { describe, expect, it } from 'vitest';
import { CHARGE_MS, PADS, SoloState, STATION_HP, WAVES } from '../../src/client/soloState';

function until(state: SoloState, condition: () => boolean, seconds = 60, act = () => {}) {
  for (let i = 0; i < seconds * 60 && !condition(); i++) {
    act();
    state.tick(1 / 60);
  }
  expect(condition()).toBe(true);
}

describe('solo defence', () => {
  it('previews, purchases and upgrades each defence once and rejects invalid actions atomically', () => {
    const state = new SoloState();
    const startingScrap = state.scrap;
    expect(state.placement(0, 'launcher')).toMatchObject({ cost: 30, range: 320, reason: '' });
    expect(state.build(-1, 'launcher')).toBe(false);
    expect(state.scrap).toBe(startingScrap);
    expect(state.defences.size).toBe(0);

    expect(state.build(0, 'launcher')).toBe(true);
    expect(state.build(1, 'sticky')).toBe(true);
    expect(state.build(2, 'barricade')).toBe(true);
    expect(state.build(0, 'sticky')).toBe(false);
    expect(state.build(3, 'launcher')).toBe(false);
    expect(state.scrap).toBe(6);
    expect(state.defences.size).toBe(3);

    state.scrap += 80;
    expect(state.startWave()).toBe(true);
    expect(state.startWave()).toBe(false);
    expect(state.placement(0, 'launcher')).toMatchObject({ cost: 24, range: 440, upgrade: true });
    expect(state.build(0, 'launcher')).toBe(true);
    expect(state.build(1, 'sticky')).toBe(true);
    expect(state.build(2, 'barricade')).toBe(true);
    expect(state.build(2, 'barricade')).toBe(false);
    expect(state.scrap).toBe(30);
    expect([...state.defences.values()].every(defence => defence.upgraded)).toBe(true);

    until(state, () => state.invaders.some(e => e.lane === PADS[4].lane && Math.abs(e.z - PADS[4].z) < 70));
    const board = structuredClone(state.defences);
    const balance = state.scrap;
    expect(state.build(4, 'barricade')).toBe(false);
    expect(state.defences).toEqual(board);
    expect(state.scrap).toBe(balance);
  });

  it('stacks slowed invaders at a barricade and chains a charged shot through them', () => {
    const state = new SoloState();
    expect(state.fire(0, CHARGE_MS)).toBe(false);
    state.build(0, 'sticky');
    state.build(1, 'barricade');
    state.startWave();
    until(state, () => state.invaders.filter(e => e.lane === 0 && e.stride === 0).length === 3);
    expect(state.invaders.filter(e => e.stride === 0).every(e => e.sticky)).toBe(true);
    const before = state.scrap;
    expect(state.fire(0, CHARGE_MS)).toBe(true);
    until(state, () => state.chain >= 3);
    expect(state.scrap).toBeGreaterThanOrEqual(before + 9);
    until(state, () => state.phase === 'planning');
    expect(state.cleared).toBe(1);
    expect(state.scrap).toBeGreaterThanOrEqual(before + 9 + 14);
  });

  it('wins through Stampede with charged shots and freezes on either terminal outcome', () => {
    const state = new SoloState();
    state.build(2, 'launcher');
    state.build(6, 'launcher');
    for (const [index, wave] of WAVES.entries()) {
      expect(state.cleared).toBe(index);
      if (index === 4) expect(wave.name).toBe('Stampede');
      if (index > 0) {
        for (const id of [2, 6, 3, 7, 0, 4]) {
          state.build(id, id === 0 || id === 4 ? 'sticky' : 'launcher');
        }
      }
      expect(state.startWave()).toBe(true);
      let ticks = 0;
      let lane: 0 | 1 = 0;
      until(state, () => state.phase !== 'wave', 60, () => {
        // Alternate lanes with 1.3 seconds between shots to allow for charging.
        if (++ticks % 78 === 0) {
          state.fire(lane, CHARGE_MS);
          lane = lane === 0 ? 1 : 0;
        }
      });
    }
    expect(state.phase).toBe('won');
    expect(state.cleared).toBe(5);
    expect(state.startWave()).toBe(false);
    expect(state.build(3, 'launcher')).toBe(false);

    const abandoned = new SoloState();
    for (let i = 0; i < 3 && abandoned.phase !== 'lost'; i++) {
      abandoned.startWave();
      until(abandoned, () => abandoned.phase !== 'wave');
    }
    expect(abandoned.phase).toBe('lost');
    expect(abandoned.health).toBe(0);
    expect(abandoned.fire(0, CHARGE_MS)).toBe(false);
    expect(abandoned.startWave()).toBe(false);
    expect(new SoloState()).toMatchObject({ phase: 'planning', health: STATION_HP, cleared: 0, scrap: 76 });
  });
});
