/**
 * CTRL — Learned Helplessness (3D version)
 *
 * A ball sits in a local minimum on a 2D potential surface.
 * Two sliders reshape the surface (low-pass filtered, ~1s time constant).
 * An effort button applies random kicks.
 *
 * Discovery arc:
 *   1. At default (50/50): ball in local orange minimum, stuck
 *   2. Moving sliders reshapes surface — ball follows physics
 *   3. Wrong direction: still stuck, maybe deeper
 *   4. Right combo (~s1=90, s2=10): ball position gets worse (higher/redder)
 *      but the ridge is narrow enough that kicks can push the ball over
 *   5. "It gets harder before it gets better"
 *
 * Surface design:
 *   - Local well at (-0.8, -0.8): shallow, orange zone
 *   - Global well at (1.0, 1.0): deep, green zone (goal)
 *   - Ridge between them (Gaussian along connecting diagonal)
 *   - s1: tilts along the diagonal — lifts local well area
 *   - s2: controls ridge width — lower = narrower = easier to pass
 *   - Both start at 50 (neutral). Neither extreme is the answer.
 *
 * Color scheme:
 *   - Bottom slice (1 ball-height): solid green (goal zone)
 *   - Everything above: light orange → deep red gradient
 */

import * as THREE from 'three';
import { createSurfaceMesh, updateSurfaceMesh } from '../../lib/surface.js';
import { OrbitController } from '../../lib/camera.js';
import { BallPhysics } from '../../lib/physics.js';
import { goalColorTo } from '../../lib/colors.js';

// ─── Surface equation ───────────────────────────────────────────────

// The global well bottom is pinned to a fixed Z value regardless of sliders.
const GLOBAL_WELL_TARGET = -4.5;

function _potentialRaw(x, y, a1, a2) {
  const lx = x + 0.8, ly = y + 0.8;
  const gx = x - 1.0, gy = y - 1.0;
  const r2L = lx * lx + ly * ly;
  const r2G = gx * gx + gy * gy;

  // Local well: shallow (orange zone at default)
  const localWell = -1.5 * Math.exp(-1.8 * r2L);

  // Global well: deep (green goal zone)
  const globalWell = -4.5 * Math.exp(-0.6 * r2G);

  // Ridge between the wells along the connecting diagonal
  const along = (x - 0.1) * 0.707 + (y - 0.1) * 0.707;
  const ridgeWidth = 3.0 + 2.5 * a2;  // s2 low → narrow ridge, s2 high → wide
  const ridgeH = 2.0 + 0.4 * a2;
  const ridgeProfile = Math.exp(-ridgeWidth * along * along);
  const ridge = ridgeH * ridgeProfile;

  // Containment bowl
  const r2 = x * x + y * y;
  const boundary = 0.08 * r2;

  // s1: tilt along the local→global diagonal
  // Asymmetric: strong when raising local side (a1>0), gentle when lowering (a1<0)
  const tiltScale = a1 >= 0 ? 1.4 : 0.5;
  const tilt = -tiltScale * a1 * along;

  return localWell + globalWell + ridge + boundary + tilt;
}

function potential(x, y, s1, s2) {
  const a1 = (s1 - 50) / 50;
  const a2 = (s2 - 50) / 50;

  // Pin the global well bottom to a fixed Z position
  const globalRef = _potentialRaw(1.0, 1.0, a1, a2);
  const offset = GLOBAL_WELL_TARGET - globalRef;

  return _potentialRaw(x, y, a1, a2) + offset;
}

// ─── Configuration ──────────────────────────────────────────────────

const SURFACE_RANGE = [-2.2, 2.2];
const SURFACE_RES = 120;
const BALL_START = [-0.8, -0.8];
const BALL_RADIUS = 0.12;
const HEIGHT_SCALE = 0.45;

// Color midpoint: the local well's default height (~-1.5) maps to orange.
// Below = green→orange (the goal bowl), above = orange→red (suffering).
const COLOR_MID = -1.5;

const PHYSICS_OPTS = {
  gravity: 30,
  damping: 7,
  mass: 1.0,
  kickForce: 7,
  bounds: [-2.0, 2.0],
};

const CAMERA_OPTS = {
  radius: 11,
  radiusMin: 5,
  radiusMax: 25,
  defaultPhi: Math.PI / 3,
  autoSpeed: 0.1,
  target: new THREE.Vector3(0, -0.8, 0),
};

// Low-pass filter time constant (seconds)
const FILTER_TAU = 1.0;

// Pre-allocated ball colors (avoid per-frame allocations)
const _ballGoalColor = new THREE.Color(40 / 255, 200 / 255, 80 / 255);
const _ballSufferColor = new THREE.Color(1.0, 0.4, 0.15);

