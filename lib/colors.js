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

/**
 * Two-domain gradient: green→orange below midpoint, orange→red above.
 *
 * @param {THREE.Color} out  — color to write into
 * @param {number} value     — height value
 * @param {number} mid       — the midpoint (maps to orange)
 * @param {number} min       — bottom of range (maps to green)
 * @param {number} max       — top of range (maps to red)
 * @returns {THREE.Color}
 */
export function goalColorTo(out, value, mid, min, max) {
  if (value <= mid) {
    // Green → Orange
    const frac = Math.max(0, Math.min(1, (value - min) / (mid - min)));
    const r = (40 + frac * 215) / 255;   // 40→255
    const g = (200 - frac * 60) / 255;   // 200→140
    const b = (80 - frac * 40) / 255;    // 80→40
    out.setRGB(r, g, b);
  } else {
    // Orange → Red
    const frac = Math.min(1, (value - mid) / (max - mid));
    const r = 1.0;
    const g = (140 - frac * 110) / 255;  // 140→30
    const b = (40 - frac * 20) / 255;    // 40→20
    out.setRGB(r, g, b);
  }
  return out;
}

export function goalColor(value, mid, min, max) {
  return goalColorTo(new THREE.Color(), mid, min, max);
}
