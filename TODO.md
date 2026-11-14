# TODO

Improvements from a code review of commit `d9add88`. Each item is meant to be
implementable on its own; do them in order within a section, and keep the game
dependency-free (plain HTML/CSS/JS, no build step). Tick the box when done and
update `README.md` if behaviour or controls change.

Coordinates: the field is `x, y ∈ [0, 1]`; `x` is pan, `y` is pitch on a
two-octave exponential axis (200–800 Hz), so `0.1` in `y` is 2.4 semitones.

## 1. Bugs

- [ ] **Modifier keys trigger game actions.** `Ctrl/Cmd+R` restarts the level
  instead of reloading the page, because the `keydown` handler in `game.js`
  calls `preventDefault()` for every code in `GAME_KEYS`.
  *Fix:* return early when `e.ctrlKey || e.metaKey || e.altKey`.
- [ ] **Enter/Space cannot activate the start button.** The same global
  `preventDefault()` swallows them. *Fix:* don't intercept keys while
  `state.screen === 'title'`, and don't intercept Enter/Space when
  `e.target` is a `button` or `input`. Remove `Space` from `GAME_KEYS` if it
  stays unused.
- [ ] **Keys stick when the window loses focus.** Holding an arrow key and
  switching window leaves `state.keys[...]` true, so the player drifts.
  *Fix:* clear `state.keys` (and end the touch stick) on `window` `blur` and
  on `visibilitychange` to hidden.
- [ ] **Audio is not resumed after an interruption.** After a phone call, app
  switch or screen lock the `AudioContext` can stay suspended and the game is
  silent with no way to recover. *Fix:* expose `AudioEngine.resume()`; call it
  on `visibilitychange` to visible and on the next `pointerdown`/`keydown`
  when `ctx.state !== 'running'`.
- [ ] **Sequencer runs while the tab is hidden.** Background timer throttling
  makes `schedulerTick` schedule late chirps in bursts. *Fix:* pause while
  `document.hidden`; on return set
  `state.nextStepTime = AudioEngine.now() + 0.2` instead of catching up.
  Also stop `state.time` and dwell from advancing while hidden.
- [ ] **Diagonal movement is ~41% faster.** In `frame()`, normalise `(dx, dy)`
  when its length exceeds 1 before applying `MOVE_SPEED`.

## 2. Gameplay

- [ ] **Hear your own chirp more often.** The cycle is "every target, then the
  player", so with three bells the player chirps once every 2 s while moving
  0.28 units/s. Change the sequence in `schedulerTick` to alternate
  target/player (`T1 P T2 P T3 P`). Single-target levels are unchanged.
  Keep `STEP` at 0.5 s unless it feels sluggish; consider 0.4 s for
  multi-target levels.
- [ ] **Elliptical lock zone.** Replace the circular `dist(player, goal) <
  threshold` test (used in both `frame()` and `schedulerTick()`) with a single
  helper `onGoal(lvl)` using separate tolerances: `tolX` (pan) and `tolY`
  (pitch). Starting values: `tolY = 0.045` (about ±1 semitone), `tolX = 0.14`.
  Per-level overrides stay possible in `LEVELS`. Draw the goal outline in
  `render()` as an ellipse to match.
- [ ] **Make the midpoints consonant.** Currently two bells are a fifth apart
  (midpoint = neutral third, 351 cents) and three bells are a major triad
  (centre is ~23 cents below the major-third bell). In `makeTargets`:
  - two bells: ratios `[1, 9/4]` (midpoint is a perfect fifth from each) or
    `[1, 16/9]` (midpoint is a fourth); pick one at random.
  - three bells: ratios `[1, 3/2, 9/4]` (centre pitch equals the middle bell,
    but pan differs).
  Adjust the `fBase` range so everything stays inside 200–800 Hz with the
  existing 1.15 margin, and fix the level hints and README level descriptions.
- [ ] **Wall bump cue.** When the player is clamped at `x` or `y` = 0 or 1 and
  still pushing, play a short low thud (rate-limited to once per ~0.4 s),
  panned at the player's `x`. Add `AudioEngine.bump(x)`.
- [ ] **Four-bell level.** Add a level with four targets (from `notes.md`).
  Use ratios `[1, 9/8, 2, 9/4]` (centre pitch is a perfect fifth above the
  lowest bell) and place it after "Triangulate".
  `pickSpreadXs` needs a smaller `minSep` for `k = 4` (try 0.18).
- [ ] **Progress and results.** Persist the highest unlocked level in
  `localStorage` (wrapped in try/catch) and let the title overlay offer
  "continue" and a level picker. On win, show time taken and number of peeks.
  Store best time per level.
- [ ] **Endless mode.** After the last level, offer an endless mode: random
  level type each round, lock tolerances shrinking by ~7% per round down to a
  floor, round counter shown in `#levelName`.

## 3. Mobile / PWA

- [ ] **Touch-aware text.** Hints, the "press H to peek" canvas text and the
  "Press N" status lines mention keys on touch devices. Detect touch with the
  same media query the CSS uses (`(hover: none), (pointer: coarse)`) and swap
  wording ("drag to move", "tap peek", "tap next").
