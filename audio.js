// Web Audio synthesis engine for Chirp.
//
// The 2D sound image: x in [0,1] maps to stereo pan (-1..1),
// y in [0,1] maps exponentially to pitch (FMIN..FMAX), so equal vertical
// distances are equal musical intervals and the midpoint of two pitches
// is their geometric mean.

const AudioEngine = (() => {
  const FMIN = 200;
  const FMAX = 800;

  // Interaural time difference: besides level panning, the far ear hears the
  // sound up to ITD_MAX seconds later, which sharpens left–right on
  // headphones. Set USE_ITD to false to compare.
  const USE_ITD = true;
  const ITD_MAX = 0.0006;

  let ctx = null;
  let master = null;
  let padGain = null;
  let padOscs = [];

  function ensure() {
    if (ctx) return;
    // On iOS, Web Audio follows the ringer switch unless the session is
    // declared as playback (Safari 17+).
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) { /* not supported */ }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.8;
    // Gentle limiter so chirps, pad and jingle never clip when they overlap.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    master.connect(limiter);
    limiter.connect(ctx.destination);
  }

  async function start() {
    ensure();
    await ctx.resume();
  }

  // Resume after an interruption (call, app switch, screen lock). Safe to
  // call from any user gesture; a no-op when already running.
  function resume() {
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  function suspend() {
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
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

  // A spatialiser at position x: equal-power pan plus an interaural delay.
  // Returns the input node and a setter for moving it smoothly.
  function spatial(x) {
    const pan = ctx.createStereoPanner();
    let dl = null, dr = null;
    if (USE_ITD) {
      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createChannelMerger(2);
      dl = ctx.createDelay(0.01);
      dr = ctx.createDelay(0.01);
      pan.connect(split);
      split.connect(dl, 0);
      split.connect(dr, 1);
      dl.connect(merge, 0, 0);
      dr.connect(merge, 0, 1);
      merge.connect(master);
    } else {
      pan.connect(master);
    }
    const apply = (xx, smooth) => {
      const p = panOf(xx);
      const vals = [[pan.pan, p]];
      if (dl) vals.push([dl.delayTime, p > 0 ? p * ITD_MAX : 0],
                        [dr.delayTime, p < 0 ? -p * ITD_MAX : 0]);
      for (const [param, v] of vals) {
        if (smooth) param.setTargetAtTime(v, now(), 0.03);
        else param.value = v;
      }
    };
    apply(x, false);
    return { input: pan, set: xx => apply(xx, true) };
  }

  const out = x => spatial(x).input;

  // Both voices share the same pitch contour: a quick glide DOWN from
  // SWEEP_FROM × f into f, so the only difference is timbre — the ear
  // compares like with like and pitch matching is fair.
  const SWEEP_FROM = 1.3;
  const SWEEP_TIME = 0.09;

  // The player's voice: a buzzy filtered sawtooth chirp.
  function playerChirp(x, y, when, locked) {
    const f = freqOf(y);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f * SWEEP_FROM, when);
    osc.frequency.exponentialRampToValueAtTime(f, when + SWEEP_TIME);

    // Filter tracks the glide so the brightness stays constant.
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(f * SWEEP_FROM * 3, when);
    filt.frequency.exponentialRampToValueAtTime(f * 3, when + SWEEP_TIME);
    filt.Q.value = 1.5;

    const g = env(when, 0.22, 0.008, 0.45);
    osc.connect(filt);
    filt.connect(g);
    g.connect(out(x));
    osc.start(when);
    osc.stop(when + 0.5);

    // Sparkle when locked onto the goal, so the player hears the match take.
    if (locked) ting(x, Math.min(f * 4, 3200), when + 0.1);
  }

  // A target's voice: a soft sine bell with a faint upper partial.
  function targetChirp(x, y, when) {
    const f = freqOf(y);
    const dest = out(x);

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(f * SWEEP_FROM, when);
    o1.frequency.exponentialRampToValueAtTime(f, when + SWEEP_TIME);
    const g1 = env(when, 0.3, 0.008, 0.45);
    o1.connect(g1);
    g1.connect(dest);
    o1.start(when);
    o1.stop(when + 0.5);

    // Faint upper partial gives the bell its shimmer.
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(f * 2 * SWEEP_FROM, when);
    o2.frequency.exponentialRampToValueAtTime(f * 2, when + SWEEP_TIME);
    const g2 = env(when, 0.06, 0.008, 0.25);
    o2.connect(g2);
    g2.connect(dest);
    o2.start(when);
    o2.stop(when + 0.3);
  }

  // A sustained, glide-free tone for the beating level. Returns a handle
  // whose set(x, y) moves the voice smoothly while it sounds, so two of them
  // played together beat audibly as their pitches converge.
  // voice: 'bell' (pure sine) or 'player' (softly filtered triangle).
  function sustain(x, y, when, dur, voice) {
    const sp = spatial(x);
    const osc = ctx.createOscillator();
    osc.frequency.value = freqOf(y);
    const g = ctx.createGain();
    const peak = voice === 'bell' ? 0.16 : 0.12;
    const fade = 0.12;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + fade);
    g.gain.setValueAtTime(peak, when + dur - fade);
    g.gain.linearRampToValueAtTime(0, when + dur);

    let filt = null;
    if (voice === 'bell') {
      osc.type = 'sine';
      osc.connect(g);
    } else {
      osc.type = 'triangle';
      filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = freqOf(y) * 2.5;
      osc.connect(filt);
      filt.connect(g);
    }
    g.connect(sp.input);
    osc.start(when);
    osc.stop(when + dur + 0.05);

    return {
      end: when + dur,
      set(xx, yy) {
        const f = freqOf(yy);
        osc.frequency.setTargetAtTime(f, now(), 0.02);
        if (filt) filt.frequency.setTargetAtTime(f * 2.5, now(), 0.02);
        sp.set(xx);
      },
    };
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

  // A short low thud when the player pushes against the edge of the field.
  function bump(x) {
    const when = now() + 0.01;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, when);
    o.frequency.exponentialRampToValueAtTime(55, when + 0.12);
    const g = env(when, 0.35, 0.004, 0.16);
    o.connect(g);
    g.connect(out(x));
    o.start(when);
    o.stop(when + 0.2);
  }

  // Level-complete arpeggio rooted on the goal pitch, optionally delayed.
  function jingle(f, delay = 0) {
    const t = now() + 0.05 + delay;
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
    start, resume, suspend, now, freqOf, yOfFreq, panOf, setVolume,
    playerChirp, targetChirp, sustain, pluck, ting, bump, jingle,
    startPad, stopPad,
    get ready() { return !!ctx; },
  };
})();
