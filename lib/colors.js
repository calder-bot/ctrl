/**
 * CTRL — Shared color utilities for height-mapped surfaces.
 *
 * depthColor maps a scalar value within [min, max] to a
 * green → orange → red gradient:
 *   low  (good)  = green  rgb(40, 200, 80)
 *   mid  (start) = orange rgb(255, 140, 40)
 *   high (bad)   = red    rgb(255, 40, 20)
 */

import * as THREE from 'three';

/** Shared internal: compute normalized r, g, b from a fractional position. */
function _gradient(frac) {
  if (frac < 0.5) {
    const t = frac / 0.5;
    return [(40 + t * 215) / 255, (200 - t * 60) / 255, (80 - t * 40) / 255];
  }
  const t = (frac - 0.5) / 0.5;
  return [1.0, (140 - t * 100) / 255, (40 - t * 20) / 255];
}

/**
 * Write depth color into an existing THREE.Color (avoids allocation).
 *
 * @param {THREE.Color} out   — color object to write into
 * @param {number} value      — the height/potential value
 * @param {number} min        — lowest value in the range (maps to green)
 * @param {number} max        — highest value in the range (maps to red)
 * @returns {THREE.Color} the same `out` object
 */
export function depthColorTo(out, value, min, max) {
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const [r, g, b] = _gradient(frac);
  out.setRGB(r, g, b);
  return out;
}

/**
 * @param {number} value  — the height/potential value
 * @param {number} min    — lowest value in the range (maps to green)
 * @param {number} max    — highest value in the range (maps to red)
 * @returns {THREE.Color}
 */
export function depthColor(value, min, max) {
  return depthColorTo(new THREE.Color(), value, min, max);
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {string} CSS rgb() string
 */
export function depthColorCSS(value, min, max) {
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const [r, g, b] = _gradient(frac);
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}