// ─── Low-pass filter ────────────────────────────────────────────────

class LowPass {
  constructor(initial, tau) {
    this.value = initial;
    this.target = initial;
    this.tau = tau;
  }
  set(target) { this.target = target; }
  update(dt) {
    const alpha = 1 - Math.exp(-dt / this.tau);
    this.value += (this.target - this.value) * alpha;
    return this.value;
  }
}

// ─── Init ───────────────────────────────────────────────────────────

let scene, renderer, camera, orbit;
let surfaceMesh, gridMesh;
let ballMesh, ballGlow, ballLight;
let physics;
let slider1, slider2, kickBtn, resetBtn;
let clock;
let lpS1, lpS2; // low-pass filtered slider values

// Color function: green→orange below midpoint, orange→red above
function surfaceColorFn(out, value, min, max) {
  return goalColorTo(out, value, COLOR_MID, min, max);
}

export function init() {
  slider1 = document.getElementById('slider1');
  slider2 = document.getElementById('slider2');
  kickBtn = document.getElementById('btn-kick');
  resetBtn = document.getElementById('btn-reset');

  // Low-pass filters starting at slider default (50)
  lpS1 = new LowPass(50, FILTER_TAU);
  lpS2 = new LowPass(50, FILTER_TAU);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const container = document.getElementById('canvas-container');
  container.appendChild(renderer.domElement);
  renderer.setSize(container.clientWidth, container.clientHeight);

  // Camera
  camera = new THREE.PerspectiveCamera(
    45, container.clientWidth / container.clientHeight, 0.1, 100
  );
  orbit = new OrbitController(camera, renderer.domElement, CAMERA_OPTS);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(4, 10, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x6688cc, 0.3);
  fill.position.set(-6, 4, -4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xff8866, 0.2);
  rim.position.set(0, -2, -8);
  scene.add(rim);

  // Surface mesh (colored, semi-transparent)
  const V0 = (x, y) => potential(x, y, 50, 50);
  surfaceMesh = createSurfaceMesh(V0, {
    xRange: SURFACE_RANGE, yRange: SURFACE_RANGE,
    resolution: SURFACE_RES,
    heightScale: HEIGHT_SCALE,
    opacity: 0.7,
    colorFn: surfaceColorFn,
  });
  scene.add(surfaceMesh);

  // Wireframe grid overlay
  gridMesh = _createGrid(V0);
  scene.add(gridMesh);

  // Ball
  const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xff8c28,
    emissive: 0xff6b00,
    emissiveIntensity: 0.4,
    metalness: 0.4,
    roughness: 0.3,
  });
  ballMesh = new THREE.Mesh(ballGeo, ballMat);
  scene.add(ballMesh);

  // Ball glow
  const glowGeo = new THREE.SphereGeometry(BALL_RADIUS * 2.5, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff8c28,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });
  ballGlow = new THREE.Mesh(glowGeo, glowMat);
  scene.add(ballGlow);

  // Point light on ball
  ballLight = new THREE.PointLight(0xff8844, 1.5, 3);
  scene.add(ballLight);

  // Physics — uses filtered slider values
  physics = new BallPhysics(
    (x, y) => potential(x, y, lpS1.value, lpS2.value),
    PHYSICS_OPTS
  );
  physics.reset(BALL_START[0], BALL_START[1]);

  // Events
  kickBtn.addEventListener('pointerdown', onKick);
  resetBtn.addEventListener('click', onReset);
  window.addEventListener('resize', onResize);

  clock = new THREE.Clock();
  animate();
}

// ─── Wireframe grid ─────────────────────────────────────────────────

function _createGrid(V) {
  const lines = 10;
  const [rMin, rMax] = SURFACE_RANGE;
  const step = (rMax - rMin) / lines;
  const detail = 80;

  const points = [];

  // Lines along X (varying y at fixed x positions)
  for (let i = 0; i <= lines; i++) {
    const x = rMin + i * step;
    for (let j = 0; j < detail; j++) {
      const y1 = rMin + (j / detail) * (rMax - rMin);
      const y2 = rMin + ((j + 1) / detail) * (rMax - rMin);
      const h1 = V(x, y1) * HEIGHT_SCALE;
      const h2 = V(x, y2) * HEIGHT_SCALE;
      points.push(new THREE.Vector3(x, h1 + 0.01, y1));
      points.push(new THREE.Vector3(x, h2 + 0.01, y2));
    }
  }

  // Lines along Y (varying x at fixed y positions)
  for (let i = 0; i <= lines; i++) {
    const y = rMin + i * step;
    for (let j = 0; j < detail; j++) {
      const x1 = rMin + (j / detail) * (rMax - rMin);
      const x2 = rMin + ((j + 1) / detail) * (rMax - rMin);
      const h1 = V(x1, y) * HEIGHT_SCALE;
      const h2 = V(x2, y) * HEIGHT_SCALE;
      points.push(new THREE.Vector3(x1, h1 + 0.01, y));
      points.push(new THREE.Vector3(x2, h2 + 0.01, y));
    }
  }

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.12,
  });
  return new THREE.LineSegments(geo, mat);
}

