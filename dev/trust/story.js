/**
 * CTRL — Trust (v2)
 *
 * Two mechanisms of trust visualized as 3D surfaces:
 * - Player surface (bottom, purple) — what you want
 * - Other person's surface (top, tinted) — what they want
 *
 * Trust → surfaces merge into combined landscape, marble drops and rolls
 * via gradient descent. Score = how close the marble lands to YOUR minimum.
 *
 * Don't Trust → safe but low score.
 *
 * 3 people × 3 cycles = 9 rounds. Surfaces drift each cycle.
 */

import * as THREE from 'three';
import { createSurfaceMesh, updateSurfaceMesh } from '../../lib/surface.js';
import { OrbitController } from '../../lib/camera.js';
import { depthColorTo } from '../../lib/colors.js';

// ─── Constants ────────────────────────────────────────────────────────

const TOTAL_ROUNDS = 9;
const SAFE_SCORE = 10;
const MARBLE_STEPS = 300;
const MARBLE_STEP_SIZE = 0.008;
const MARBLE_MOMENTUM = 0.85;
const GRADIENT_THRESHOLD = 0.0005;
const SURFACE_RANGE = [-2, 2];
const SURFACE_RES = 80;
const HEIGHT_SCALE = 0.6;

// ─── People ───────────────────────────────────────────────────────────

const PEOPLE = [
  {
    name: 'ALIGNED',
    color: new THREE.Color(0x00bfa5), // teal
    labelColor: '#00bfa5',
    // Wells that reinforce player's — trustworthy (~94 avg score)
    gaussians: [
      { cx: -0.6, cy: -0.6, depth: -3.0, sigma: 0.8 },
      { cx: 0.7, cy: -0.2, depth: -2.0, sigma: 0.7 },
    ]
  },
  {
    name: 'DECEPTIVE',
    color: new THREE.Color(0xf5b342), // gold
    labelColor: '#f5b342',
    // Broad positive bump weakens player wells; strong far attractors
    // pull marble to wrong places (~69 avg score)
    gaussians: [
      { cx: 1.3, cy: 1.3, depth: -6.0, sigma: 0.5 },
      { cx: -1.0, cy: 0.8, depth: -3.0, sigma: 0.5 },
      { cx: 0.0, cy: 0.0, depth: 2.5, sigma: 1.8 },
    ]
  },
  {
    name: 'RELIABLE',
    color: new THREE.Color(0xff6b8a), // rose
    labelColor: '#ff6b8a',
    // Single deep well perfectly aligned with player well #1
    // Boring but safest (~96 avg score)
    gaussians: [
      { cx: -0.5, cy: -0.5, depth: -5.0, sigma: 0.8 },
    ]
  }
];

// Player surface: 3 wells
const PLAYER_GAUSSIANS = [
  { cx: -0.5, cy: -0.5, depth: -3.5, sigma: 0.7 },
  { cx: 0.8, cy: -0.3, depth: -2.5, sigma: 0.8 },
  { cx: -0.3, cy: 1.0, depth: -2.0, sigma: 0.6 },
];

const PLAYER_MINIMA = [
  { x: -0.5, y: -0.5 },
  { x: 0.8, y: -0.3 },
  { x: -0.3, y: 1.0 },
];

// ─── Surface drift per cycle ──────────────────────────────────────────

function makeDrifts() {
  return [
    // Cycle 0: no drift
    PEOPLE.map(p => p.gaussians.map(() => ({ dx: 0, dy: 0 }))),
    // Cycle 1: slight drift
    PEOPLE.map(p => p.gaussians.map(() => ({
      dx: (Math.random() - 0.5) * 0.3,
      dy: (Math.random() - 0.5) * 0.3,
    }))),
    // Cycle 2: more drift
    PEOPLE.map(p => p.gaussians.map(() => ({
      dx: (Math.random() - 0.5) * 0.6,
      dy: (Math.random() - 0.5) * 0.6,
    }))),
  ];
}

