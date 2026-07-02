// Game logic for Chirp: levels, the chirp sequencer, input and rendering.

const LEVELS = [
  {
    name: '1 · Tutorial', targets: 1, visible: true, threshold: 0.10, dwell: 1.2,
    hint: 'Move your buzzy chirp (orange) onto the bell (blue) with the arrow keys. Left/right is stereo position, up/down is pitch. Hold still to lock.',
  },
  {
    name: '2 · Blind Match', targets: 1, visible: false, threshold: 0.10, dwell: 1.2,
    hint: 'Now you fly blind. Listen: which ear is the bell in, and is it higher or lower than you? Press H to peek if lost.',
  },
  {
    name: '3 · Between Two', targets: 2, visible: false, threshold: 0.11, dwell: 1.4,
    hint: 'Two bells, a fifth apart. Settle on the point exactly between them — in pan and in pitch.',
  },
  {
    name: '4 · Triangulate', targets: 3, visible: false, threshold: 0.12, dwell: 1.4,
    hint: 'Three bells form a chord. Find their centre.',
  },
  {
    name: '5 · Through the Haze', targets: 2, visible: false, threshold: 0.11, dwell: 1.4,
    distraction: true,
    hint: 'A dreamy backdrop plays. Let it wash over you — only the two bells matter.',
  },
  {
    name: '6 · Moving Target', targets: 1, visible: false, threshold: 0.12, dwell: 2.0,
    moving: true,
    hint: 'The bell is drifting. Chase it by ear and hold on for two seconds.',
  },
];

const MOVE_SPEED = 0.28;       // units per second
const STEP = 0.5;              // seconds between chirps in the sequence
const LOOKAHEAD = 0.12;        // audio scheduling horizon
const PEEK_TIME = 2.0;         // seconds the map stays visible after H

const state = {
  screen: 'title',             // 'title' | 'playing' | 'won' | 'finished'
  levelIndex: 0,
  player: { x: 0.5, y: 0.5 },
  targets: [],
  goal: { x: 0.5, y: 0.5 },
  padRoot: 110,
  dwell: 0,
  peek: 0,
  time: 0,                     // seconds since level start (drives moving targets)
  keys: {},
  stepIndex: 0,
  nextStepTime: 0,
};

const canvas = document.getElementById('canvas');
const cx2d = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const levelNameEl = document.getElementById('levelName');
const hintEl = document.getElementById('hint');
const statusEl = document.getElementById('status');
const lockbarEl = document.getElementById('lockbar');

// ---------- level setup ----------

