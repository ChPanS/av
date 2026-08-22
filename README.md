# av · livecoding

An audiovisual livecoding platform where **Strudel** drives a **WebGL shader** — not
by audio volume, but by pattern events (kick, snare, note triggers). A default scene
loads from a file, and both the pattern and shader editors are available directly on the page.

## Running Locally

```bash
npm install
npm run dev
```

Open http://localhost:5173 and press play (the first click initializes audio —
a browser requirement). Edit the code in either editor and press play again —
changes take effect immediately.

## Project Structure
```
src/
  main.js            Entry point: tabs, Play/Stop, fullscreen, share, URL sharing
  audio.js           Strudel wrapper: repl, custom output + visual callback, cps, audio tap
  bridge.js          CORE: maps pattern events → shader uniforms. Your logic lives here.
  renderer.js        WebGL2: shader compilation, render loop, uniforms (engine, don't touch)
  recorder.js        Canvas + audio recording to .webm, length = even number of cycles
  editor.js          CodeMirror (pattern + shader)
  scenes/default.js  Default scene { pattern, shader }
```
The engine modules (audio, renderer, recorder, editor) rarely need
modification. Creative work happens in scenes/ and bridge.js.

## Tagging Sounds for Visuals — .vis()

No name-guessing. Every channel is an explicit tag on a track:
`.vis("<prefix><Name>")` — prefix (lowercase) picks the channel *type*, Name
(capitalized, your choice) becomes part of the uniform name. Nothing to
register anywhere: `.vis("dKick")` just gives you `uDKick` in the shader.

| Prefix | Tracks | Uniform(s) for `.vis("xName")` |
|---|---|---|
| `d` | level only (drums/hits), fast impulse decay | one: `uxName` |
| `i` | velocity (decays) + pitch (holds) | two: `uxNameVel`, `uxNamePitch` |
| `p` | pitch only, holds last note | one: `uxName` |

```js
s("bd*4").vis("dKick")                       // → uDKick
note("<c2 g1>").s("sawtooth").vis("iBass")    // → uIBassVel, uIBassPitch
note("c5 e5").s("triangle").vis("pArp")       // → uPArp
```

Decay speed is NOT a per-instrument-name lookup table — if the event has a
Strudel ADSR control (`.release(sec)` / `.decay(sec)`), that real envelope
time is used for the visual decay too. Otherwise a per-type default applies
(`d` fast, `i` smooth). Pitch channels never decay.

Tags must appear as literal strings in the pattern source — uniforms are
collected via a scan of the pattern text *before* the shader compiles, so a
shader referencing a uniform with no matching `.vis("...")` tag in the
pattern will fail to compile (undeclared identifier) — this is intentional:
pattern and shader must literally agree on tags. Unrecognized prefixes or
malformed tags don't crash the pattern; they log a warning (debug panel) and
produce no uniform.

Full details, defaults and how to add a new prefix type: see `GUIDE.md`.

## Deployment
```
npm run build      # Outputs to dist/ (static files)
```
Deploy dist/ to any static hosting: Vercel, Netlify, Cloudflare Pages, or
GitHub Pages. No backend required.

## ⚠️ License
Strudel is distributed under AGPL-3.0. Accordingly, this project is
licensed under AGPL-3.0-or-later. See: https://www.gnu.org/licenses/agpl-3.0