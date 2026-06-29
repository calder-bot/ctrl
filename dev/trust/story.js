/**
 * CTRL — Trust (v3)
 *
 * Both trust and don't-trust simulate identically. Surfaces merge,
 * marble enters from edge, physics settles it. Surfaces separate
 * to show individual contributions. Bar history tracks your journey.
 *
 * Features:
 * - Procedurally generated person surfaces (seeded RNG)
 * - Constraint lines (religion/boundaries) on person surfaces
 * - Occlusion (fog of war) on person surfaces
 * - BallPhysics from lib/physics.js (gravity=30, damping=7)
 * - Player surface is fixed (green, 3 wells)
 */

import * as THREE from 'three';
import { createSurfaceMesh, updateSurfaceMesh } from '../../lib/surface.js';
import { OrbitController } from '../../lib/camera.js';
import { depthColorTo } from '../../lib/colors.js';
import { BallPhysics } from '../../lib/physics.js';

// ─── Seeded RNG (mulberry32) ─────────────────────────────────────────

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── Constants ───────────────────────────────────────────────────────

const RANGE = [-2, 2];
const RES = 80;
const H_SCALE = 0.6;
const BALL_R = 0.1;
const MAX_TRAIL = 600;
const MERGE_MS = 900;
const SEPARATE_MS = 800;
const POST_MS = 1500;
const SETTLE_SPEED = 0.05;
const SETTLE_FRAMES = 60;
const MARBLE_TIMEOUT = 8;
const SETTLE_PAUSE = 1.0;
const BAR_MIN_H = 6;
const BAR_MAX_H = 56;
const Z_NORM = 5.0;
const CONSTRAINT_COLOR = 0xffaa00;

// ─── Player surface (fixed, green) ──────────────────────────────────

const PLAYER_G = [
  { cx: -0.5, cy: -0.5, depth: -3.5, sigma: 0.7 },
  { cx: 0.8,  cy: -0.3, depth: -2.5, sigma: 0.8 },
  { cx: -0.3, cy: 1.0,  depth: -2.0, sigma: 0.6 },
];

function evalG(gs, x, y) {
  let z = 0;
  for (const g of gs) {
    const ex = x - g.cx, ey = y - g.cy;
    z += g.depth * Math.exp(-(ex * ex + ey * ey) / g.sigma);
  }
  return z + 0.05 * (x * x + y * y);
}

const evalPlayer = (x, y) => evalG(PLAYER_G, x, y);

function findMin(fn) {
  let mz = Infinity, mx = 0, my = 0;
  for (let x = -2; x <= 2; x += 0.02)
    for (let y = -2; y <= 2; y += 0.02) {
      const z = fn(x, y);
      if (z < mz) { mz = z; mx = x; my = y; }
    }
  return { x: mx, y: my, z: mz };
}

const playerMin = findMin(evalPlayer);

// ─── Person surface (procedural) ────────────────────────────────────

let personG = null;
let personColor = null;
let personConstraints = [];
let personOcclusion = null;
let constraintSides = [];

const evalPerson = (x, y) => evalG(personG, x, y);
const evalCombined = (x, y) => evalPlayer(x, y) + evalPerson(x, y);

function genSurface(rng) {
  const gs = [], cs = [];
  for (let i = 0; i < 3; i++) {
    let cx, cy, ok, n = 0;
    do {
      cx = -1.3 + rng() * 2.6;
      cy = -1.3 + rng() * 2.6;
      ok = cs.every(c => Math.hypot(cx - c[0], cy - c[1]) >= 0.8);
    } while (!ok && ++n < 100);
    cs.push([cx, cy]);
    gs.push({ cx, cy, depth: -(1.5 + rng() * 4), sigma: 0.5 + rng() * 0.5 });
  }
  return gs;
}

function genColor(rng) {
  let h;
  do { h = rng(); } while (h > 0.22 && h < 0.44);
  return new THREE.Color().setHSL(h, 0.65, 0.55);
}

// ─── Constraint generation ──────────────────────────────────────────