- [ ] **Sharp canvas.** The canvas is fixed at 520×520. Size the backing store
  to `clientWidth * devicePixelRatio`, scale the context, and recompute on
  `resize`. `W`/`H`, `px()`/`py()` and `STICK_RADIUS` must use CSS pixels.
- [ ] **Offline support.** Add `sw.js` with a cache-first strategy for the
  app shell (`index.html`, `style.css`, `audio.js`, `game.js`, manifest,
  icons) and a versioned cache name; register it from `index.html`.
- [ ] **iPhone silent switch.** Web Audio is muted when the ringer switch is
  off. In `AudioEngine.start()`, if `navigator.audioSession` exists set
  `navigator.audioSession.type = 'playback'`. Verify on a real device; if it
  does not help, add a one-line note under the start button instead.
- [ ] **Viewport height.** Use `min-height: 100dvh` (with the `100vh`
  fallback) on `body`.

## 4. Accessibility

- [ ] Add `aria-live="polite"` to `#hint` and `aria-live="assertive"` to
  `#status`; give the canvas `role="img"` and an `aria-label`; make sure
  every action is reachable by keyboard and has a visible focus style. The
  game should be fully playable with a screen reader and no sight.

## 5. Audio polish

- [ ] **Interaural time difference.** Panning is level-only. In
  `AudioEngine.out(x)`, add a per-ear `DelayNode` (via a channel
  splitter/merger) delaying the far ear by up to ~0.6 ms proportional to pan,
  so left–right is clearer on headphones. Keep it behind a constant so it can
  be switched off for comparison.
- [ ] **Limiter.** Put a `DynamicsCompressorNode` with gentle settings between
  `master` and `ctx.destination` to avoid clipping when chirps, pad and
  jingle overlap.

## 6. New level types

Add these after the existing levels (before endless mode, which should then
include them). Each needs a `LEVELS` entry with a flag, a hint, a README
entry, and touch-aware wording. Implement the bugs and gameplay sections
first; these build on `onGoal()` and the alternating sequencer.

- [ ] **Beating (tune by ear).** Flag `beating: true`. One target, map dark.
  Instead of alternating glide chirps, the bell and the player sound *at the
  same time* as sustained tones with no pitch glide (about 1.6 s on, 0.4 s
  off, repeating), so the player hears beats that slow down as the pitches
  converge and disappear on the spot.
  - Add `AudioEngine.sustain(x, y, when, dur, voice)` with soft attack and
    release; use a sine for the bell and a lightly filtered triangle for the
    player so beats are clear. The player's tone must follow movement while
    it sounds: keep a handle to the live oscillator and panner and update
    them with `setTargetAtTime` each frame.
  - Pan still has to match, but give this level a tight pitch tolerance
    (`tolY ≈ 0.012`, about a quarter semitone) and a loose pan tolerance
    (`tolX ≈ 0.2`); pitch is the point of the level.
  - Slow movement helps fine tuning: while this level is active, scale
    `MOVE_SPEED` down to ~40% when the player is within `0.08` of the goal
    in `y`.
- [ ] **Melody (follow the tune).** Flag `melody: true`. One bell, map dark.
  The bell steps through a short phrase of 5–6 notes; the player must lock
  onto each note in turn.
  - Generate the phrase in `makeTargets`: pitches from a major pentatonic
    scale on a random root (ratios `1, 9/8, 5/4, 3/2, 5/3, 2`), steps of at
    most two scale degrees, each note with its own pan (`x` moves by
    0.15–0.3 between notes, staying in `[0.1, 0.9]`).
  - The bell repeats the current note (normal target/player alternation)
    until the player holds the lock for a short dwell (~0.6 s); then a soft
    confirmation `ting`, and the bell moves to the next note. The lock bar
    shows progress through the whole phrase, not the single dwell.
  - On win, replay the full phrase quickly as the jingle, and the revealed
    map draws the path as connected dots.
  - Second variant, `melody: true, memory: true`: the bell plays the whole
    phrase once up front, then stays one note *ahead* — it sounds note
    `n + 1` while the player must lock onto note `n`. Peek replays the
    phrase instead of showing the map.
- [ ] **Harmonise (hold an interval).** Flag `harmonise: 3/2`. One moving
  bell (reuse `moveTarget`), map dark. The goal is not the bell but the point
  with the same pan and a pitch a perfect fifth above it.
  - Set `state.goal` each frame to `{ x: bell.x, y: bell.y +
    AudioEngine.yOfFreq(AudioEngine.FMIN * ratio) }`. Constrain the bell's
    orbit (`cy`, `ry`) so the goal always stays inside `[0.05, 0.95]`.
  - Use slower orbit speeds than "Moving Target" (`wx`, `wy` in
    `0.12–0.2`) and dwell 2.0 s. Pitch tolerance `tolY ≈ 0.03`.
  - Play bell and player chirps *together* on the same step rather than
    alternating, so the interval is heard as a chord; keep the glide.
  - The peek map shows the bell, and the goal ellipse above it.
  - Later variants can pass a different ratio (`4/3`, `5/4`, or `2/3` for a
    fifth below); the hint text must name the interval.

## Checks for every change

- Open `index.html` via `python3 -m http.server` and play all levels with
  keyboard and with touch emulation.
- No console errors; audio starts only after the start button.
- README level list, controls table and file list still match the code.
