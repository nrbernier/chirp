// Web Audio synthesis engine for Chirp.
//
// The 2D sound image: x in [0,1] maps to stereo pan (-1..1),
// y in [0,1] maps exponentially to pitch (FMIN..FMAX), so equal vertical
// distances are equal musical intervals and the midpoint of two pitches
// is their geometric mean.

const AudioEngine = (() => {
  const FMIN = 200;
  const FMAX = 800;

  let ctx = null;
  let master = null;
  let padGain = null;
  let padOscs = [];

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
  }

  async function start() {
    ensure();
    await ctx.resume();
  }

  const now = () => (ctx ? ctx.currentTime : 0);
  const freqOf = y => FMIN * Math.pow(FMAX / FMIN, y);
  const yOfFreq = f => Math.log(f / FMIN) / Math.log(FMAX / FMIN);
  const panOf = x => Math.max(-1, Math.min(1, x * 2 - 1));

  function setVolume(v) {
    if (master) master.gain.setTargetAtTime(v, now(), 0.02);
  }

  // A gain node with a percussive envelope: quick attack, exponential decay.
  function env(when, peak, attack, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    return g;
  }

  function out(x) {
    const pan = ctx.createStereoPanner();
    pan.pan.value = panOf(x);
    pan.connect(master);
    return pan;
  }

  // The player's voice: a buzzy sawtooth chirp that sweeps UP into its pitch.
  function playerChirp(x, y, when, locked) {
    const f = freqOf(y);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f * 0.7, when);
    osc.frequency.exponentialRampToValueAtTime(f, when + 0.06);

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(f * 3, when);
    filt.Q.value = 1.5;

    const g = env(when, 0.22, 0.01, 0.3);
    osc.connect(filt);
    filt.connect(g);
    g.connect(out(x));
    osc.start(when);
    osc.stop(when + 0.35);

    // Sparkle when locked onto the goal, so the player hears the match take.
    if (locked) ting(x, Math.min(f * 4, 3200), when + 0.1);
  }

  // A target's voice: a soft bell that sweeps DOWN into its pitch.
  function targetChirp(x, y, when) {
    const f = freqOf(y);
    const dest = out(x);

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(f * 1.3, when);
    o1.frequency.exponentialRampToValueAtTime(f, when + 0.09);
    const g1 = env(when, 0.3, 0.008, 0.45);
    o1.connect(g1);
    g1.connect(dest);
    o1.start(when);
    o1.stop(when + 0.5);

    // Faint upper partial gives the bell its shimmer.
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(f * 2.6, when);
    o2.frequency.exponentialRampToValueAtTime(f * 2, when + 0.09);
    const g2 = env(when, 0.06, 0.008, 0.25);
    o2.connect(g2);
    g2.connect(dest);
    o2.start(when);
    o2.stop(when + 0.3);
  }

  function ting(x, f, when) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = env(when, 0.05, 0.005, 0.12);
    o.connect(g);
    g.connect(out(x));
    o.start(when);
    o.stop(when + 0.15);
  }

  function pluck(f, when, x = 0.5, peak = 0.08, dur = 0.5, type = 'sine') {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = env(when, peak, 0.01, dur);
    o.connect(g);
    g.connect(out(x));
    o.start(when);
    o.stop(when + dur + 0.1);
  }

  // Level-complete arpeggio rooted on the goal pitch.
  function jingle(f) {
    const t = now() + 0.05;
    [1, 5 / 4, 3 / 2, 2].forEach((r, i) =>
      pluck(f * r, t + i * 0.13, 0.5, 0.18, 0.6, 'triangle'));
    pluck(f * 2, t + 4 * 0.13, 0.5, 0.15, 1.2, 'sine');
  }

  // Distraction layer: a slow detuned drone whose voices wander across the
  // stereo field. Plucked notes on top are scheduled by the game sequencer.
  function startPad(rootFreq) {
    stopPad();
    padGain = ctx.createGain();
    padGain.gain.setValueAtTime(0.0001, now());
    padGain.gain.linearRampToValueAtTime(0.55, now() + 2.5);
    padGain.connect(master);

    [1, 1.5, 2, 2.02].forEach(r => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = rootFreq * r;
      const g = ctx.createGain();
      g.gain.value = 0.035;
      const p = ctx.createStereoPanner();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.1;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.8;
      lfo.connect(lfoG);
      lfoG.connect(p.pan);
      o.connect(g);
      g.connect(p);
      p.connect(padGain);
      o.start();
      lfo.start();
      padOscs.push(o, lfo);
    });
  }

  function stopPad() {
    padOscs.forEach(o => { try { o.stop(); } catch (e) { /* already stopped */ } });
    padOscs = [];
    if (padGain) {
      padGain.disconnect();
      padGain = null;
    }
  }

  return {
    FMIN, FMAX,
    start, now, freqOf, yOfFreq, panOf, setVolume,
    playerChirp, targetChirp, pluck, jingle, startPad, stopPad,
    get ready() { return !!ctx; },
  };
})();
