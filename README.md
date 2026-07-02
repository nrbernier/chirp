# Chirp — navigate by sound

A game where you navigate purely with your ears. The playing field is a 2D
*sound image*: **left–right is the stereo position, up–down is pitch**
(200–800 Hz, exponential, so vertical distance is musical interval).

You are a **buzzy sawtooth chirp** that sweeps *up* into its pitch. Targets are
**soft bell chirps** that sweep *down*. They take turns in a steady sequence —
compare them and steer with the arrow keys until they match. Hold the match
briefly to lock in (the green bar shows lock progress, and your chirp gains a
sparkle when you're on the spot).

## Run it

Open `index.html` in any modern browser (Chrome/Firefox/Safari), or:

```sh
python3 -m http.server
# then visit http://localhost:8000
```

**Headphones strongly recommended** — the left–right axis is stereo panning.

## Controls

| Key | Action |
|---|---|
| Arrow keys / WASD | move (left–right = pan, up–down = pitch) |
| H | peek at the map for 2 seconds |
| R | restart the level (new random target) |
| N / Enter | next level after a match |

On a phone or tablet, drag anywhere on the map to steer (a virtual joystick
appears under your finger), and use the on-screen buttons for peek, restart
and next.

## Levels

1. **Tutorial** — one target, map visible.
2. **Blind Match** — same, map dark.
3. **Between Two** — two bells a perfect fifth apart; land exactly between
   them. The pitch midpoint is the geometric mean, so the lock point sounds
   consonant with both.
4. **Triangulate** — three bells forming a major triad; find their centre.
5. **Through the Haze** — two bells under a drifting ambient pad (tuned
   consonant with the bells) that blurs the picture.
6. **Moving Target** — the bell drifts on a slow orbit; chase it and hold on.

## Files

- `index.html` / `style.css` — page and layout
- `audio.js` — Web Audio synthesis (chirps, jingle, distraction pad)
- `game.js` — levels, chirp sequencer, input, canvas rendering
