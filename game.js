// Game logic for Chirp: levels, the chirp sequencer, input and rendering.
//
// Level kinds:
//   static    — fixed bells; the goal is their centre (or the bell itself)
//   moving    — one bell on a slow orbit; the goal is the bell
//   beating   — bell and player sound together as sustained tones
//   melody    — the bell walks a short tune; lock onto each note in turn
//   harmonise — a drifting bell; hold a fixed interval above or below it
//
// Hint text may use {move}, {Peek}, {Next}: they are replaced with keyboard
// or touch wording (see WORDS).

const LEVELS = [
  {
    id: 'tutorial', name: 'Tutorial', kind: 'static', targets: 1, visible: true,
    tolY: 0.06, dwell: 1.2,
    hint: 'Move your buzzy chirp (orange) onto the bell (blue) by {move}. Left/right is stereo position, up/down is pitch. Hold still to lock.',
  },
  {
    id: 'blind', name: 'Blind Match', kind: 'static', targets: 1, dwell: 1.2,
    hint: 'Now you fly blind. Listen: which ear is the bell in, and is it higher or lower than you? {Peek} if lost.',
  },
  {
    id: 'two', name: 'Between Two', kind: 'static', targets: 2, dwell: 1.4,
    hint: 'Two bells. Settle on the point exactly between them, in pan and in pitch. That point sounds consonant with both.',
  },
  {
    id: 'three', name: 'Triangulate', kind: 'static', targets: 3, dwell: 1.4,
    hint: 'Three bells stacked in fifths. Find their centre: its pitch is the middle bell’s, but its pan is not.',
  },
  {
    id: 'four', name: 'Four Bells', kind: 'static', targets: 4, tolX: 0.15, dwell: 1.4,
    hint: 'Four bells. Find their centre — it sounds a perfect fifth above the lowest bell.',
  },
  {
    id: 'haze', name: 'Through the Haze', kind: 'static', targets: 2, dwell: 1.4,
    distraction: true,
    hint: 'A dreamy backdrop plays. Let it wash over you — only the two bells matter.',
  },
  {
    id: 'moving', name: 'Moving Target', kind: 'moving', tolX: 0.15, tolY: 0.055, dwell: 2.0,
    hint: 'The bell is drifting. Chase it by ear and hold on for two seconds.',
  },
  {
    id: 'beating', name: 'Beating', kind: 'beating', targets: 1, tolX: 0.2, tolY: 0.012, dwell: 1.5,
    hint: 'Now both tones sound together. Off pitch they throb; tune until the throbbing slows and stops. You slow down near the right pitch.',
  },
  {
    id: 'melody', name: 'Follow the Tune', kind: 'melody', noteDwell: 0.6,
    hint: 'The bell plays a tune one note at a time. Lock onto each note to hear the next one.',
  },
  {
    id: 'memory', name: 'Tune from Memory', kind: 'melody', memory: true, noteDwell: 0.6,
    hint: 'Listen to the whole tune first. Then the bell stays one note ahead: play each note from memory. {Peek} to hear the tune again.',
  },
  {
    id: 'harmonise', name: 'Harmonise', kind: 'harmonise', ratio: 3 / 2,
    interval: 'a perfect fifth above', tolY: 0.03, dwell: 2.0,
    hint: 'The bell drifts. Stay at its pan, {interval} it — you will hear a clean chord when you are right.',
  },
];

// Intervals used by harmonise rounds in endless mode.
const HARMONY_CHOICES = [
  { ratio: 3 / 2, interval: 'a perfect fifth above' },
  { ratio: 4 / 3, interval: 'a perfect fourth above' },
  { ratio: 5 / 4, interval: 'a major third above' },
  { ratio: 2 / 3, interval: 'a perfect fifth below' },
];

// Pitch layouts for multi-bell levels, chosen so the centre is consonant:
// the midpoint of 1 and 9/4 is a fifth, of 1 and 16/9 a fourth; the centre
// of 1, 3/2, 9/4 is 3/2; the centre of 1, 9/8, 2, 9/4 is 3/2.
const RATIOS = {
  2: [[1, 9 / 4], [1, 16 / 9]],
  3: [[1, 3 / 2, 9 / 4]],
  4: [[1, 9 / 8, 2, 9 / 4]],
};

const PENTATONIC = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];