function _updateGrid(V) {
  const lines = 10;
  const [rMin, rMax] = SURFACE_RANGE;
  const step = (rMax - rMin) / lines;
  const detail = 80;
  const pos = gridMesh.geometry.attributes.position;
  let idx = 0;

  for (let i = 0; i <= lines; i++) {
    const x = rMin + i * step;
    for (let j = 0; j < detail; j++) {
      const y1 = rMin + (j / detail) * (rMax - rMin);
      const y2 = rMin + ((j + 1) / detail) * (rMax - rMin);
      pos.setY(idx++, V(x, y1) * HEIGHT_SCALE + 0.01);
      pos.setY(idx++, V(x, y2) * HEIGHT_SCALE + 0.01);
    }
  }

  for (let i = 0; i <= lines; i++) {
    const y = rMin + i * step;
    for (let j = 0; j < detail; j++) {
      const x1 = rMin + (j / detail) * (rMax - rMin);
      const x2 = rMin + ((j + 1) / detail) * (rMax - rMin);
      pos.setY(idx++, V(x1, y) * HEIGHT_SCALE + 0.01);
      pos.setY(idx++, V(x2, y) * HEIGHT_SCALE + 0.01);
    }
  }

  pos.needsUpdate = true;
}

// ─── Helpers ────────────────────────────────────────────────────────

function getS1() { return parseFloat(slider1.value); }
function getS2() { return parseFloat(slider2.value); }

function onKick(e) {
  e.preventDefault();
  physics.kick();

  kickBtn.classList.add('pulse');
  setTimeout(() => kickBtn.classList.remove('pulse'), 200);

  ballMesh.material.emissiveIntensity = 1.2;
  ballGlow.material.opacity = 0.35;
  setTimeout(() => {
    ballMesh.material.emissiveIntensity = 0.4;
    ballGlow.material.opacity = 0.15;
  }, 180);
}

function onReset() {
  physics.reset(BALL_START[0], BALL_START[1]);
  slider1.value = 50;
  slider2.value = 50;
  lpS1.value = 50; lpS1.target = 50;
  lpS2.value = 50; lpS2.target = 50;
  _rebuildSurface();
}

function _rebuildSurface() {
  const V = (x, y) => potential(x, y, lpS1.value, lpS2.value);
  physics.V = V;
  updateSurfaceMesh(surfaceMesh, V);
  _updateGrid(V);
}

function onResize() {
  const container = document.getElementById('canvas-container');
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ─── Animation loop ─────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  // Update low-pass filters from slider positions
  lpS1.set(getS1());
  lpS2.set(getS2());
  const prevS1 = lpS1.value;
  const prevS2 = lpS2.value;
  lpS1.update(dt);
  lpS2.update(dt);

  // Rebuild surface if filtered values changed meaningfully
  if (Math.abs(lpS1.value - prevS1) > 0.01 || Math.abs(lpS2.value - prevS2) > 0.01) {
    _rebuildSurface();
  }

  // Physics substeps
  const substeps = 8;
  const subDt = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    physics.step(subDt);
  }

  // Ball position (visual height matches scaled surface)
  const bx = physics.x;
  const by = physics.y;
  const bh = physics.height();
  const visualH = bh * HEIGHT_SCALE;
  ballMesh.position.set(bx, visualH + BALL_RADIUS, by);
  ballGlow.position.copy(ballMesh.position);
  ballLight.position.set(bx, visualH + BALL_RADIUS + 0.3, by);

  // Color ball by its zone
  const goalColor = _ballGoalColor;
  const sufferColor = _ballSufferColor;
  // If ball is near the global minimum, it turns green
  const distToGoal = Math.sqrt((bx - 1) ** 2 + (by - 1) ** 2);
  if (distToGoal < 0.5) {
    ballMesh.material.color.copy(goalColor);
    ballMesh.material.emissive.copy(goalColor);
    ballGlow.material.color.copy(goalColor);
  } else {
    ballMesh.material.color.copy(sufferColor);
    ballMesh.material.emissive.copy(sufferColor);
    ballGlow.material.color.copy(sufferColor);
  }

  // Camera
  orbit.update(dt);

  renderer.render(scene, camera);
}

// ─── Start ──────────────────────────────────────────────────────────

init();
