/**
 * Loader for old Three.js JSON model format (v2/v3).
 * Replaces the removed THREE.JSONLoader.
 */
import * as THREE from 'three';

interface ParsedFace {
  a: number;
  b: number;
  c: number;
  materialIndex: number;
  vertexNormals: number[];
  vertexUvs: number[];
  color: number | null;
}

interface MorphTarget {
  name: string;
  vertices: number[];
}

interface MorphColor {
  name: string;
  colors: THREE.Color[];
}

export interface LegacyModelData {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  /** Morph target names in order, for animation lookup */
  morphTargetNames: string[];
  /** Per-face colors from morphColors, keyed by extracted animal name */
  morphColorData: MorphColor[];
}

export function loadLegacyJSON(url: string): Promise<LegacyModelData> {
  return fetch(url)
    .then((res) => res.json())
    .then((json) => parseLegacyJSON(json));
}

export function parseLegacyJSON(json: any): LegacyModelData {
  const scale = json.scale !== undefined ? 1.0 / json.scale : 1;
  const vertices = json.vertices as number[];
  const normals = (json.normals || []) as number[];
  const uvLayers = (json.uvs || []) as number[][];
  const facesArray = json.faces as number[];
  const colors = (json.colors || []) as number[];


  // Parse faces
  const faces: ParsedFace[] = [];
  let offset = 0;

  while (offset < facesArray.length) {
    const type = facesArray[offset++];
    const isQuad = (type & 1) !== 0;
    const hasMaterial = (type & 2) !== 0;
    const hasFaceVertexUv = (type & 8) !== 0;
    const hasFaceNormal = (type & 16) !== 0;
    const hasFaceVertexNormal = (type & 32) !== 0;
    const hasFaceColor = (type & 64) !== 0;
    const hasFaceVertexColor = (type & 128) !== 0;

    const nVerts = isQuad ? 4 : 3;
    const vis: number[] = [];
    for (let i = 0; i < nVerts; i++) vis.push(facesArray[offset++]);

    let materialIndex = 0;
    if (hasMaterial) materialIndex = facesArray[offset++];

    // Skip face UV (per-face, rarely used)
    if (type & 4) {
      for (let i = 0; i < uvLayers.length; i++) offset++;
    }

    const vertexUvs: number[] = [];
    if (hasFaceVertexUv) {
      for (let layer = 0; layer < uvLayers.length; layer++) {
        for (let i = 0; i < nVerts; i++) {
          vertexUvs.push(facesArray[offset++]);
        }
      }
    }

    let faceNormal = -1;
    if (hasFaceNormal) faceNormal = facesArray[offset++];

    const vertexNormals: number[] = [];
    if (hasFaceVertexNormal) {
      for (let i = 0; i < nVerts; i++) vertexNormals.push(facesArray[offset++]);
    }

    let faceColor: number | null = null;
    if (hasFaceColor) faceColor = facesArray[offset++];

    if (hasFaceVertexColor) {
      for (let i = 0; i < nVerts; i++) offset++; // skip vertex colors
    }

    // First triangle
    faces.push({
      a: vis[0],
      b: vis[1],
      c: vis[2],
      materialIndex,
      vertexNormals: hasFaceVertexNormal
        ? [vertexNormals[0], vertexNormals[1], vertexNormals[2]]
        : hasFaceNormal
          ? [faceNormal, faceNormal, faceNormal]
          : [],
      vertexUvs: hasFaceVertexUv ? [vertexUvs[0], vertexUvs[1], vertexUvs[2]] : [],
      color: faceColor,
    });

    // Second triangle for quads
    if (isQuad) {
      faces.push({
        a: vis[0],
        b: vis[2],
        c: vis[3],
        materialIndex,
        vertexNormals: hasFaceVertexNormal
          ? [vertexNormals[0], vertexNormals[2], vertexNormals[3]]
          : hasFaceNormal
            ? [faceNormal, faceNormal, faceNormal]
            : [],
        vertexUvs: hasFaceVertexUv ? [vertexUvs[0], vertexUvs[2], vertexUvs[3]] : [],
        color: faceColor,
      });
    }
  }

  // Build non-indexed BufferGeometry (needed for per-face colors/materials)
  const numVerts = faces.length * 3;
  const positions = new Float32Array(numVerts * 3);
  const uvsArr = uvLayers.length > 0 ? new Float32Array(numVerts * 2) : null;
  const normalsArr = normals.length > 0 ? new Float32Array(numVerts * 3) : null;

  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    const idx = [f.a, f.b, f.c];
    for (let v = 0; v < 3; v++) {
      const vi = idx[v];
      const out = (fi * 3 + v) * 3;
      positions[out] = vertices[vi * 3] * scale;
      positions[out + 1] = vertices[vi * 3 + 1] * scale;
      positions[out + 2] = vertices[vi * 3 + 2] * scale;

      if (normalsArr && f.vertexNormals.length > 0) {
        const ni = f.vertexNormals[v];
        normalsArr[out] = normals[ni * 3];
        normalsArr[out + 1] = normals[ni * 3 + 1];
        normalsArr[out + 2] = normals[ni * 3 + 2];
      }

      if (uvsArr && f.vertexUvs.length > 0) {
        const ui = f.vertexUvs[v];
        const uvOut = (fi * 3 + v) * 2;
        uvsArr[uvOut] = uvLayers[0][ui * 2];
        uvsArr[uvOut + 1] = uvLayers[0][ui * 2 + 1];
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normalsArr) geometry.setAttribute('normal', new THREE.BufferAttribute(normalsArr, 3));
  if (uvsArr) geometry.setAttribute('uv', new THREE.BufferAttribute(uvsArr, 2));

  // Compute normals if not provided
  if (!normalsArr) {
    geometry.computeVertexNormals();
  }

  // Material groups (for multi-material models like monster)
  const materialGroups = new Map<number, { start: number; count: number }>();
  for (let fi = 0; fi < faces.length; fi++) {
    const mi = faces[fi].materialIndex;
    const existing = materialGroups.get(mi);
    if (!existing) {
      materialGroups.set(mi, { start: fi * 3, count: 3 });
    } else {
      // Extend group (assumes faces are roughly grouped by material)
      if (existing.start + existing.count === fi * 3) {
        existing.count += 3;
      } else {
        // Non-contiguous — just extend to cover
        existing.count = fi * 3 + 3 - existing.start;
      }
    }
  }
  if (materialGroups.size > 1) {
    for (const [mi, group] of materialGroups) {
      geometry.addGroup(group.start, group.count, mi);
    }
  }

  // Morph targets → morphAttributes.position
  const morphTargetNames: string[] = [];
  const jsonMorphTargets = (json.morphTargets || []) as MorphTarget[];

  if (jsonMorphTargets.length > 0) {
    const morphPositions: THREE.BufferAttribute[] = [];

    for (const mt of jsonMorphTargets) {
      morphTargetNames.push(mt.name);
      const mtVerts = mt.vertices;
      const mtPositions = new Float32Array(numVerts * 3);

      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const idx = [f.a, f.b, f.c];
        for (let v = 0; v < 3; v++) {
          const vi = idx[v];
          const out = (fi * 3 + v) * 3;
          mtPositions[out] = mtVerts[vi * 3] * scale;
          mtPositions[out + 1] = mtVerts[vi * 3 + 1] * scale;
          mtPositions[out + 2] = mtVerts[vi * 3 + 2] * scale;
        }
      }

      morphPositions.push(new THREE.BufferAttribute(mtPositions, 3));
    }

    geometry.morphAttributes.position = morphPositions;
    geometry.morphTargetsRelative = false;
  }

  // Morph colors → per-face colors expanded to per-vertex
  const morphColorData: MorphColor[] = [];
  const jsonMorphColors = (json.morphColors || []) as { name: string; colors: number[] }[];

  for (const mc of jsonMorphColors) {
    const faceColors: THREE.Color[] = [];
    for (let i = 0; i < mc.colors.length; i += 3) {
      faceColors.push(new THREE.Color(mc.colors[i], mc.colors[i + 1], mc.colors[i + 2]));
    }
    morphColorData.push({ name: mc.name, colors: faceColors });
  }

  // If there are face colors, apply first morph color set as vertex colors
  if (faces[0]?.color !== null && colors.length > 0) {
    const colorsArr = new Float32Array(numVerts * 3);
    for (let fi = 0; fi < faces.length; fi++) {
      const ci = faces[fi].color!;
      // Colors in JSON are hex integers
      const hex = colors[ci];
      const r = ((hex >> 16) & 0xff) / 255;
      const g = ((hex >> 8) & 0xff) / 255;
      const b = (hex & 0xff) / 255;
      for (let v = 0; v < 3; v++) {
        const out = (fi * 3 + v) * 3;
        colorsArr[out] = r;
        colorsArr[out + 1] = g;
        colorsArr[out + 2] = b;
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colorsArr, 3));
  } else if (morphColorData.length > 0) {
    // Apply first morph color as vertex colors
    const mc = morphColorData[0];
    const colorsArr = new Float32Array(numVerts * 3);
    for (let fi = 0; fi < faces.length; fi++) {
      const c = fi < mc.colors.length ? mc.colors[fi] : new THREE.Color(0xff00ff);
      for (let v = 0; v < 3; v++) {
        const out = (fi * 3 + v) * 3;
        colorsArr[out] = c.r;
        colorsArr[out + 1] = c.g;
        colorsArr[out + 2] = c.b;
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colorsArr, 3));
  }

  // Parse materials
  const materials: THREE.Material[] = [];
  const jsonMaterials = json.materials || [];

  for (const jm of jsonMaterials) {
    const params: any = {};
    if (jm.colorDiffuse) {
      params.color = new THREE.Color(jm.colorDiffuse[0], jm.colorDiffuse[1], jm.colorDiffuse[2]);
    } else if (jm.DbgColor) {
      params.color = new THREE.Color(jm.DbgColor);
    }
    if (jm.transparency !== undefined && jm.transparency < 1) {
      params.transparent = true;
      params.opacity = jm.transparency;
    }
    if (jm.vertexColors) {
      params.vertexColors = true;
    }
    materials.push(new THREE.MeshLambertMaterial(params));
  }

  if (materials.length === 0) {
    materials.push(new THREE.MeshLambertMaterial({ vertexColors: true }));
  }

  return { geometry, materials, morphTargetNames, morphColorData };
}