// ─── Surface evaluation ───────────────────────────────────────────────

function evalGaussians(gaussians, x, y, drifts) {
  let z = 0;
  for (let i = 0; i < gaussians.length; i++) {
    const g = gaussians[i];
    const dx = drifts ? drifts[i].dx : 0;
    const dy = drifts ? drifts[i].dy : 0;
    const ex = x - (g.cx + dx);
    const ey = y - (g.cy + dy);
    z += g.depth * Math.exp(-(ex * ex + ey * ey) / g.sigma);
  }
  // Gentle boundary to keep the surface from being flat at edges
  const r2 = x * x + y * y;
  z += 0.05 * r2;
  return z;
}

function evalPlayer(x, y) {
  return evalGaussians(PLAYER_GAUSSIANS, x, y, null);
}

function evalPerson(personIdx, cycle, drifts, x, y) {
  return evalGaussians(PEOPLE[personIdx].gaussians, x, y, drifts[cycle][personIdx]);
}

function evalCombined(personIdx, cycle, drifts, x, y) {
  return evalPlayer(x, y) + evalPerson(personIdx, cycle, drifts, x, y);
}

// ─── Color functions ──────────────────────────────────────────────────

const _tmpColor = new THREE.Color();

function playerColorFn(out, value, min, max) {
  // Purple-tinted depth gradient
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const r = (0.15 + frac * 0.20);
  const g = (0.08 + frac * 0.08);
  const b = (0.45 - frac * 0.15);
  out.setRGB(r, g, b);
  return out;
}

function personColorFn(baseColor) {
  return function(out, value, min, max) {
    const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
    out.copy(baseColor);
    out.multiplyScalar(0.3 + frac * 0.7);
    return out;
  };
}

function combinedColorFn(out, value, min, max) {
  return depthColorTo(out, value, min, max);
}

// ─── Game state ───────────────────────────────────────────────────────

let currentRound = 0;
let totalScore = 0;
let animating = false;
let personDrifts = makeDrifts();
let roundScores = [];
let roundPersonIndices = [];
let roundTrusted = [];

function getPersonIndex() { return currentRound % 3; }
function getCycle() { return Math.floor(currentRound / 3); }

// ─── Scene setup ──────────────────────────────────────────────────────

const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45,
  window.innerWidth / window.innerHeight, 0.1, 100);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000);
container.appendChild(renderer.domElement);

// Lighting
scene.add(new THREE.AmbientLight(0x404060, 0.6));

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(3, 5, 4);
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0x6644aa, 0.3);
rimLight.position.set(-3, 2, -4);
scene.add(rimLight);

// Orbit camera
const orbit = new OrbitController(camera, renderer.domElement, {
  radius: 8,
  radiusMin: 4,
  radiusMax: 16,
  defaultPhi: Math.PI / 3.5,
  phiMin: 0.3,
  phiMax: 1.5,
  autoSpeed: 0.12,
  snapSpeed: 0.04,
  target: new THREE.Vector3(0, -0.5, 0),
  ignoreSelector: '#controls, #end-screen',
});

// ─── Create meshes ────────────────────────────────────────────────────

// Player surface (bottom)
const playerMesh = createSurfaceMesh(evalPlayer, {
  xRange: SURFACE_RANGE,
  yRange: SURFACE_RANGE,
  resolution: SURFACE_RES,
  heightScale: HEIGHT_SCALE,
  opacity: 0.9,
  colorFn: playerColorFn,
});
playerMesh.position.y = -1.2;
scene.add(playerMesh);

// Other person surface (top)
const pIdx0 = getPersonIndex();
const cycle0 = getCycle();

const otherMesh = createSurfaceMesh(
  (x, y) => evalPerson(pIdx0, cycle0, personDrifts, x, y), {
    xRange: SURFACE_RANGE,
    yRange: SURFACE_RANGE,
    resolution: SURFACE_RES,
    heightScale: HEIGHT_SCALE,
    opacity: 0.55,
    colorFn: personColorFn(PEOPLE[pIdx0].color),
  }
);
otherMesh.position.y = 1.4;
scene.add(otherMesh);

