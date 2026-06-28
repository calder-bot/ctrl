/**
 * CTRL — Shared color utilities for height-mapped surfaces.
 *
 * Two color schemes:
 *
 * depthColor: general-purpose green → orange → red gradient
 *
 * goalColor: two-domain scheme for goal-oriented surfaces
 *   - Below goalThreshold: solid green (the goal zone)
 *   - Above goalThreshold: light orange → deep red gradient (suffering)
 */

import * as THREE from 'three';

// ─── General gradient (green → orange → red) ────────────────────────

function _gradient(frac) {
  if (frac < 0.5) {
    const t = frac / 0.5;
    return [(40 + t * 215) / 255, (200 - t * 60) / 255, (80 - t * 40) / 255];
  }
  const t = (frac - 0.5) / 0.5;
  return [1.0, (140 - t * 100) / 255, (40 - t * 20) / 255];
}

export function depthColorTo(out, value, min, max) {
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const [r, g, b] = _gradient(frac);
  out.setRGB(r, g, b);
  return out;
}

export function depthColor(value, min, max) {
  return depthColorTo(new THREE.Color(), value, min, max);
}

export function depthColorCSS(value, min, max) {
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const [r, g, b] = _gradient(frac);
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

// ─── Goal-oriented two-domain color ─────────────────────────────────

// Green goal zone
const GOAL_R = 40 / 255;
const GOAL_G = 200 / 255;
const GOAL_B = 80 / 255;

/**
 * Two-domain color: solid green below threshold, orange→red above.
 *
 * @param {THREE.Color} out       — color to write into
 * @param {number} value          — height value
 * @param {number} goalThreshold  — values below this are green
 * @param {number} max            — top of the orange→red range
 * @returns {THREE.Color}
 */
export function goalColorTo(out, value, goalThreshold, max) {
  if (value <= goalThreshold) {
    out.setRGB(GOAL_R, GOAL_G, GOAL_B);
    return out;
  }
  // Above threshold: light orange → deep red
  const frac = Math.min(1, (value - goalThreshold) / (max - goalThreshold));
  // Light yellow-orange at frac=0, deep red at frac=1
  const r = (255) / 255;
  const g = (200 - frac * 170) / 255;  // 200→30
  const b = (80 - frac * 60) / 255;    // 80→20
  out.setRGB(r, g, b);
  return out;
}

export function goalColor(value, goalThreshold, max) {
  return goalColorTo(new THREE.Color(), value, goalThreshold, max);
}
