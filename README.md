# Chirp — navigate by sound

**[Play it here](https://nrbernier.github.io/chirp/)**

A game where you navigate purely with your ears. The playing field is a 2D
*sound image*: **left–right is the stereo position, up–down is pitch**
(200–800 Hz, exponential, so vertical distance is musical interval).

You are a **buzzy sawtooth chirp**; targets are **soft bell chirps**. Both glide
the same way into their pitch, so only the tone differs. They alternate in a
steady sequence — compare them and steer until they match. Hold the match
briefly to lock in (the green bar shows lock progress, and your chirp gains a
sparkle when you're on the spot). Pushing against the edge of the field makes
a soft thud.

## Run it

Open `index.html` in any modern browser (Chrome/Firefox/Safari), or:

```sh
python3 -m http.server
# then visit http://localhost:8000
```

**Headphones strongly recommended** — the left–right axis is stereo panning
plus a small interaural delay.

The game works offline once loaded (service worker in `sw.js`). **When you
change any file, bump `CACHE` in `sw.js`**, or installed copies keep serving
the old version.

## Controls

| Key | Action |
|---|---|
| Arrow keys / WASD | move (left–right = pan, up–down = pitch) |
| H | peek: show the map for 2 seconds and say where the goal is (replays the tune in "Tune from Memory") |
| R | restart the level (new random layout; not in endless mode) |
| N / Enter | next level after a match |
| Esc | back to the menu |

On a phone or tablet, drag anywhere on the map to steer (a virtual joystick
appears under your finger), and use the on-screen buttons for peek, restart,
next and menu.

Peeks are also announced as text for screen readers ("The bell is to your
left and 3 semitones higher"), so the game can be played without sight.

## Levels

Progress and best times are saved in the browser; the menu lets you continue
or replay any unlocked level.

1. **Tutorial** — one target, map visible.
2. **Blind Match** — same, map dark.
3. **Between Two** — two bells a ninth (or a minor seventh) apart; land
   exactly between them. The midpoint is a fifth (or a fourth) from each, so
   the lock point sounds consonant with both.
4. **Triangulate** — three bells stacked in fifths; find their centre.
5. **Four Bells** — four bells whose centre is a fifth above the lowest.
6. **Through the Haze** — two bells under a drifting ambient pad (tuned
   consonant with the bells) that blurs the picture.
7. **Moving Target** — the bell drifts on a slow orbit; chase it and hold on.
8. **Beating** — bell and player sound together as sustained tones. Off pitch
   they beat; tune until the beating stops. Movement slows near the pitch.
9. **Follow the Tune** — the bell walks a short pentatonic tune; lock onto
   each note in turn.
10. **Tune from Memory** — hear the whole tune, then the bell stays one note
    ahead and you play each note from memory.
11. **Harmonise** — a drifting bell; hold its pan a perfect fifth above it.

Finishing every level unlocks **endless mode**: a random level type each
round, tolerances shrinking each round, 60 seconds per round.

The lock zone is an ellipse: about ±1 semitone in pitch and wider in pan
(tighter in Beating and Harmonise).

## Files

- `index.html` / `style.css` — page, menu and layout
- `audio.js` — Web Audio synthesis (chirps, sustained tones, jingle, pad,
  limiter, interaural delay)
- `game.js` — levels, chirp sequencer, input, progress, canvas rendering
- `sw.js` — offline cache
- `TODO.md` — improvement list