const DEFAULT_TOL_X = 0.14;    // pan tolerance of the lock ellipse
const DEFAULT_TOL_Y = 0.045;   // pitch tolerance, ≈ ±1 semitone
const MOVE_SPEED = 0.28;       // units per second
const LOOKAHEAD = 0.12;        // audio scheduling horizon
const PEEK_TIME = 2.0;         // seconds the map stays visible after a peek
const BUMP_GAP = 0.4;          // min seconds between wall bumps
const PHRASE_GAP = 0.42;       // note spacing when the tune is played whole
const ENDLESS_LIMIT = 60;      // seconds per endless round
const ENDLESS_SHRINK = 0.93;   // tolerance multiplier per endless round
const ENDLESS_FLOOR = 0.5;     // smallest tolerance multiplier

const WORDS = {
  keys: { move: 'the arrow keys', Peek: 'Press H', Next: 'Press N' },
  touch: { move: 'dragging on the map', Peek: 'Tap peek', Next: 'Tap next' },
};
const touchQuery = window.matchMedia('(hover: none), (pointer: coarse)');
const isTouch = () => touchQuery.matches;

function txt(s, extra = {}) {
  const words = isTouch() ? WORDS.touch : WORDS.keys;
  return s.replace(/\{(\w+)\}/g, (m, k) => extra[k] ?? words[k] ?? m);
}

// ---------- saved progress ----------

const STORE_KEY = 'chirp.progress.v1';

function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY));
    if (p && typeof p === 'object') {
      return {
        unlocked: Math.min(LEVELS.length, p.unlocked | 0),
        best: p.best && typeof p.best === 'object' ? p.best : {},
        endlessBest: p.endlessBest | 0,
      };
    }
  } catch (e) { /* storage unavailable or corrupt */ }
  return { unlocked: 0, best: {}, endlessBest: 0 };
}

function saveProgress() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ }
}

// unlocked = index of the furthest playable level; LEVELS.length = all done.
const progress = loadProgress();

// ---------- state ----------

const state = {
  screen: 'title',             // 'title' | 'playing' | 'won' | 'finished' | 'over'
  levelIndex: 0,
  endless: 0,                  // endless round number, 0 in the campaign
  lvl: LEVELS[0],
  tol: { x: DEFAULT_TOL_X, y: DEFAULT_TOL_Y },
  player: { x: 0.5, y: 0.5 },
  targets: [],
  goal: { x: 0.5, y: 0.5 },
  notes: [],                   // melody levels: the whole tune
  noteIndex: 0,
  harmonyOffset: 0,            // harmonise: goal y minus bell y
  padRoot: 110,
  dwell: 0,
  peek: 0,
  peeks: 0,
  time: 0,                     // seconds of play in this level
  keys: {},
  stepIndex: 0,
  nextStepTime: 0,
  live: [],                    // sustained player voices that follow movement
  lastBump: -1,
  warned: false,
  shownSecs: null,
};

const canvas = document.getElementById('canvas');
const cx2d = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const pickerEl = document.getElementById('levelPicker');
const endlessBtn = document.getElementById('endlessBtn');
const levelNameEl = document.getElementById('levelName');
const hintEl = document.getElementById('hint');
const statusEl = document.getElementById('status');
const srEl = document.getElementById('sr');
const lockbarEl = document.getElementById('lockbar');

// Screen-reader announcement (re-announces identical text too).
function announce(msg) {
  srEl.textContent = '';
  setTimeout(() => { srEl.textContent = msg; }, 30);
}

// ---------- level setup ----------

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = v => Math.min(1, Math.max(0, v));

