/**
 * CTRL — Ball-on-surface physics.
 *
 * The ball moves on a 2D potential surface V(x, y) under:
 *   F = −G · ∇V(x,y) − D · velocity
 *
 * Gradient computed via central finite differences.
 * Semi-implicit Euler integration with capped dt.
 */

export class BallPhysics {
  /**
   * @param {Function} V    — potential function V(x, y) → height
   * @param {Object}   opts
   * @param {number}   opts.gravity    — gradient-to-force scale, default 8
   * @param {number}   opts.damping    — friction coefficient, default 2.0
   * @param {number}   opts.mass       — ball mass, default 1.0
   * @param {number}   opts.maxDt      — max timestep cap, default 0.03
   * @param {number[]} opts.bounds     — [min, max] for x and y, default [-2, 2]
   * @param {number}   opts.kickForce  — impulse magnitude per tap, default 3.0
   */
  constructor(V, opts = {}) {
    this.V = V;
    this.gravity = opts.gravity ?? 8;
    this.damping = opts.damping ?? 2.0;
    this.mass = opts.mass ?? 1.0;
    this.maxDt = opts.maxDt ?? 0.03;
    this.bounds = opts.bounds ?? [-2, 2];
    this.kickForce = opts.kickForce ?? 3.0;

    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
  }

  /** Set ball position and zero velocity. */
  reset(x0, y0) {
    this.x = x0;
    this.y = y0;
    this.vx = 0;
    this.vy = 0;
  }

  /** Compute ∂V/∂x and ∂V/∂y via central differences. */
  gradient(x, y) {
    const eps = 0.005;
    const dvdx = (this.V(x + eps, y) - this.V(x - eps, y)) / (2 * eps);
    const dvdy = (this.V(x, y + eps) - this.V(x, y - eps)) / (2 * eps);
    return [dvdx, dvdy];
  }

  /**
   * Step the physics forward by dt seconds.
   * @param {number} dt — seconds (will be capped to maxDt)
   */
  step(dt) {
    dt = Math.min(dt, this.maxDt);

    const [dvdx, dvdy] = this.gradient(this.x, this.y);

    // Forces: gravity on surface + damping
    const fx = -this.gravity * dvdx - this.damping * this.vx;
    const fy = -this.gravity * dvdy - this.damping * this.vy;

    // Semi-implicit Euler
    this.vx += (fx / this.mass) * dt;
    this.vy += (fy / this.mass) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Boundary clamp
    const [bMin, bMax] = this.bounds;
    if (this.x < bMin) { this.x = bMin; this.vx = 0; }
    if (this.x > bMax) { this.x = bMax; this.vx = 0; }
    if (this.y < bMin) { this.y = bMin; this.vy = 0; }
    if (this.y > bMax) { this.y = bMax; this.vy = 0; }
  }

  /**
   * Apply a random-direction kick (effort button).
   * Returns the angle used (for visual feedback).
   * @returns {number} angle in radians
   */
  kick() {
    const angle = Math.random() * Math.PI * 2;
    this.vx += Math.cos(angle) * this.kickForce;
    this.vy += Math.sin(angle) * this.kickForce;
    return angle;
  }

  /** Current height on the surface. */
  height() {
    return this.V(this.x, this.y);
  }
}