function genConstraints(rng, gaussians) {
  const roll = rng();
  let count;
  if (roll < 0.70) count = 0;
  else if (roll < 0.90) count = 1;
  else if (roll < 0.97) count = 2;
  else count = 3;

  const constraints = [];
  for (let i = 0; i < count; i++) {
    let a, b, c, ok, n = 0;
    do {
      const theta = rng() * Math.PI;
      a = Math.cos(theta);
      b = Math.sin(theta);
      c = (rng() - 0.5) * 2.4;

      ok = true;
      // Check distance from other constraints
      for (const prev of constraints) {
        const cross = Math.abs(a * prev.b - b * prev.a);
        if (cross < 0.3) {
          // Near-parallel — check separation
          if (Math.abs(c - prev.c) < 0.8) { ok = false; break; }
        }
      }
      // Check not too close to gaussian centers
      for (const g of gaussians) {
        const norm = Math.sqrt(a * a + b * b);
        const dist = Math.abs(a * g.cx + b * g.cy - c) / norm;
        if (dist < 0.3) { ok = false; break; }
      }
    } while (!ok && ++n < 50);

    if (n < 50) constraints.push({ a, b, c });
  }
  return constraints;
}

// ─── Occlusion generation ───────────────────────────────────────────

function genOcclusion(rng) {
  if (rng() > 0.5) return null;
  return {
    cx: -0.8 + rng() * 1.6,
    cy: -0.8 + rng() * 1.6,
    radius: 0.8 + rng() * 1.2,
  };
}

function applyOcclusion(mesh, occ) {
  if (!occ) return;
  const pos = mesh.geometry.attributes.position;
  const color = mesh.geometry.attributes.color;
  const { _xRange, _yRange } = mesh.userData;
  const xMin = _xRange[0], xSize = _xRange[1] - _xRange[0];
  const yMin = _yRange[0], ySize = _yRange[1] - _yRange[0];

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const fx = xMin + ((px + xSize / 2) / xSize) * xSize;
    const fy = yMin + ((pz + ySize / 2) / ySize) * ySize;

    const dist = Math.hypot(fx - occ.cx, fy - occ.cy);
    if (dist > occ.radius) {
      const fog = Math.min(1, (dist - occ.radius) / 0.5);
      const r = color.getX(i), g = color.getY(i), b = color.getZ(i);
      color.setXYZ(i,
        r + (0.12 - r) * fog,
        g + (0.12 - g) * fog,
        b + (0.12 - b) * fog
      );
    }
  }
  color.needsUpdate = true;
}

// ─── Constraint line visualization ──────────────────────────────────

function sampleLine(a, b, c, lo, hi, steps) {
  const pts = [];
  if (Math.abs(b) >= Math.abs(a)) {
    for (let i = 0; i <= steps; i++) {
      const x = lo + (hi - lo) * i / steps;
      const y = (c - a * x) / b;
      if (y >= lo && y <= hi) pts.push({ x, y });
    }
  } else {
    for (let i = 0; i <= steps; i++) {
      const y = lo + (hi - lo) * i / steps;
      const x = (c - b * y) / a;
      if (x >= lo && x <= hi) pts.push({ x, y });
    }
  }
  return pts;
}

const constraintGroup = new THREE.Group();
let constraintLineData = [];

function buildConstraintLines() {
  for (const cl of constraintLineData) {
    constraintGroup.remove(cl.mesh);
    cl.mesh.geometry.dispose();
    cl.mesh.material.dispose();
  }
  constraintLineData = [];

  for (const { a, b, c } of personConstraints) {
    const pts = sampleLine(a, b, c, -2, 2, 40);
    if (pts.length < 2) continue;

    const positions = new Float32Array(pts.length * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: CONSTRAINT_COLOR, transparent: true, opacity: 0.8,
    });
    const mesh = new THREE.Line(geo, mat);
    constraintGroup.add(mesh);
    constraintLineData.push({ points: pts, mesh, positions });
  }
}