function centroid(pts) {
  const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

// Pick k x-positions that are well separated, in shuffled order so pitch
// order does not always run left to right.
function pickSpreadXs(k) {
  const minSep = k === 2 ? 0.32 : k === 3 ? 0.26 : 0.18;
  for (let attempt = 0; attempt < 500; attempt++) {
    const xs = Array.from({ length: k }, () => rand(0.1, 0.9));
    let ok = true;
    for (let i = 0; i < k; i++)
      for (let j = i + 1; j < k; j++)
        if (Math.abs(xs[i] - xs[j]) < minSep) ok = false;
    if (ok) return xs;
  }
  return null;
}

// An elliptical orbit within the given y range.
function makeOrbit(yMin, yMax, ryRange, wRange) {
  const ry = Math.min(rand(...ryRange), (yMax - yMin) / 2 - 0.01);
  const rx = rand(0.15, 0.24);
  const t = {
    cx: rand(0.1 + rx, 0.9 - rx), cy: rand(yMin + ry, yMax - ry),
    rx, ry,
    wx: rand(...wRange), wy: rand(...wRange),
    px: rand(0, Math.PI * 2), py: rand(0, Math.PI * 2),
  };
  moveTarget(t, 0);
  return t;
}

function moveTarget(t, time) {
  t.x = t.cx + t.rx * Math.sin(time * t.wx + t.px);
  t.y = t.cy + t.ry * Math.sin(time * t.wy + t.py);
}

// A short tune on a major pentatonic scale: steps of at most two degrees,
// each note at its own pan.
function makePhrase() {
  const root = rand(AudioEngine.FMIN * 1.15, AudioEngine.FMAX / (2 * 1.15));
  const len = Math.random() < 0.5 ? 5 : 6;
  let deg = Math.floor(rand(0, 4));
  let x = rand(0.2, 0.8);
  const notes = [];
  for (let i = 0; i < len; i++) {
    if (i > 0) {
      let step;
      do step = pick([-2, -1, 1, 2]); while (deg + step < 0 || deg + step >= PENTATONIC.length);
      deg += step;
      let dx = rand(0.15, 0.3) * (Math.random() < 0.5 ? -1 : 1);
      if (x + dx < 0.1 || x + dx > 0.9) dx = -dx;
      x += dx;
    }
    notes.push({ x, y: AudioEngine.yOfFreq(root * PENTATONIC[deg]) });
  }
  return { notes, root };
}

function makeLevel(lvl) {
  for (let attempt = 0; attempt < 300; attempt++) {
    let targets, goal, notes = [], harmonyOffset = 0;
    let fBase = rand(230, 340);

    if (lvl.kind === 'moving') {
      targets = [makeOrbit(0.08, 0.92, [0.15, 0.24], [0.18, 0.3])];
      goal = targets[0];
    } else if (lvl.kind === 'harmonise') {
      harmonyOffset = AudioEngine.yOfFreq(AudioEngine.FMIN * lvl.ratio);
      const yMin = Math.max(0.05, 0.05 - harmonyOffset);
      const yMax = Math.min(0.95, 0.95 - harmonyOffset);
      targets = [makeOrbit(yMin, yMax, [0.1, 0.18], [0.12, 0.2])];
      goal = { x: targets[0].x, y: targets[0].y + harmonyOffset };
      fBase = AudioEngine.freqOf(targets[0].cy);
    } else if (lvl.kind === 'melody') {
      const phrase = makePhrase();
      notes = phrase.notes;
      fBase = phrase.root;
      targets = [notes[0]];
      goal = notes[0];
    } else if (lvl.targets === 1) {
      targets = [{ x: rand(0.12, 0.88), y: rand(0.12, 0.88) }];
      goal = targets[0];
    } else {
      const ratios = pick(RATIOS[lvl.targets]);
      const maxR = ratios[ratios.length - 1];
      fBase = rand(AudioEngine.FMIN * 1.15, AudioEngine.FMAX / (maxR * 1.15));
      const ys = ratios.map(r => AudioEngine.yOfFreq(fBase * r));
      const xs = pickSpreadXs(lvl.targets);
      if (!xs) continue;
      targets = xs.map((x, k) => ({ x, y: ys[k] }));
      goal = centroid(targets);
    }

    const start = pickStart(goal, lvl.kind === 'static' ? targets : []);
    if (!start) continue;
    return { targets, goal, fBase, notes, harmonyOffset, start };
  }
  // Statistically unreachable, but never leave the level unplayable.
  const fallback = [{ x: 0.2, y: 0.75 }];
  return { targets: fallback, goal: fallback[0], fBase: 300, notes: fallback, harmonyOffset: 0,
    start: { x: 0.5, y: 0.5 } };
}

// The player starts in the centre when that is a fair distance from the
// goal and not on top of a bell; otherwise somewhere random that is. (The
// centre of several consonant bells always sits near mid-pitch.)
function pickStart(goal, targets) {
  const ok = s => dist(goal, s) >= 0.22 && targets.every(t => dist(t, s) >= 0.15);
  const centre = { x: 0.5, y: 0.5 };
  if (ok(centre)) return centre;
  for (let i = 0; i < 200; i++) {
    const s = { x: rand(0.1, 0.9), y: rand(0.1, 0.9) };
    if (ok(s)) return s;
  }
  return null;
}

function setupLevel(i) {
  state.endless = 0;
  beginLevel(LEVELS[i], i);
}

function beginLevel(lvl, index) {
  state.lvl = lvl;
  state.levelIndex = index;
  const mult = state.endless
    ? Math.max(ENDLESS_FLOOR, Math.pow(ENDLESS_SHRINK, state.endless - 1)) : 1;
  state.tol = { x: (lvl.tolX ?? DEFAULT_TOL_X) * mult, y: (lvl.tolY ?? DEFAULT_TOL_Y) * mult };
  const made = makeLevel(lvl);
  state.player = { ...made.start };
  state.targets = made.targets;
  state.goal = made.goal;
  state.notes = made.notes;
  state.noteIndex = 0;
  state.harmonyOffset = made.harmonyOffset;
  state.padRoot = made.fBase / 2;
  state.dwell = 0;
  state.peek = 0;
  state.peeks = 0;
  state.time = 0;
  state.live = [];
  state.lastBump = -1;
  state.warned = false;
  state.shownSecs = null;
  state.stepIndex = 0;
  state.nextStepTime = AudioEngine.now() + 0.2;
  if (lvl.kind === 'melody' && lvl.memory) playPhrase(PHRASE_GAP, AudioEngine.now() + 0.3);
  state.screen = 'playing';
  overlay.classList.add('hidden');

  if (lvl.distraction) AudioEngine.startPad(state.padRoot);
  else AudioEngine.stopPad();

  updateLevelName();
  hintEl.textContent = txt(lvl.hint, { interval: lvl.interval });
  statusEl.textContent = '';
  lockbarEl.style.width = '0%';
}

function updateLevelName() {
  const lvl = state.lvl;
  if (state.endless) {
    const secs = state.screen === 'playing'
      ? ` · ${Math.max(0, Math.ceil(ENDLESS_LIMIT - state.time))} s` : '';
    levelNameEl.textContent = `Endless · round ${state.endless} — ${lvl.name}${secs}`;
  } else {
    levelNameEl.textContent = `${state.levelIndex + 1} · ${lvl.name} — level ${state.levelIndex + 1}/${LEVELS.length}`;
  }
}

// Endless mode: a random level type each round with shrinking tolerances
// and a time limit.
function startEndless() {
  state.endless = 0;
  nextEndlessRound();
}

function nextEndlessRound() {
  state.endless++;
  let idx;
  do idx = 1 + Math.floor(Math.random() * (LEVELS.length - 1));
  while (state.endless > 1 && idx === state.levelIndex && LEVELS.length > 2);
  const lvl = { ...LEVELS[idx] };
  if (lvl.kind === 'harmonise') Object.assign(lvl, pick(HARMONY_CHOICES));
  beginLevel(lvl, idx);
}

// ---------- chirp sequencer ----------
// A lookahead scheduler keeps timing steady regardless of frame rate. Each
// step plays one sound (or a pair) and returns how long the step lasts.

// Play the whole tune, e.g. for the memory level's intro and replays. The
// sequencer waits until it is over.
function playPhrase(gap, t0) {
  state.notes.forEach((n, i) => AudioEngine.targetChirp(n.x, n.y, t0 + i * gap));
  state.nextStepTime = Math.max(state.nextStepTime, t0 + state.notes.length * gap + 0.4);
}

function scheduleStep(when) {
  const lvl = state.lvl;
  const p = state.player;
  let step;

  if (lvl.kind === 'beating') {
    // Sustained tones together; the player's tone follows movement live.
    const dur = 1.6;
    step = 2.0;
    const t = state.targets[0];
    AudioEngine.sustain(t.x, t.y, when, dur, 'bell');
    state.live.push(AudioEngine.sustain(p.x, p.y, when, dur, 'player'));
  } else if (lvl.kind === 'harmonise') {
    // Both chirp at once so the interval is heard as a chord.
    step = 0.6;
    const t = state.targets[0];
    AudioEngine.targetChirp(t.x, t.y, when);
    AudioEngine.playerChirp(p.x, p.y, when, onGoal());
  } else if (lvl.kind === 'melody') {
    step = 0.45;
    if (state.stepIndex % 2 === 0) {
      // In the memory level the bell is one note ahead of the player.
      const n = state.notes[state.noteIndex + (lvl.memory ? 1 : 0)];
      if (n) AudioEngine.targetChirp(n.x, n.y, when);
    } else {
      AudioEngine.playerChirp(p.x, p.y, when, onGoal());
    }
  } else {
    // Alternate bell and player: T1 P T2 P T3 P …
    const n = state.targets.length;
    step = n > 1 ? 0.4 : 0.5;
    const slot = state.stepIndex % (2 * n);
    if (slot % 2 === 0) {
      const t = state.targets[slot / 2];
      AudioEngine.targetChirp(t.x, t.y, when);
    } else {
      AudioEngine.playerChirp(p.x, p.y, when, onGoal());
    }
  }

  // Soft plucks over the drone, consonant with its root, at random pans.
  if (lvl.distraction && Math.random() < 0.45) {
    const f = state.padRoot * pick([2, 3, 4, 5, 6]);
    AudioEngine.pluck(f, when + step / 2, Math.random(), 0.045, 0.8);
  }
  return step;
}

function schedulerTick() {
  if (state.screen !== 'playing' || document.hidden) return;
  while (state.nextStepTime < AudioEngine.now() + LOOKAHEAD) {
    const step = scheduleStep(state.nextStepTime);
    state.stepIndex++;
    state.nextStepTime += step;
  }
}

// ---------- game loop ----------

function onGoal() {
  const ex = (state.player.x - state.goal.x) / state.tol.x;
  const ey = (state.player.y - state.goal.y) / state.tol.y;
  return ex * ex + ey * ey < 1;
}

let lastFrame = performance.now();

function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  if (state.screen === 'playing') update(dt);
  render();
  requestAnimationFrame(frame);
}