const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function centroid(pts) {
  const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

// Pick k x-positions that are well separated, in shuffled order so pitch
// order does not always run left to right.
function pickSpreadXs(k) {
  const minSep = k === 2 ? 0.32 : 0.26;
  for (let attempt = 0; attempt < 100; attempt++) {
    const xs = Array.from({ length: k }, () => rand(0.1, 0.9));
    let ok = true;
    for (let i = 0; i < k; i++)
      for (let j = i + 1; j < k; j++)
        if (Math.abs(xs[i] - xs[j]) < minSep) ok = false;
    if (ok) return xs;
  }
  return null;
}

function makeTargets(lvl) {
  const start = { x: 0.5, y: 0.5 };
  for (let attempt = 0; attempt < 300; attempt++) {
    let targets;
    let fBase = rand(230, 340);

    if (lvl.moving) {
      const t = {
        cx: rand(0.32, 0.68), cy: rand(0.32, 0.68),
        rx: rand(0.15, 0.24), ry: rand(0.15, 0.24),
        wx: rand(0.18, 0.3), wy: rand(0.18, 0.3),
        px: rand(0, Math.PI * 2), py: rand(0, Math.PI * 2),
      };
      moveTarget(t, 0);
      targets = [t];
    } else if (lvl.targets === 1) {
      targets = [{ x: rand(0.12, 0.88), y: rand(0.12, 0.88) }];
    } else {
      // Harmonic pitch layout: a fifth for two bells, a major triad for three.
      const ratios = lvl.targets === 2 ? [1, 3 / 2] : [1, 5 / 4, 3 / 2];
      const maxR = ratios[ratios.length - 1];
      fBase = rand(AudioEngine.FMIN * 1.15, AudioEngine.FMAX / (maxR * 1.15));
      const ys = ratios.map(r => AudioEngine.yOfFreq(fBase * r));
      const xs = pickSpreadXs(lvl.targets);
      if (!xs) continue;
      targets = xs.map((x, k) => ({ x, y: ys[k] }));
    }

    const goal = lvl.moving ? targets[0] : centroid(targets);
    if (dist(goal, start) < 0.22) continue;
    if (!lvl.moving && targets.some(t => dist(t, start) < 0.15)) continue;
    return { targets, goal, fBase };
  }
  // Statistically unreachable, but never leave the level unplayable.
  const fallback = [{ x: 0.2, y: 0.75 }];
  return { targets: fallback, goal: fallback[0], fBase: 300 };
}

function moveTarget(t, time) {
  t.x = t.cx + t.rx * Math.sin(time * t.wx + t.px);
  t.y = t.cy + t.ry * Math.sin(time * t.wy + t.py);
}

function setupLevel(i) {
  const lvl = LEVELS[i];
  state.levelIndex = i;
  state.player = { x: 0.5, y: 0.5 };
  const made = makeTargets(lvl);
  state.targets = made.targets;
  state.goal = made.goal;
  state.padRoot = made.fBase / 2;
  state.dwell = 0;
  state.peek = 0;
  state.time = 0;
  state.stepIndex = 0;
  state.nextStepTime = AudioEngine.now() + 0.2;
  state.screen = 'playing';

  if (lvl.distraction) AudioEngine.startPad(state.padRoot);
  else AudioEngine.stopPad();

  levelNameEl.textContent = `${lvl.name} — level ${i + 1}/${LEVELS.length}`;
  hintEl.textContent = lvl.hint;
  statusEl.textContent = '';
}

// ---------- chirp sequencer ----------
// One cycle = each target chirps in turn, then the player chirps. A lookahead
// scheduler keeps timing steady regardless of frame rate.

function schedulerTick() {
  if (state.screen !== 'playing') return;
  const lvl = LEVELS[state.levelIndex];
  while (state.nextStepTime < AudioEngine.now() + LOOKAHEAD) {
    const when = state.nextStepTime;
    const cycle = state.targets.length + 1;
    const slot = state.stepIndex % cycle;

    if (slot < state.targets.length) {
      const t = state.targets[slot];
      AudioEngine.targetChirp(t.x, t.y, when);
    } else {
      const locked = dist(state.player, state.goal) < lvl.threshold;
      AudioEngine.playerChirp(state.player.x, state.player.y, when, locked);
    }

    // Soft plucks over the drone, consonant with its root, at random pans.
    if (lvl.distraction && Math.random() < 0.45) {
      const harmonics = [2, 3, 4, 5, 6];
      const f = state.padRoot * harmonics[Math.floor(Math.random() * harmonics.length)];
      AudioEngine.pluck(f, when + STEP / 2, Math.random(), 0.045, 0.8);
    }

    state.stepIndex++;
    state.nextStepTime += STEP;
  }
}

// ---------- game loop ----------

let lastFrame = performance.now();

function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;

  if (state.screen === 'playing') {
    const lvl = LEVELS[state.levelIndex];
    state.time += dt;

    let dx = 0, dy = 0;
    if (state.keys.ArrowLeft || state.keys.KeyA) dx -= 1;
    if (state.keys.ArrowRight || state.keys.KeyD) dx += 1;
    if (state.keys.ArrowUp || state.keys.KeyW) dy += 1;
    if (state.keys.ArrowDown || state.keys.KeyS) dy -= 1;
    state.player.x = Math.min(1, Math.max(0, state.player.x + dx * MOVE_SPEED * dt));
    state.player.y = Math.min(1, Math.max(0, state.player.y + dy * MOVE_SPEED * dt));

    if (lvl.moving) moveTarget(state.targets[0], state.time);

    if (dist(state.player, state.goal) < lvl.threshold) {
      state.dwell += dt;
      if (state.dwell >= lvl.dwell) win();
    } else {
      state.dwell = Math.max(0, state.dwell - dt * 2);
    }

    state.peek = Math.max(0, state.peek - dt);
    lockbarEl.style.width = `${Math.min(1, state.dwell / lvl.dwell) * 100}%`;
  }

  render();
  requestAnimationFrame(frame);
}

function win() {
  const lvl = LEVELS[state.levelIndex];
  AudioEngine.stopPad();
  AudioEngine.jingle(AudioEngine.freqOf(state.goal.y));
  lockbarEl.style.width = '100%';
  if (state.levelIndex + 1 >= LEVELS.length) {
    state.screen = 'finished';
    statusEl.textContent = 'You finished every level! Press N to play again.';
  } else {
    state.screen = 'won';
    statusEl.textContent = `Matched! Press N for “${LEVELS[state.levelIndex + 1].name}”.`;
  }
  hintEl.textContent = lvl.visible
    ? 'Nice — from the next level on, the map goes dark.'
    : 'The map below shows where everything was.';
}