function updateConstraintPositions(evalFn, yOff) {
  for (const cl of constraintLineData) {
    for (let i = 0; i < cl.points.length; i++) {
      const { x, y } = cl.points[i];
      const h = evalFn(x, y) * H_SCALE;
      cl.positions[i * 3] = x;
      cl.positions[i * 3 + 1] = h + yOff + 0.06;
      cl.positions[i * 3 + 2] = y;
    }
    cl.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

// ─── Constraint physics ─────────────────────────────────────────────

function enforceConstraints() {
  for (let i = 0; i < personConstraints.length; i++) {
    const { a, b, c } = personConstraints[i];
    const norm = Math.sqrt(a * a + b * b);
    const nx = a / norm, ny = b / norm;
    const dist = (a * physics.x + b * physics.y - c) / norm;
    const side = constraintSides[i];

    if (side !== 0 && Math.sign(dist) !== side) {
      physics.x -= dist * nx;
      physics.y -= dist * ny;
      const vn = physics.vx * nx + physics.vy * ny;
      physics.vx -= 2 * vn * nx;
      physics.vy -= 2 * vn * ny;
      physics.vx *= 0.5;
      physics.vy *= 0.5;
    }
  }
}

// ─── Color functions ─────────────────────────────────────────────────

function playerCF(out, v, min, max) {
  const f = Math.max(0, Math.min(1, (v - min) / (max - min)));
  out.setRGB((20 + f * 80) / 255, (100 + f * 120) / 255, (30 + f * 50) / 255);
  return out;
}

function personCF(base) {
  return (out, v, min, max) => {
    const f = Math.max(0, Math.min(1, (v - min) / (max - min)));
    out.copy(base).multiplyScalar(0.3 + f * 0.7);
    return out;
  };
}

const combinedCF = depthColorTo;

// ─── Game state ──────────────────────────────────────────────────────

const rng = mulberry32(42);
let round = 0;
let phase = 'IDLE';
let phaseStart = 0;
let choice = null;
let marbleTime = 0;
let settled = false;
let settleTime = 0;
let settledFrames = 0;
let trailIdx = 0;
let finalX = 0, finalY = 0;
let physics = null;

// ─── Scene ───────────────────────────────────────────────────────────

const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000);
container.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0x404060, 0.6));
const dl = new THREE.DirectionalLight(0xffffff, 0.8);
dl.position.set(3, 5, 4); scene.add(dl);
const rl = new THREE.DirectionalLight(0x446644, 0.3);
rl.position.set(-3, 2, -4); scene.add(rl);

const orbit = new OrbitController(camera, renderer.domElement, {
  radius: 8, radiusMin: 4, radiusMax: 16,
  defaultPhi: Math.PI / 3.5, phiMin: 0.3, phiMax: 1.5,
  autoSpeed: 0.12, snapSpeed: 0.04,
  target: new THREE.Vector3(0, -0.5, 0),
  ignoreSelector: '#controls, #bar-history',
});

// ─── Meshes ──────────────────────────────────────────────────────────

personG = genSurface(rng);
personColor = genColor(rng);
personConstraints = genConstraints(rng, personG);
personOcclusion = genOcclusion(rng);

const playerMesh = createSurfaceMesh(evalPlayer, {
  xRange: RANGE, yRange: RANGE, resolution: RES,
  heightScale: H_SCALE, opacity: 0.9, colorFn: playerCF,
});
playerMesh.position.y = -1.2;
playerMesh.renderOrder = 0;
scene.add(playerMesh);

const otherMesh = createSurfaceMesh(evalPerson, {
  xRange: RANGE, yRange: RANGE, resolution: RES,
  heightScale: H_SCALE, opacity: 0.55, colorFn: personCF(personColor),
});
otherMesh.position.y = 1.4;
otherMesh.renderOrder = 1;
scene.add(otherMesh);

const combinedMesh = createSurfaceMesh(evalCombined, {
  xRange: RANGE, yRange: RANGE, resolution: RES,
  heightScale: H_SCALE, opacity: 0.85, colorFn: combinedCF,
});
combinedMesh.visible = false;
combinedMesh.renderOrder = 2;
scene.add(combinedMesh);

scene.add(constraintGroup);

// Marble
const marbleMat = new THREE.MeshPhongMaterial({
  color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4, shininess: 100,
});
const marbleMesh = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R, 20, 20), marbleMat
);
marbleMesh.visible = false;
scene.add(marbleMesh);

const glowMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.15,
});
marbleMesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), glowMat));
const mLight = new THREE.PointLight(0xffffff, 1.5, 4);
marbleMesh.add(mLight);

// Trail
const trailBuf = new Float32Array(MAX_TRAIL * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailBuf, 3));
trailGeo.setDrawRange(0, 0);
const trailMat = new THREE.LineBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.3,
});
const trailLine = new THREE.Line(trailGeo, trailMat);
scene.add(trailLine);

// Ghost marbles
const ghostGeo = new THREE.SphereGeometry(BALL_R * 0.8, 16, 16);
const ghostPMat = new THREE.MeshPhongMaterial({
  color: 0x4ade80, transparent: true, opacity: 0.7,
  emissive: 0x4ade80, emissiveIntensity: 0.3,
});
const ghostOMat = new THREE.MeshPhongMaterial({
  color: 0xffffff, transparent: true, opacity: 0.7,
  emissive: 0xffffff, emissiveIntensity: 0.3,
});
const ghostP = new THREE.Mesh(ghostGeo, ghostPMat);
const ghostO = new THREE.Mesh(ghostGeo.clone(), ghostOMat);
ghostP.visible = ghostO.visible = false;
scene.add(ghostP, ghostO);