function update(dt) {
  const lvl = state.lvl;
  const p = state.player;
  state.time += dt;

  let dx = 0, dy = 0;
  if (state.keys.ArrowLeft || state.keys.KeyA) dx -= 1;
  if (state.keys.ArrowRight || state.keys.KeyD) dx += 1;
  if (state.keys.ArrowUp || state.keys.KeyW) dy += 1;
  if (state.keys.ArrowDown || state.keys.KeyS) dy -= 1;
  dx += stick.vx;
  dy += stick.vy;
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }

  // Fine tuning: the beating level slows you near the right pitch.
  let speed = MOVE_SPEED;
  if (lvl.kind === 'beating' && Math.abs(p.y - state.goal.y) < 0.08) speed *= 0.4;

  const nx = p.x + dx * speed * dt;
  const ny = p.y + dy * speed * dt;
  const pushing = (nx < 0 && dx < 0) || (nx > 1 && dx > 0) || (ny < 0 && dy < 0) || (ny > 1 && dy > 0);
  p.x = clamp01(nx);
  p.y = clamp01(ny);
  if (pushing && state.time - state.lastBump > BUMP_GAP) {
    state.lastBump = state.time;
    AudioEngine.bump(p.x);
  }

  if (lvl.kind === 'moving' || lvl.kind === 'harmonise') {
    const t = state.targets[0];
    moveTarget(t, state.time);
    if (lvl.kind === 'harmonise') {
      state.goal.x = t.x;
      state.goal.y = t.y + state.harmonyOffset;
    }
  }

  // Sustained player voices track the player while they sound.
  const tNow = AudioEngine.now();
  state.live = state.live.filter(v => v.end > tNow);
  for (const v of state.live) v.set(p.x, p.y);

  const need = lvl.kind === 'melody' ? lvl.noteDwell : lvl.dwell;
  if (onGoal()) {
    state.dwell += dt;
    if (state.dwell >= need) {
      if (lvl.kind === 'melody') { if (noteLocked()) return; }
      else { win(); return; }
    }
  } else {
    state.dwell = Math.max(0, state.dwell - dt * 2);
  }

  state.peek = Math.max(0, state.peek - dt);
  let frac = Math.min(1, state.dwell / need);
  if (lvl.kind === 'melody') frac = (state.noteIndex + frac) / state.notes.length;
  lockbarEl.style.width = `${frac * 100}%`;

  if (state.endless) {
    const left = ENDLESS_LIMIT - state.time;
    if (left <= 0) { endlessOver(); return; }
    const secs = Math.ceil(left);
    if (secs !== state.shownSecs) { state.shownSecs = secs; updateLevelName(); }
    if (left <= 10 && !state.warned) { state.warned = true; announce('10 seconds left.'); }
  }
}

