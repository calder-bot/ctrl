/**
 * CTRL — Orbit camera controller with auto-rotation and snap-back.
 *
 * Spherical coordinates:
 *   theta (longitude) — horizontal angle, auto-rotates
 *   phi   (latitude)  — vertical angle from pole, clamped
 *   radius            — distance from origin, fixed
 *
 * Touch/mouse:
 *   drag left/right → change theta
 *   drag up/down    → change phi
 *   on release      → phi lerps back to default, theta resumes auto-orbit
 */

import * as THREE from 'three';

export class OrbitController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement
   * @param {Object} opts
   * @param {number} opts.radius      — default 6
   * @param {number} opts.defaultPhi  — default latitude in radians from pole (default π/3 ≈ 60° from pole = 30° elevation)
   * @param {number} opts.phiMin      — min phi (prevent flipping), default 0.35 (~20°)
   * @param {number} opts.phiMax      — max phi, default 1.4 (~80°)
   * @param {number} opts.autoSpeed   — radians per second for auto-orbit, default 0.15
   * @param {number} opts.snapSpeed   — lerp factor per frame for phi snap-back, default 0.04
   * @param {THREE.Vector3} opts.target — look-at target, default (0,0,0)
   */
  constructor(camera, domElement, opts = {}) {
    this.camera = camera;
    this.el = domElement;

    this.radius = opts.radius ?? 6;
    this.defaultPhi = opts.defaultPhi ?? Math.PI / 3;
    this.phiMin = opts.phiMin ?? 0.35;
    this.phiMax = opts.phiMax ?? 1.4;
    this.autoSpeed = opts.autoSpeed ?? 0.15;
    this.snapSpeed = opts.snapSpeed ?? 0.04;
    this.target = opts.target ?? new THREE.Vector3(0, 0, 0);
    this.ignoreSelector = opts.ignoreSelector ?? '#controls';

    this.theta = 0;
    this.phi = this.defaultPhi;
    this._dragging = false;
    this._lastPointer = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    this.el.addEventListener('pointerdown', this._onPointerDown);
    this.el.addEventListener('pointermove', this._onPointerMove);
    this.el.addEventListener('pointerup', this._onPointerUp);
    this.el.addEventListener('pointercancel', this._onPointerUp);

    this._updateCamera();
  }

  _onPointerDown(e) {
    // Ignore if the event target is a control element (slider, button)
    if (this.ignoreSelector && e.target.closest(this.ignoreSelector)) return;
    this._dragging = true;
    this._lastPointer = { x: e.clientX, y: e.clientY };
    this.el.setPointerCapture(e.pointerId);
  }

  _onPointerMove(e) {
    if (!this._dragging || !this._lastPointer) return;
    const dx = e.clientX - this._lastPointer.x;
    const dy = e.clientY - this._lastPointer.y;
    this._lastPointer = { x: e.clientX, y: e.clientY };

    // Horizontal drag → theta (longitude)
    this.theta -= dx * 0.005;
    // Vertical drag → phi (latitude)
    this.phi += dy * 0.005;
    this.phi = Math.max(this.phiMin, Math.min(this.phiMax, this.phi));
  }

  _onPointerUp(e) {
    this._dragging = false;
    this._lastPointer = null;
    try { this.el.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  /**
   * Call once per frame with delta time in seconds.
   */
  update(dt) {
    // Auto-orbit theta when not dragging
    if (!this._dragging) {
      this.theta += this.autoSpeed * dt;
      // Snap phi back to default
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
  }
}
