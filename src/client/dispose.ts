import * as THREE from 'three';

const TEXTURE_KEYS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap',
  'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap', 'specularMap',
];

/**
 * Free the GPU resources of an object and its children.
 *
 * Only call this for meshes that own their geometry and materials (clones or
 * per-object instances). Shared sources (model data geometry, shared materials
 * or textures) must be marked with `userData.shared = true` on the geometry,
 * material or texture to be skipped.
 */
export function disposeObject(obj: THREE.Object3D | null | undefined): void {
  if (!obj) return;
  obj.traverse((child: any) => {
    const geometry: THREE.BufferGeometry | undefined = child.geometry;
    if (geometry && !geometry.userData?.shared) geometry.dispose();

    const material = child.material;
    if (!material) return;
    const materials: any[] = Array.isArray(material) ? material : [material];
    for (const m of materials) {
      if (!m || m.userData?.shared) continue;
      for (const key of TEXTURE_KEYS) {
        const tex = m[key];
        if (tex && tex.dispose && !tex.userData?.shared) tex.dispose();
      }
      m.dispose();
    }
  });
}