// Melody: the current note is locked. Returns true when the tune is done.
function noteLocked() {
  const n = state.notes[state.noteIndex];
  AudioEngine.ting(n.x, Math.min(AudioEngine.freqOf(n.y) * 4, 3200), AudioEngine.now() + 0.02);
  state.dwell = 0;
  if (state.noteIndex + 1 >= state.notes.length) { win(); return true; }
  state.noteIndex++;
  state.goal = state.notes[state.noteIndex];
  state.targets = [state.goal];
  announce(`Got it. Note ${state.noteIndex + 1} of ${state.notes.length}.`);
  return false;
}

function win() {
  const lvl = state.lvl;
  AudioEngine.stopPad();
  if (lvl.kind === 'melody') {
    // Replay the whole tune quickly, then the jingle on its last note.
    const gap = 0.16;
    playPhrase(gap, AudioEngine.now() + 0.1);
    const last = state.notes[state.notes.length - 1];
    AudioEngine.jingle(AudioEngine.freqOf(last.y), state.notes.length * gap + 0.15);
  } else {
    AudioEngine.jingle(AudioEngine.freqOf(state.goal.y));
  }
  lockbarEl.style.width = '100%';

  const secs = state.time.toFixed(1);
  const peeks = `${state.peeks} peek${state.peeks === 1 ? '' : 's'}`;

  if (state.endless) {
    state.screen = 'won';
    if (state.endless > progress.endlessBest) {
      progress.endlessBest = state.endless;
      saveProgress();
    }
    updateLevelName();
    statusEl.textContent = txt(`Round ${state.endless} cleared in ${secs} s. {Next} for round ${state.endless + 1}.`);
    hintEl.textContent = 'The map shows where everything was.';
    return;
  }

  const prev = progress.best[lvl.id];
  const isBest = prev === undefined || state.time < prev;
  if (isBest) progress.best[lvl.id] = +secs;
  progress.unlocked = Math.max(progress.unlocked, state.levelIndex + 1);
  saveProgress();

  const stats = `Matched in ${secs} s with ${peeks}${isBest && prev !== undefined ? ' — new best!' : '.'}`;
  if (state.levelIndex + 1 >= LEVELS.length) {
    state.screen = 'finished';
    statusEl.textContent = txt(`${stats} You finished every level! {Next} to start endless mode.`);
  } else {
    state.screen = 'won';
    statusEl.textContent = txt(`${stats} {Next} for “${LEVELS[state.levelIndex + 1].name}”.`);
  }
  hintEl.textContent = lvl.visible
    ? 'Nice — from the next level on, the map goes dark.'
    : lvl.kind === 'melody' ? 'The map shows the path of the tune.'
    : 'The map shows where everything was.';
}