// Combined surface (hidden)
const combinedMesh = createSurfaceMesh(
  (x, y) => evalCombined(pIdx0, cycle0, personDrifts, x, y), {
    xRange: SURFACE_RANGE,
    yRange: SURFACE_RANGE,
    resolution: SURFACE_RES,
    heightScale: HEIGHT_SCALE,
    opacity: 0.85,
    colorFn: combinedColorFn,
  }
);
combinedMesh.position.y = 0;
combinedMesh.visible = false;
scene.add(combinedMesh);

// Marble
const marbleGeo = new THREE.SphereGeometry(0.1, 20, 20);
const marbleMat = new THREE.MeshPhongMaterial({
  color: 0xffffff,
  emissive: 0xff6b8a,
  emissiveIntensity: 0.6,
  shininess: 100,
});
const marbleMesh = new THREE.Mesh(marbleGeo, marbleMat);
marbleMesh.visible = false;
scene.add(marbleMesh);

// Marble glow
const glowGeo = new THREE.SphereGeometry(0.22, 16, 16);
const glowMat = new THREE.MeshBasicMaterial({
  color: 0xff6b8a,
  transparent: true,
  opacity: 0.15,
});
const glowMesh = new THREE.Mesh(glowGeo, glowMat);
marbleMesh.add(glowMesh);

// Marble point light
const marbleLight = new THREE.PointLight(0xff6b8a, 1.5, 4);
marbleMesh.add(marbleLight);

// Trail line
const trailGeo = new THREE.BufferGeometry();
const trailPositions = new Float32Array(MARBLE_STEPS * 3);
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
trailGeo.setDrawRange(0, 0);
const trailMat = new THREE.LineBasicMaterial({
  color: 0xff6b8a,
  transparent: true,
  opacity: 0.4,
});
const trailLine = new THREE.Line(trailGeo, trailMat);
scene.add(trailLine);

// ─── UI helpers ───────────────────────────────────────────────────────

const scoreEl = document.getElementById('score-value');
const roundEl = document.getElementById('round-display');
const personEl = document.getElementById('person-label');
const flashEl = document.getElementById('result-flash');
const flashNum = document.getElementById('result-number');
const flashSub = document.getElementById('result-sub');
const btnTrust = document.getElementById('btn-trust');
const btnDistrust = document.getElementById('btn-distrust');
const endScreen = document.getElementById('end-screen');
const controlsEl = document.getElementById('controls');

function updateRoundUI() {
  const pIdx = getPersonIndex();
  roundEl.textContent = (currentRound + 1) + ' / ' + TOTAL_ROUNDS;
  personEl.textContent = PEOPLE[pIdx].name;
  personEl.style.color = PEOPLE[pIdx].labelColor;
  scoreEl.textContent = totalScore;
}

function setButtonsEnabled(enabled) {
  const method = enabled ? 'remove' : 'add';
  btnTrust.classList[method]('disabled');
  btnDistrust.classList[method]('disabled');
}

function showBothSurfaces() {
  playerMesh.visible = true;
  playerMesh.position.y = -1.2;
  playerMesh.material.opacity = 0.9;
  otherMesh.visible = true;
  otherMesh.position.y = 1.4;
  otherMesh.material.opacity = 0.55;
  combinedMesh.visible = false;
  marbleMesh.visible = false;
  trailLine.geometry.setDrawRange(0, 0);
  setButtonsEnabled(true);
}

// ─── Update surfaces for current round ────────────────────────────────

function updateSurfaces() {
  const pIdx = getPersonIndex();
  const cycle = getCycle();
  const personColor = PEOPLE[pIdx].color;

  // Rebuild other mesh with new color function and equation
  otherMesh.userData._colorFn = personColorFn(personColor);
  updateSurfaceMesh(otherMesh,
    (x, y) => evalPerson(pIdx, cycle, personDrifts, x, y));

  // Update combined
  updateSurfaceMesh(combinedMesh,
    (x, y) => evalCombined(pIdx, cycle, personDrifts, x, y));
}

