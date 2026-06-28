/**
 * CTRL — 3D surface mesh from a potential function V(x, y).
 *
 * Creates a PlaneGeometry-based mesh whose vertex heights and colors
 * are driven by an arbitrary function. Supports real-time updates
 * when the function parameters change (e.g., slider values).
 */

import * as THREE from 'three';
import { depthColorTo } from './colors.js';

/**
 * Create a surface mesh for V(x, y).
 *
 * @param {Function} V          — V(x, y) → height
 * @param {Object}   opts
 * @param {number[]} opts.xRange      — [xMin, xMax]  default [-2, 2]
 * @param {number[]} opts.yRange      — [yMin, yMax]  default [-2, 2]
 * @param {number}   opts.resolution  — segments per axis, default 128
 * @param {number}   opts.heightScale — visual height multiplier, default 1.0
 * @param {number}   opts.opacity     — surface opacity 0-1, default 1.0
 * @param {boolean}  opts.wireframe   — default false
 * @returns {THREE.Mesh}
 */
export function createSurfaceMesh(V, opts = {}) {
  const xRange = opts.xRange || [-2, 2];
  const yRange = opts.yRange || [-2, 2];
  const res = opts.resolution || 128;
  const heightScale = opts.heightScale ?? 1.0;
  const opacity = opts.opacity ?? 1.0;

  const xSize = xRange[1] - xRange[0];
  const ySize = yRange[1] - yRange[0];

  const geo = new THREE.PlaneGeometry(xSize, ySize, res, res);
  geo.rotateX(-Math.PI / 2); // lay flat in XZ plane, Y = up

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Initial height pass
  _applyHeights(geo, V, xRange, yRange, heightScale);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    metalness: 0.1,
    roughness: 0.7,
    flatShading: false,
    transparent: opacity < 1,
    opacity: opacity,
    depthWrite: opacity >= 1,
  });

  if (opts.wireframe) mat.wireframe = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData._xRange = xRange;
  mesh.userData._yRange = yRange;
  mesh.userData._heightScale = heightScale;
  return mesh;
}

/**
 * Update the surface mesh with new V (e.g., after slider change).
 *
 * @param {THREE.Mesh} mesh — mesh created by createSurfaceMesh
 * @param {Function}   V    — V(x, y) → height
 */
export function updateSurfaceMesh(mesh, V) {
  const geo = mesh.geometry;
  const { _xRange, _yRange, _heightScale } = mesh.userData;
  _applyHeights(geo, V, _xRange, _yRange, _heightScale);
}

/** Internal: set vertex Y-positions and colors from V. */
function _applyHeights(geo, V, xRange, yRange, heightScale) {
  const pos = geo.attributes.position;
  const colorAttr = geo.attributes.color;
  const count = pos.count;

  const xMin = xRange[0], xSize = xRange[1] - xRange[0];
  const yMin = yRange[0], ySize = yRange[1] - yRange[0];

  // First pass: compute heights and find range
  const heights = new Float32Array(count);
  let hMin = Infinity, hMax = -Infinity;

  for (let i = 0; i < count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const fx = xMin + ((px + xSize / 2) / xSize) * xSize;
    const fy = yMin + ((pz + ySize / 2) / ySize) * ySize;
    const h = V(fx, fy);
    heights[i] = h;
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }

  const hRange = hMax - hMin || 1;
  const vMin = hMin - hRange * 0.05;
  const vMax = hMax + hRange * 0.05;

  // Second pass: apply scaled heights and colors
  const tmpColor = new THREE.Color();
  for (let i = 0; i < count; i++) {
    pos.setY(i, heights[i] * heightScale);
    depthColorTo(tmpColor, heights[i], vMin, vMax);
    colorAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
  }

  pos.needsUpdate = true;
  colorAttr.needsUpdate = true;
  geo.computeVertexNormals();
}