function endlessOver() {
  state.screen = 'over';
  AudioEngine.stopPad();
  const cleared = state.endless - 1;
  updateLevelName();
  statusEl.textContent = txt(`Time’s up! You cleared ${cleared} round${cleared === 1 ? '' : 's'} (best ${progress.endlessBest}). {Next} to try again.`);
  hintEl.textContent = 'The map shows where the goal was.';
}

// A spoken-style description of where the goal is, for peeks: lets the
// game be played without sight.
function describe() {
  const lvl = state.lvl;
  const g = state.goal, p = state.player;
  const what = lvl.kind === 'harmonise' ? `The spot ${lvl.interval} the bell is`
    : lvl.kind === 'melody' ? 'The note is'
    : state.targets.length > 1 ? 'The centre is' : 'The bell is';
  const dx = g.x - p.x;
  const semis = (g.y - p.y) * 12 * Math.log2(AudioEngine.FMAX / AudioEngine.FMIN);
  const hClose = Math.abs(dx) < state.tol.x;
  const vClose = Math.abs(g.y - p.y) < state.tol.y;
  if (hClose && vClose) return 'You are right on it. Hold still.';
  const h = hClose ? 'straight ahead'
    : `${Math.abs(dx) > 0.35 ? 'far ' : ''}to your ${dx > 0 ? 'right' : 'left'}`;
  const n = Math.max(1, Math.round(Math.abs(semis)));
  const v = vClose ? 'at your pitch'
    : `${n} semitone${n === 1 ? '' : 's'} ${semis > 0 ? 'higher' : 'lower'}`;
  return `${what} ${h} and ${v}.`;
}

// ---------- rendering ----------
// The canvas backing store follows devicePixelRatio; drawing uses CSS pixels.

let W = 520, H = 520;