// ─── Trust action ─────────────────────────────────────────────────────

function doTrust() {
  animating = true;
  setButtonsEnabled(false);

  const pIdx = getPersonIndex();
  const cycle = getCycle();

  updateSurfaces();

  // Animate surfaces merging
  const mergeStart = performance.now();
  const mergeDuration = 900;

  function animateMerge(now) {
    const t = Math.min(1, (now - mergeStart) / mergeDuration);
    const ease = t * t * (3 - 2 * t); // smoothstep

    playerMesh.position.y = -1.2 + ease * 1.2;
    otherMesh.position.y = 1.4 - ease * 1.4;
    otherMesh.material.opacity = 0.55 * (1 - ease);
    playerMesh.material.opacity = 0.9 * (1 - ease * 0.5);

    if (t < 1) {
      requestAnimationFrame(animateMerge);
    } else {
      playerMesh.visible = false;
      otherMesh.visible = false;
      combinedMesh.visible = true;
      combinedMesh.position.y = 0;
      spawnAndRollMarble(pIdx, cycle);
    }
  }

  requestAnimationFrame(animateMerge);
}

// ─── Marble physics ───────────────────────────────────────────────────

function spawnAndRollMarble(pIdx, cycle) {
  const [rMin, rMax] = SURFACE_RANGE;
  const range = rMax - rMin;

  // Random start in inner 70% of surface
  let mx = rMin + 0.15 * range + Math.random() * 0.7 * range;
  let my = rMin + 0.15 * range + Math.random() * 0.7 * range;

  const path = [];
  let vx = 0, vy = 0;
  const eps = 0.01;

  // Gradient descent with momentum
  for (let step = 0; step < MARBLE_STEPS; step++) {
    const dzx = (evalCombined(pIdx, cycle, personDrifts, mx + eps, my)
      - evalCombined(pIdx, cycle, personDrifts, mx - eps, my)) / (2 * eps);
    const dzy = (evalCombined(pIdx, cycle, personDrifts, mx, my + eps)
      - evalCombined(pIdx, cycle, personDrifts, mx, my - eps)) / (2 * eps);

    vx = MARBLE_MOMENTUM * vx - MARBLE_STEP_SIZE * dzx;
    vy = MARBLE_MOMENTUM * vy - MARBLE_STEP_SIZE * dzy;

    mx += vx;
    my += vy;

    // Clamp to bounds
    mx = Math.max(rMin + 0.1, Math.min(rMax - 0.1, mx));
    my = Math.max(rMin + 0.1, Math.min(rMax - 0.1, my));

    const h = evalCombined(pIdx, cycle, personDrifts, mx, my) * HEIGHT_SCALE;
    path.push({ wx: mx, wy: h + 0.12, wz: my, nx: mx, ny: my });

    const gradMag = Math.sqrt(dzx * dzx + dzy * dzy);
    if (gradMag < GRADIENT_THRESHOLD && step > 20) break;
  }

  // Set up trail
  const trailPos = trailLine.geometry.attributes.position;
  for (let i = 0; i < path.length && i < MARBLE_STEPS; i++) {
    trailPos.setXYZ(i, path[i].wx, path[i].wy, path[i].wz);
  }
  trailPos.needsUpdate = true;

  marbleMesh.visible = true;

  // Animate marble along path
  const animStart = performance.now();
  const totalDuration = 2800;

  function animateMarble(now) {
    const t = Math.min(1, (now - animStart) / totalDuration);
    const et = 1 - Math.pow(1 - t, 3); // ease out
    const idx = Math.min(path.length - 1, Math.floor(et * (path.length - 1)));
    const p = path[idx];

    marbleMesh.position.set(p.wx, p.wy, p.wz);
    trailLine.geometry.setDrawRange(0, idx + 1);

    if (t < 1) {
      requestAnimationFrame(animateMarble);
    } else {
      // Score: distance from marble's final position to nearest player minimum
      const finalX = p.nx;
      const finalY = p.ny;

      let minDist = Infinity;
      for (const m of PLAYER_MINIMA) {
        const d = Math.sqrt((finalX - m.x) ** 2 + (finalY - m.y) ** 2);
        if (d < minDist) minDist = d;
      }

      // Closer = higher score. Max useful dist ~2.0 on [-2,2] range
      const score = Math.round(Math.max(0, (1 - minDist / 1.5)) * 100);
      const clampedScore = Math.max(0, Math.min(100, score));

      roundScores.push(clampedScore);
      roundPersonIndices.push(pIdx);
      roundTrusted.push(true);
      totalScore += clampedScore;

      showResult(clampedScore, true);
    }
  }

  requestAnimationFrame(animateMarble);
}

