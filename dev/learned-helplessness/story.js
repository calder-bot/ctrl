/**
 * CTRL — Learned Helplessness (3D version)
 *
 * A ball sits in a local minimum on a 2D potential surface.
 * Two sliders each lower half the ridge wall between the local and global minima.
 * An effort button applies random kicks.
 *
 * Discovery arc:
 *   1. Effort alone → ball jitters but stays trapped (barrier too high)
 *   2. One slider → lowers its half of the ridge, ~30% escape chance
 *   3. Both sliders → entire ridge lowered, ~70-90% escape with effort
 *   4. Ball rolls to the deep green global minimum
 *
 * Surface design:
 *   - Local well at (-0.8, -0.8): shallow, orange zone
 *   - Global well at (1.0, 1.0): deep, green zone
 *   - Ridge runs perpendicular to connecting diagonal
 *   - Slider 1 controls the left half of the ridge (perp < 0)
 *   - Slider 2 controls the right half (perp > 0)
 *   - Both together lower the ridge across its full width
 *
 * Physics calibrated via Monte Carlo simulation:
 *   gravity=30, damping=7, kickForce=7
 *   Barrier default=1.85 → 0% escape
 *   Barrier both@100=0.46 → 88% escape
 */

import * as THREE from 'three';
import { createSurfaceMesh, updateSurfaceMesh } from '../../lib/surface.js';
import { OrbitController } from '../../lib/camera.js';
import { BallPhysics } from '../../lib/physics.js';
import { depthColor } from '../../lib/colors.js';

// ─── Surface equation ───────────────────────────────────────────────

const RIDGE_REDUCTION = 0.92; // how much each slider can lower its half

function potential(x, y, s1, s2) {
  const lx = x + 0.8, ly = y + 0.8;   // offset from local well center
  const gx = x - 1.0, gy = y - 1.0;   // offset from global well center
  const r2L = lx * lx + ly * ly;
  const r2G = gx * gx + gy * gy;

  // Local well: shallow (orange zone)
  const localWell = -1.5 * Math.exp(-1.8 * r2L);

  // Global well: deep (green zone)
  const globalWell = -4.5 * Math.exp(-0.6 * r2G);

  // Ridge between the wells
  // "along" = projection onto connecting diagonal (local→global direction)
  // "perp"  = perpendicular to that diagonal
  const along = (x - 0.1) * 0.707 + (y - 0.1) * 0.707;
  const perp = -(x - 0.1) * 0.707 + (y - 0.1) * 0.707;

  // Ridge profile: tight Gaussian along the diagonal
  const ridgeProfile = Math.exp(-3.0 * along * along);

  // Each slider reduces its half of the ridge via sigmoid blending
  const s1n = s1 / 100;
  const s2n = s2 / 100;
  const leftWeight = 1 / (1 + Math.exp(8 * perp));   // 1 when perp<0 (slider1's half)
  const rightWeight = 1 - leftWeight;                  // 1 when perp>0 (slider2's half)
  const ridgeReduction = s1n * leftWeight + s2n * rightWeight;
  const ridgeHeight = 2.0 * (1 - RIDGE_REDUCTION * ridgeReduction);

  const ridge = ridgeHeight * ridgeProfile;

  // Containment bowl
  const r2 = x * x + y * y;
  const boundary = 0.08 * r2;

  return localWell + globalWell + ridge + boundary;
}

// ─── Configuration ──────────────────────────────────────────────────

const SURFACE_RANGE = [-2.2, 2.2];
const SURFACE_RES = 120;
const BALL_START = [-0.8, -0.8];
const BALL_RADIUS = 0.12;

const PHYSICS_OPTS = {
  gravity: 30,
  damping: 7,
  mass: 1.0,
  kickForce: 7,
  bounds: [-2.0, 2.0],
};

const HEIGHT_SCALE = 0.45; // flatten the surface so the interior is visible

const CAMERA_OPTS = {
  radius: 11,
  radiusMin: 5,
  radiusMax: 25,
  defaultPhi: Math.PI / 3,
  autoSpeed: 0.1,
  target: new THREE.Vector3(0, -0.8, 0),
};

// ─── Init ───────────────────────────────────────────────────────────

let scene, renderer, camera, orbit, surfaceMesh, ballMesh, ballGlow, ballLight;
let physics;
let slider1, slider2, kickBtn, resetBtn;
let clock;
let heightRange = { min: -4.5, max: 2.0 };

export function init() {
  slider1 = document.getElementById('slider1');
  slider2 = document.getElementById('slider2');
  kickBtn = document.getElementById('btn-kick');
  resetBtn = document.getElementById('btn-reset');

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

  // Surface mesh
  surfaceMesh = createSurfaceMesh(
    (x, y) => potential(x, y, 0, 0),
    {
      xRange: SURFACE_RANGE, yRange: SURFACE_RANGE,
      resolution: SURFACE_RES,
      heightScale: HEIGHT_SCALE,
      opacity: 0.85,
    }
  );
  scene.add(surfaceMesh);
  _updateHeightRange();

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

  // Point light on the ball — makes it pop against the surface
  ballLight = new THREE.PointLight(0xff8844, 1.5, 3);
  scene.add(ballLight);

  // Physics
  physics = new BallPhysics(
    (x, y) => potential(x, y, getS1(), getS2()),
    PHYSICS_OPTS
  );
  physics.reset(BALL_START[0], BALL_START[1]);

  // Events
  kickBtn.addEventListener('pointerdown', onKick);
  resetBtn.addEventListener('click', onReset);
  slider1.addEventListener('input', onSliderChange);
  slider2.addEventListener('input', onSliderChange);
  window.addEventListener('resize', onResize);

  clock = new THREE.Clock();
  animate();
}

// ─── Helpers ────────────────────────────────────────────────────────

function getS1() { return parseFloat(slider1.value); }
function getS2() { return parseFloat(slider2.value); }

function _updateHeightRange() {
  const pos = surfaceMesh.geometry.attributes.position;
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  heightRange.min = hMin;
  heightRange.max = hMax;
}

function onSliderChange() {
  const V = (x, y) => potential(x, y, getS1(), getS2());
  physics.V = V;
  updateSurfaceMesh(surfaceMesh, V);
  _updateHeightRange();
}

function onKick(e) {
  e.preventDefault();
  physics.kick();

  // Visual pulse on button
  kickBtn.classList.add('pulse');
  setTimeout(() => kickBtn.classList.remove('pulse'), 200);

  // Flash the ball
  ballMesh.material.emissiveIntensity = 1.2;
  ballGlow.material.opacity = 0.35;
  setTimeout(() => {
    ballMesh.material.emissiveIntensity = 0.4;
    ballGlow.material.opacity = 0.12;
  }, 180);
}

function onReset() {
  physics.reset(BALL_START[0], BALL_START[1]);
  slider1.value = 0;
  slider2.value = 0;
  onSliderChange();
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

  // Physics substeps for stability
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

  // Color ball by depth
  const c = depthColor(bh, heightRange.min, heightRange.max);
  ballMesh.material.color.copy(c);
  ballMesh.material.emissive.copy(c);
  ballGlow.material.color.copy(c);

  // Camera
  orbit.update(dt);

  renderer.render(scene, camera);
}

// ─── Start ──────────────────────────────────────────────────────────

init();