// ─── UI ──────────────────────────────────────────────────────────────

const roundEl = document.getElementById('round-display');
const btnT = document.getElementById('btn-trust');
const btnD = document.getElementById('btn-distrust');
const barBox = document.getElementById('bar-history');
const flashEl = document.getElementById('result-flash');
const flashNum = document.getElementById('result-number');
const flashSub = document.getElementById('result-sub');

function setButtons(on) {
  btnT.classList[on ? 'remove' : 'add']('disabled');
  btnD.classList[on ? 'remove' : 'add']('disabled');
}

// ─── Round lifecycle ─────────────────────────────────────────────────

function initRound() {
  if (round > 0) {
    personG = genSurface(rng);
    personColor = genColor(rng);
    personConstraints = genConstraints(rng, personG);
    personOcclusion = genOcclusion(rng);
    otherMesh.userData._colorFn = personCF(personColor);
    updateSurfaceMesh(otherMesh, evalPerson);
    applyOcclusion(otherMesh, personOcclusion);
  } else {
    applyOcclusion(otherMesh, personOcclusion);
  }

  // Build constraint line visuals
  buildConstraintLines();
  updateConstraintPositions(evalPerson, 1.4);

  playerMesh.visible = true;
  playerMesh.position.y = -1.2;
  playerMesh.material.opacity = 0.9;
  otherMesh.visible = true;
  otherMesh.position.y = 1.4;
  otherMesh.material.opacity = 0.55;
  combinedMesh.visible = false;
  marbleMesh.visible = false;
  ghostP.visible = ghostO.visible = false;
  trailGeo.setDrawRange(0, 0);
  flashEl.style.opacity = '0';
  constraintGroup.visible = true;

  roundEl.textContent = round + 1;
  setButtons(true);
  phase = 'IDLE';
}

function onChoice(c) {
  if (phase !== 'IDLE') return;
  choice = c;
  setButtons(false);
  updateSurfaceMesh(combinedMesh, evalCombined);
  phase = 'MERGING';
  phaseStart = performance.now();
}

function enterMarble() {
  phase = 'MARBLE';
  marbleTime = 0;
  settled = false;
  settleTime = 0;
  settledFrames = 0;
  trailIdx = 0;

  physics = new BallPhysics(evalCombined, {
    gravity: 30, damping: 7, mass: 1.0, maxDt: 0.03,
    bounds: [-1.9, 1.9], kickForce: 3,
  });

  // Spawn from random edge
  const edge = Math.floor(rng() * 4);
  const pos = -1.2 + rng() * 2.4;
  const spd = 2.5 + rng() * 1.5;
  const spr = (rng() - 0.5) * 1.5;

  if (edge === 0)      { physics.x = -1.8; physics.y = pos; physics.vx = spd;  physics.vy = spr; }
  else if (edge === 1) { physics.x = 1.8;  physics.y = pos; physics.vx = -spd; physics.vy = spr; }
  else if (edge === 2) { physics.x = pos;  physics.y = -1.8; physics.vx = spr; physics.vy = spd; }
  else                 { physics.x = pos;  physics.y = 1.8;  physics.vx = spr; physics.vy = -spd; }

  // Record which side of each constraint the marble starts on
  constraintSides = personConstraints.map(({ a, b, c }) =>
    Math.sign(a * physics.x + b * physics.y - c)
  );

  // Update constraint lines to follow combined surface
  updateConstraintPositions(evalCombined, 0);

  marbleMesh.visible = true;
  const cc = choice === 'trust' ? 0x4ade80 : 0xf87171;
  marbleMat.emissive.setHex(cc);
  glowMat.color.setHex(cc);
  mLight.color.setHex(cc);
  trailMat.color.setHex(cc);
}