// ─── Don't trust ──────────────────────────────────────────────────────

function doDistrust() {
  animating = true;
  setButtonsEnabled(false);

  const pIdx = getPersonIndex();
  roundScores.push(SAFE_SCORE);
  roundPersonIndices.push(pIdx);
  roundTrusted.push(false);
  totalScore += SAFE_SCORE;

  showResult(SAFE_SCORE, false);
}

// ─── Result display ───────────────────────────────────────────────────

function showResult(score, trusted) {
  flashNum.textContent = '+' + score;
  flashSub.textContent = trusted ? '' : 'SAFE';
  flashEl.style.opacity = '1';
  scoreEl.textContent = totalScore;

  setTimeout(() => {
    flashEl.style.opacity = '0';
    setTimeout(() => {
      currentRound++;

      if (currentRound >= TOTAL_ROUNDS) {
        showEndScreen();
        return;
      }

      updateSurfaces();
      updateRoundUI();
      showBothSurfaces();
      animating = false;
    }, 400);
  }, 1200);
}

// ─── End screen ───────────────────────────────────────────────────────

function showEndScreen() {
  controlsEl.style.display = 'none';
  endScreen.style.display = 'flex';
  document.getElementById('end-total').textContent = totalScore;

  let html = '';
  for (let p = 0; p < 3; p++) {
    const person = PEOPLE[p];
    let personTotal = 0;
    let trusted = 0;
    let rounds = 0;
    for (let r = 0; r < roundScores.length; r++) {
      if (roundPersonIndices[r] === p) {
        personTotal += roundScores[r];
        if (roundTrusted[r]) trusted++;
        rounds++;
      }
    }
    html += `<div><span class="person-name" style="color:${person.labelColor}">${person.name}</span> &mdash; ${personTotal} <span style="color:#444">(trusted ${trusted}/${rounds})</span></div>`;
  }
  document.getElementById('end-breakdown').innerHTML = html;
  animating = false;
}

// ─── Restart ──────────────────────────────────────────────────────────

function restart() {
  currentRound = 0;
  totalScore = 0;
  roundScores = [];
  roundPersonIndices = [];
  roundTrusted = [];
  animating = false;
  personDrifts = makeDrifts();

  endScreen.style.display = 'none';
  controlsEl.style.display = 'flex';

  updateSurfaces();
  updateRoundUI();
  showBothSurfaces();
}

// ─── Event listeners ──────────────────────────────────────────────────

btnTrust.addEventListener('click', () => {
  if (animating || currentRound >= TOTAL_ROUNDS) return;
  doTrust();
});

btnDistrust.addEventListener('click', () => {
  if (animating || currentRound >= TOTAL_ROUNDS) return;
  doDistrust();
});

document.getElementById('restart-btn').addEventListener('click', restart);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Animation loop ───────────────────────────────────────────────────

let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  orbit.update(dt);
  renderer.render(scene, camera);
}

// ─── Init ─────────────────────────────────────────────────────────────

updateRoundUI();
showBothSurfaces();
requestAnimationFrame(animate);
