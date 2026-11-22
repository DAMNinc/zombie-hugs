import * as THREE from 'three';
import { readableText } from './arena';

const ringGeo = new THREE.RingGeometry(62, 82, 40);
const targetRingGeo = new THREE.RingGeometry(95, 118, 40);
ringGeo.userData.shared = true;
targetRingGeo.userData.shared = true;

function makeLabel(seat: number, name: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(10,10,10,0.75)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(4, 8, 376, 80, 40) : ctx.rect(4, 8, 376, 80);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(52, 48, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = readableText(color);
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(seat + 1), 52, 52);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px sans-serif';
    ctx.textAlign = 'left';
    let text = name;
    while (text.length > 1 && ctx.measureText(text).width > 270) text = text.slice(0, -1);
    ctx.fillText(text === name ? text : text + '…', 100, 52);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
  sprite.scale.set(240, 60, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Seat colour ring on the ground, floating "seat number + name" label, and a pulsing target marker. */
export default class PlayerTag {
  group = new THREE.Group();
  private ring: THREE.Mesh;
  private targetRing: THREE.Mesh;
  private label: THREE.Sprite;
  private arrow: THREE.Mesh;

  constructor(seat: number, name: string, color: string) {
    const c = new THREE.Color(color);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
    this.targetRing = new THREE.Mesh(targetRingGeo, new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }));
    for (const r of [this.ring, this.targetRing]) {
      r.rotation.x = -Math.PI / 2;
      r.position.y = 3;
      this.group.add(r);
    }
    this.targetRing.visible = false;
    this.label = makeLabel(seat, name, color);
    this.label.position.y = 190;
    this.group.add(this.label);
    this.arrow = new THREE.Mesh(
      new THREE.ConeGeometry(26, 50, 4),
      new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true }),
    );
    this.arrow.rotation.x = Math.PI; // point down
    this.arrow.renderOrder = 10;
    this.arrow.visible = false;
    this.group.add(this.arrow);
  }

  /** Follow the player model (ground y is -50). */
  update(pos: { x: number; y: number; z: number }, isTarget: boolean, alive: boolean, pulse: number): void {
    this.group.position.set(pos.x, -50, pos.z);
    this.targetRing.visible = isTarget;
    this.arrow.visible = isTarget;
    if (isTarget) {
      const s = 1 + 0.12 * pulse;
      this.targetRing.scale.set(s, s, s);
      this.arrow.position.y = 260 + 18 * pulse;
    }
    (this.label.material as THREE.SpriteMaterial).opacity = alive ? 1 : 0.35;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = alive ? 0.9 : 0.3;
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.group.traverse((o: any) => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}