function resizeCanvas() {
  const size = canvas.clientWidth || 520;
  const dpr = window.devicePixelRatio || 1;
  W = H = size;
  canvas.width = canvas.height = Math.round(size * dpr);
  cx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const px = v => v * W;
const py = v => (1 - v) * H; // y=1 (high pitch) is the top of the canvas

function render() {
  cx2d.clearRect(0, 0, W, H);
  if (state.screen === 'title') return;

  const lvl = state.lvl;
  const ended = state.screen !== 'playing';
  const reveal = lvl.visible || ended;
  const alpha = reveal ? 1 : Math.min(1, state.peek / 0.5);

  drawGrid();

  if (alpha <= 0) {
    cx2d.fillStyle = 'rgba(107, 118, 136, 0.55)';
    cx2d.font = '15px sans-serif';
    cx2d.textAlign = 'center';
    const msg = isTouch()
      ? (lvl.memory ? 'listening mode — tap peek to replay the tune' : 'listening mode — tap peek')
      : (lvl.memory ? 'listening mode — press H to replay the tune' : 'listening mode — press H to peek');
    cx2d.fillText(msg, W / 2, H / 2);
    // The player's pulse ring is always visible, centred, revealing nothing.
    const pulse = 6 + 3 * Math.sin(performance.now() / 300);
    cx2d.strokeStyle = 'rgba(255, 159, 67, 0.25)';
    cx2d.lineWidth = 2;
    cx2d.beginPath();
    cx2d.arc(W / 2, H / 2 + 30, pulse + 14, 0, Math.PI * 2);
    cx2d.stroke();
    drawStick();
    return;
  }

  cx2d.save();
  cx2d.globalAlpha = alpha;

  if (lvl.kind === 'melody' && ended) {
    // The path of the whole tune.
    cx2d.strokeStyle = 'rgba(76, 201, 240, 0.5)';
    cx2d.lineWidth = 2;
    cx2d.beginPath();
    state.notes.forEach((n, i) => (i ? cx2d.lineTo : cx2d.moveTo).call(cx2d, px(n.x), py(n.y)));
    cx2d.stroke();
    state.notes.forEach(n => drawDot(n, '#4cc9f0', 7));
  } else {
    for (const t of state.targets) drawDot(t, '#4cc9f0', 10);
  }

  if (lvl.kind === 'harmonise') {
    const t = state.targets[0];
    cx2d.strokeStyle = 'rgba(123, 216, 143, 0.5)';
    cx2d.setLineDash([3, 4]);
    cx2d.lineWidth = 1.5;
    cx2d.beginPath();
    cx2d.moveTo(px(t.x), py(t.y));
    cx2d.lineTo(px(state.goal.x), py(state.goal.y));
    cx2d.stroke();
    cx2d.setLineDash([]);
  }

  if (state.targets.length > 1 || lvl.kind === 'harmonise') {
    cx2d.strokeStyle = '#7bd88f';
    cx2d.setLineDash([5, 5]);
    cx2d.lineWidth = 2;
    cx2d.beginPath();
    cx2d.ellipse(px(state.goal.x), py(state.goal.y), state.tol.x * W, state.tol.y * H, 0, 0, Math.PI * 2);
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
  drawStick();
}

// The touch joystick: a ring at the drag origin, a dot under the finger.
function drawStick() {
  if (stick.id === null) return;
  cx2d.save();
  cx2d.globalAlpha = 0.4;
  cx2d.strokeStyle = '#cdd6e4';
  cx2d.lineWidth = 2;
  cx2d.beginPath();
  cx2d.arc(stick.ox, stick.oy, STICK_RADIUS, 0, Math.PI * 2);
  cx2d.stroke();
  cx2d.fillStyle = '#cdd6e4';
  cx2d.beginPath();
  cx2d.arc(stick.sx, stick.sy, 10, 0, Math.PI * 2);
  cx2d.fill();
  cx2d.restore();
}

function drawGrid() {
  cx2d.strokeStyle = 'rgba(30, 40, 54, 0.8)';
  cx2d.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const vx = (i / 4) * W, vy = (i / 4) * H;
    cx2d.beginPath(); cx2d.moveTo(vx, 0); cx2d.lineTo(vx, H); cx2d.stroke();
    cx2d.beginPath(); cx2d.moveTo(0, vy); cx2d.lineTo(W, vy); cx2d.stroke();
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

// ---------- actions ----------

function actionPeek() {
  if (state.screen !== 'playing') return;
  state.peeks++;
  if (state.lvl.kind === 'melody' && state.lvl.memory) {
    playPhrase(PHRASE_GAP, Math.max(AudioEngine.now(), state.nextStepTime) + 0.05);
    announce('Replaying the tune.');
    return;
  }
  state.peek = PEEK_TIME;
  announce(describe());
}

function actionRestart() {
  if (state.endless) return; // no free retries against the clock
  if (['playing', 'won', 'finished'].includes(state.screen)) setupLevel(state.levelIndex);
}

function actionNext() {
  if (state.screen === 'won') {
    if (state.endless) nextEndlessRound();
    else setupLevel(state.levelIndex + 1);
  } else if (state.screen === 'finished' || state.screen === 'over') {
    startEndless();
  }
}

// ---------- menu ----------

let schedulerStarted = false;

async function launch(fn) {
  await AudioEngine.start();
  if (!schedulerStarted) {
    setInterval(schedulerTick, 25);
    schedulerStarted = true;
  }
  fn();
}

function buildMenu() {
  const n = LEVELS.length;
  const cont = Math.min(progress.unlocked, n - 1);
  startBtn.textContent = progress.unlocked === 0 ? '▶ start'
    : progress.unlocked >= n ? '▶ play from the start'
    : `▶ continue: ${LEVELS[cont].name}`;
  startBtn.onclick = () => launch(() => setupLevel(progress.unlocked >= n ? 0 : cont));

  pickerEl.innerHTML = '';
  LEVELS.forEach((lvl, i) => {
    const b = document.createElement('button');
    b.className = 'lvlBtn';
    b.textContent = i + 1;
    const best = progress.best[lvl.id];
    const label = `Level ${i + 1}: ${lvl.name}${best !== undefined ? `, best ${best} s` : ''}`;
    b.title = label;
    b.setAttribute('aria-label', label);
    if (best !== undefined) b.classList.add('done');
    if (i > progress.unlocked) b.disabled = true;
    b.onclick = () => launch(() => setupLevel(i));
    pickerEl.appendChild(b);
  });

  endlessBtn.hidden = progress.unlocked < n;
  endlessBtn.textContent = `∞ endless${progress.endlessBest ? ` · best ${progress.endlessBest}` : ''}`;
  endlessBtn.onclick = () => launch(startEndless);
}

function showMenu() {
  state.screen = 'title';
  state.endless = 0;
  state.live = [];
  AudioEngine.stopPad();
  releaseInput();
  buildMenu();
  overlay.classList.remove('hidden');
  levelNameEl.textContent = '—';
  hintEl.textContent = txt('Steer by ear: left–right is stereo position, up–down is pitch.');
  statusEl.textContent = '';
  lockbarEl.style.width = '0%';
  startBtn.focus();
}

// ---------- input ----------

const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyH', 'KeyR', 'KeyN', 'Enter', 'Escape',
]);

window.addEventListener('keydown', e => {
  // Leave browser shortcuts (Ctrl/Cmd+R, …) and the menu's buttons alone.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (state.screen === 'title' || !GAME_KEYS.has(e.code)) return;
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || (tag === 'BUTTON' && e.code === 'Enter')) return;
  e.preventDefault();
  AudioEngine.resume();
  state.keys[e.code] = true;
  if (e.repeat) return;

  if (e.code === 'KeyH') actionPeek();
  if (e.code === 'KeyR') actionRestart();
  if (e.code === 'KeyN' || e.code === 'Enter') actionNext();
  if (e.code === 'Escape') showMenu();
});