// ---------- rendering ----------

const W = canvas.width, H = canvas.height;
const px = v => v * W;
const py = v => (1 - v) * H; // y=1 (high pitch) is the top of the canvas

function render() {
  const lvl = LEVELS[state.levelIndex];
  cx2d.clearRect(0, 0, W, H);

  if (state.screen === 'title') return;

  const reveal = lvl.visible || state.screen === 'won' || state.screen === 'finished';
  const alpha = reveal ? 1 : Math.min(1, state.peek / 0.5);

  drawGrid();

  if (alpha <= 0) {
    cx2d.fillStyle = 'rgba(107, 118, 136, 0.55)';
    cx2d.font = '15px sans-serif';
    cx2d.textAlign = 'center';
    cx2d.fillText('listening mode — press H to peek', W / 2, H / 2);
    // The player's pulse ring is always visible, centred, revealing nothing.
    const pulse = 6 + 3 * Math.sin(performance.now() / 300);
    cx2d.strokeStyle = 'rgba(255, 159, 67, 0.25)';
    cx2d.lineWidth = 2;
    cx2d.beginPath();
    cx2d.arc(W / 2, H / 2 + 30, pulse + 14, 0, Math.PI * 2);
    cx2d.stroke();
    return;
  }

  cx2d.save();
  cx2d.globalAlpha = alpha;

  for (const t of state.targets) drawDot(t, '#4cc9f0', 10);

  if (state.targets.length > 1) {
    cx2d.strokeStyle = '#7bd88f';
    cx2d.setLineDash([5, 5]);
    cx2d.lineWidth = 2;
    cx2d.beginPath();
    cx2d.arc(px(state.goal.x), py(state.goal.y), px(lvl.threshold), 0, Math.PI * 2);
    cx2d.stroke();
    cx2d.setLineDash([]);
  }

  drawDot(state.player, '#ff9f43', 9);

  cx2d.fillStyle = 'rgba(205, 214, 228, 0.5)';
  cx2d.font = '12px sans-serif';
  cx2d.textAlign = 'center';
  cx2d.fillText('◀ pan ▶', W / 2, H - 10);
  cx2d.save();
  cx2d.translate(14, H / 2);
  cx2d.rotate(-Math.PI / 2);
  cx2d.fillText('pitch ▲', 0, 0);
  cx2d.restore();

  cx2d.restore();
}

function drawGrid() {
  cx2d.strokeStyle = 'rgba(30, 40, 54, 0.8)';
  cx2d.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const v = (i / 4) * W;
    cx2d.beginPath(); cx2d.moveTo(v, 0); cx2d.lineTo(v, H); cx2d.stroke();
    cx2d.beginPath(); cx2d.moveTo(0, v); cx2d.lineTo(W, v); cx2d.stroke();
  }
}

function drawDot(p, color, r) {
  const pulse = 1 + 0.12 * Math.sin(performance.now() / 250);
  cx2d.fillStyle = color;
  cx2d.beginPath();
  cx2d.arc(px(p.x), py(p.y), r * pulse, 0, Math.PI * 2);
  cx2d.fill();
  cx2d.strokeStyle = color;
  cx2d.globalAlpha *= 0.35;
  cx2d.beginPath();
  cx2d.arc(px(p.x), py(p.y), r * pulse + 7, 0, Math.PI * 2);
  cx2d.stroke();
  cx2d.globalAlpha /= 0.35;
}

// ---------- input ----------

const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyH', 'KeyR', 'KeyN', 'Enter',
]);

window.addEventListener('keydown', e => {
  if (!GAME_KEYS.has(e.code)) return;
  e.preventDefault();
  state.keys[e.code] = true;

  if (e.code === 'KeyH' && state.screen === 'playing') state.peek = PEEK_TIME;
  if (e.code === 'KeyR' && (state.screen === 'playing' || state.screen === 'won'))
    setupLevel(state.levelIndex);
  if ((e.code === 'KeyN' || e.code === 'Enter')) {
    if (state.screen === 'won') setupLevel(state.levelIndex + 1);
    else if (state.screen === 'finished') setupLevel(0);
  }
});

window.addEventListener('keyup', e => {
  if (GAME_KEYS.has(e.code)) state.keys[e.code] = false;
});

document.getElementById('vol').addEventListener('input', e => {
  AudioEngine.setVolume(parseFloat(e.target.value));
});

document.getElementById('startBtn').addEventListener('click', async () => {
  await AudioEngine.start();
  overlay.classList.add('hidden');
  setupLevel(0);
  setInterval(schedulerTick, 25);
});

requestAnimationFrame(frame);
