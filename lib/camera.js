/**
 * CTRL — Orbit camera controller with auto-rotation and snap-back.
 *
 * Spherical coordinates:
 *   theta (longitude) — horizontal angle, auto-rotates
 *   phi   (latitude)  — vertical angle from pole, clamped
 *   radius            — distance from target, zoomable
 *
 * Touch/mouse:
 *   one-finger drag left/right → change theta
 *   one-finger drag up/down    → change phi
 *   pinch / scroll wheel       → zoom (change radius)
 *   on release                 → phi lerps back to default, theta resumes auto-orbit
 */

import * as THREE from 'three';

export class OrbitController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement
   * @param {Object} opts
   * @param {number} opts.radius      — default 6
   * @param {number} opts.radiusMin   — min zoom distance, default 3
   * @param {number} opts.radiusMax   — max zoom distance, default 20
   * @param {number} opts.defaultPhi  — default latitude in radians from pole
   * @param {number} opts.phiMin      — min phi (prevent flipping), default 0.35
   * @param {number} opts.phiMax      — max phi, default 1.4
   * @param {number} opts.autoSpeed   — radians per second for auto-orbit, default 0.15
   * @param {number} opts.snapSpeed   — lerp factor per frame for phi snap-back, default 0.04
   * @param {THREE.Vector3} opts.target — look-at target, default (0,0,0)
   * @param {string} opts.ignoreSelector — CSS selector to ignore pointer events on
   */
  constructor(camera, domElement, opts = {}) {
    this.camera = camera;
    this.el = domElement;

    this.radius = opts.radius ?? 6;
    this.radiusMin = opts.radiusMin ?? 3;
    this.radiusMax = opts.radiusMax ?? 20;
    this.defaultPhi = opts.defaultPhi ?? Math.PI / 3;
    this.phiMin = opts.phiMin ?? 0.35;
    this.phiMax = opts.phiMax ?? 1.4;
    this.autoSpeed = opts.autoSpeed ?? 0.15;
    this.snapSpeed = opts.snapSpeed ?? 0.04;
    this.target = opts.target ?? new THREE.Vector3(0, 0, 0);
    this.ignoreSelector = opts.ignoreSelector ?? '#controls';

    this.theta = 0;
    this.phi = this.defaultPhi;

    // Pointer tracking — separate orbit (single touch) from pinch (two touches)
    this._pointers = new Map(); // pointerId → {x, y}
    this._lastPinchDist = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);

    this.el.addEventListener('pointerdown', this._onPointerDown);
    this.el.addEventListener('pointermove', this._onPointerMove);
    this.el.addEventListener('pointerup', this._onPointerUp);
    this.el.addEventListener('pointercancel', this._onPointerUp);
    this.el.addEventListener('wheel', this._onWheel, { passive: false });

    this._updateCamera();
  }

  _onPointerDown(e) {
    if (this.ignoreSelector && e.target.closest(this.ignoreSelector)) return;
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.el.setPointerCapture(e.pointerId);
  }

  _onPointerMove(e) {
    if (!this._pointers.has(e.pointerId)) return;

    const prev = this._pointers.get(e.pointerId);
    const curr = { x: e.clientX, y: e.clientY };
    this._pointers.set(e.pointerId, curr);

    if (this._pointers.size === 1) {
      // Single pointer — orbit
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      this.theta -= dx * 0.005;
      this.phi += dy * 0.005;
      this.phi = Math.max(this.phiMin, Math.min(this.phiMax, this.phi));
    } else if (this._pointers.size === 2) {
      // Two pointers — pinch to zoom
      const pts = [...this._pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this._lastPinchDist !== null) {
        const scale = this._lastPinchDist / dist;
        this.radius = Math.max(this.radiusMin, Math.min(this.radiusMax,
          this.radius * scale
        ));
      }
      this._lastPinchDist = dist;
    }
  }

  _onPointerUp(e) {
    this._pointers.delete(e.pointerId);
    if (this._pointers.size < 2) this._lastPinchDist = null;
    try { this.el.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  _onWheel(e) {
    e.preventDefault();
    const zoom = 1 + e.deltaY * 0.001;
    this.radius = Math.max(this.radiusMin, Math.min(this.radiusMax,
      this.radius * zoom
    ));
  }

  /** Call once per frame with delta time in seconds. */
  update(dt) {
    if (this._pointers.size === 0) {
      this.theta += this.autoSpeed * dt;
      this.phi += (this.defaultPhi - this.phi) * this.snapSpeed;
    }

    this._updateCamera();
  }

  _updateCamera() {
    const x = this.radius * Math.sin(this.phi) * Math.cos(this.theta);
    const y = this.radius * Math.cos(this.phi);
    const z = this.radius * Math.sin(this.phi) * Math.sin(this.theta);

    this.camera.position.set(
      this.target.x + x,
      this.target.y + y,
      this.target.z + z
    );
    this.camera.lookAt(this.target);
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this._onPointerDown);
    this.el.removeEventListener('pointermove', this._onPointerMove);
    this.el.removeEventListener('pointerup', this._onPointerUp);
    this.el.removeEventListener('pointercancel', this._onPointerUp);
    this.el.removeEventListener('wheel', this._onWheel);
  }
}