window.addEventListener('keyup', e => {
  if (GAME_KEYS.has(e.code)) state.keys[e.code] = false;
});

// Touch: dragging on the map is a virtual joystick. The ring is centred on
// the drag origin and trails the finger when it strays past the stick's
// radius, so reversing direction never needs a long drag back.

const STICK_RADIUS = 55; // CSS px
const stick = { id: null, ox: 0, oy: 0, sx: 0, sy: 0, vx: 0, vy: 0 };

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
}

canvas.addEventListener('pointerdown', e => {
  if (stick.id !== null || state.screen === 'title') return;
  e.preventDefault();
  const p = canvasPos(e);
  stick.id = e.pointerId;
  stick.ox = p.x; stick.oy = p.y;
  stick.sx = p.x; stick.sy = p.y;
  stick.vx = 0; stick.vy = 0;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== stick.id) return;
  const p = canvasPos(e);
  let dx = p.x - stick.ox, dy = p.y - stick.oy;
  const len = Math.hypot(dx, dy);
  if (len > STICK_RADIUS) {
    stick.ox = p.x - (dx / len) * STICK_RADIUS;
    stick.oy = p.y - (dy / len) * STICK_RADIUS;
    dx = (dx / len) * STICK_RADIUS;
    dy = (dy / len) * STICK_RADIUS;
  }
  stick.sx = p.x; stick.sy = p.y;
  stick.vx = dx / STICK_RADIUS;
  stick.vy = -dy / STICK_RADIUS; // screen y grows downward, pitch grows upward
});

function endStick(e) {
  if (e.pointerId !== stick.id) return;
  stick.id = null;
  stick.vx = 0; stick.vy = 0;
}
canvas.addEventListener('pointerup', endStick);
canvas.addEventListener('pointercancel', endStick);

// Drop held keys and the stick when focus or visibility is lost, so the
// player never keeps drifting.
function releaseInput() {
  state.keys = {};
  stick.id = null;
  stick.vx = 0; stick.vy = 0;
}
window.addEventListener('blur', releaseInput);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    releaseInput();
    AudioEngine.suspend();
  } else {
    AudioEngine.resume();
    // Start the sequence afresh instead of catching up in a burst.
    state.nextStepTime = AudioEngine.now() + 0.2;
    lastFrame = performance.now();
  }
});

// Any touch or click can revive audio after an interruption.
document.addEventListener('pointerdown', () => { if (AudioEngine.ready) AudioEngine.resume(); }, true);

document.getElementById('peekBtn').addEventListener('click', actionPeek);
document.getElementById('restartBtn').addEventListener('click', actionRestart);
document.getElementById('nextBtn').addEventListener('click', actionNext);
document.getElementById('menuBtn').addEventListener('click', () => { if (state.screen !== 'title') showMenu(); });

document.getElementById('vol').addEventListener('input', e => {
  AudioEngine.setVolume(parseFloat(e.target.value));
});

showMenu();
requestAnimationFrame(frame);