function enterSeparate() {
  phase = 'SEPARATING';
  phaseStart = performance.now();

  const zHere = evalPlayer(finalX, finalY);
  const zDist = zHere - playerMin.z;

  // Add bar
  const bar = document.createElement('div');
  bar.className = 'bar';
  const norm = Math.min(1, zDist / Z_NORM);
  bar.style.height = (BAR_MIN_H + norm * (BAR_MAX_H - BAR_MIN_H)) + 'px';
  bar.style.backgroundColor = choice === 'trust' ? '#4ade80' : '#f87171';
  barBox.appendChild(bar);
  barBox.scrollLeft = barBox.scrollWidth;

  // Flash — no numeric score, just the label
  flashNum.textContent = choice === 'trust' ? 'TRUSTED' : 'PASSED';
  flashSub.textContent = '';
  flashEl.style.opacity = '1';

  // Ghost marbles
  ghostP.visible = ghostO.visible = true;
  ghostOMat.color.copy(personColor);
  ghostOMat.emissive.copy(personColor);
  ghostP.userData._sh = evalPlayer(finalX, finalY) * H_SCALE;
  ghostO.userData._sh = evalPerson(finalX, finalY) * H_SCALE;

  marbleMesh.visible = false;
}

// ─── Animation loop ─────────────────────────────────────────────────

let lastT = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  orbit.update(dt);

  // ── MERGING ──
  if (phase === 'MERGING') {
    const t = Math.min(1, (now - phaseStart) / MERGE_MS);
    const e = t * t * (3 - 2 * t);

    playerMesh.position.y = -1.2 + e * 1.2;
    otherMesh.position.y = 1.4 - e * 1.4;

    // Constraint lines follow person surface down
    updateConstraintPositions(evalPerson, otherMesh.position.y);

    if (t >= 1) {
      // Surfaces have fully slid together — swap to combined
      playerMesh.visible = false;
      otherMesh.visible = false;
      combinedMesh.visible = true;
      combinedMesh.material.opacity = 0.85;
      enterMarble();
    }
  }

  // ── MARBLE ──
  if (phase === 'MARBLE') {
    if (!settled) {
      physics.step(dt);
      enforceConstraints();
      marbleTime += dt;

      const h = evalCombined(physics.x, physics.y) * H_SCALE;
      marbleMesh.position.set(physics.x, h + BALL_R, physics.y);

      if (trailIdx < MAX_TRAIL) {
        const tp = trailGeo.attributes.position;
        tp.setXYZ(trailIdx, physics.x, h + BALL_R * 0.5, physics.y);
        tp.needsUpdate = true;
        trailGeo.setDrawRange(0, ++trailIdx);
      }

      const spd = Math.hypot(physics.vx, physics.vy);
      if (spd < SETTLE_SPEED) settledFrames++;
      else settledFrames = 0;

      if (settledFrames >= SETTLE_FRAMES || marbleTime > MARBLE_TIMEOUT) {
        settled = true;
        settleTime = now;
        finalX = physics.x;
        finalY = physics.y;
      }
    } else {
      if ((now - settleTime) / 1000 > SETTLE_PAUSE) {
        enterSeparate();
      }
    }
  }

  // ── SEPARATING ──
  if (phase === 'SEPARATING') {
    const t = Math.min(1, (now - phaseStart) / SEPARATE_MS);
    const e = t * t * (3 - 2 * t);

    // Swap to individual surfaces immediately at start of separation
    if (!playerMesh.visible) {
      playerMesh.visible = true;
      playerMesh.material.opacity = 0.9;
      otherMesh.visible = true;
      otherMesh.material.opacity = 0.55;
      combinedMesh.visible = false;
    }
    playerMesh.position.y = -1.2 * e;
    otherMesh.position.y = 1.4 * e;

    // Constraint lines follow person surface
    updateConstraintPositions(evalPerson, otherMesh.position.y);

    ghostP.position.set(finalX, playerMesh.position.y + ghostP.userData._sh + BALL_R, finalY);
    ghostO.position.set(finalX, otherMesh.position.y + ghostO.userData._sh + BALL_R, finalY);

    if (t >= 1) {
      combinedMesh.visible = false;
      phase = 'POST';
      phaseStart = now;
    }
  }

  // ── POST ──
  if (phase === 'POST') {
    ghostP.position.set(finalX, playerMesh.position.y + ghostP.userData._sh + BALL_R, finalY);
    ghostO.position.set(finalX, otherMesh.position.y + ghostO.userData._sh + BALL_R, finalY);

    if (now - phaseStart > POST_MS) {
      flashEl.style.opacity = '0';
      phase = 'TRANSITION';
      setTimeout(() => { round++; initRound(); }, 300);
    }
  }

  renderer.render(scene, camera);
}

// ─── Events ──────────────────────────────────────────────────────────

btnT.addEventListener('click', () => onChoice('trust'));
btnD.addEventListener('click', () => onChoice('distrust'));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ─── Init ────────────────────────────────────────────────────────────

initRound();
requestAnimationFrame(animate);
