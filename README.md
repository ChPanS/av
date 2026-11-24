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

## Editing and exporting

- Toggle **Strudel** and **Shader** independently. Opening both takes the editors full-width, and closing both leaves the preview. Use **Focus** to expand a single editor. Drag a divider to resize either split. GLSL errors highlight the corresponding line when the compiler reports a source location.
- Set **From** and **To** to select an inclusive range of cycles. Drag the timeline to jump, enable **Loop range** to rehearse it, or save the range as a named section. The scale uses the pattern's `// loop: N` (24 cycles by default).
- Open **Code overlay & video** to show Strudel, GLSL or both, with a selected excerpt or the full source. Choose the corner, text size and backdrop opacity. Long lines wrap at the chosen size, and the overlay shows how many rows lie outside the frame. An empty selection shows the first 16 lines. Strudel note highlights appear on the overlay while playing.
- Open **.vis() monitor** to inspect the active signals, their recent values, and the tag and source line that produced them. Use **Detach** to move the panel around the window, then **Dock** to return it.
- Apply changes with **play / update**, then choose **export range**. The video uses the preview's aspect ratio, the selected resolution and frame rate, and includes the code overlay and Strudel audio. MP4 is preferred; WebM is also available. The browser records in real time, with a short audio pre-roll and reconstructed visual state at the start of the range.

## Project Structure
```
src/
  main.js            Entry point: tabs, Play/Stop, fullscreen, share, URL sharing
  audio.js           Strudel wrapper: repl, custom output + visual callback, cps, audio tap
  bridge.js          CORE: maps pattern events → shader uniforms. Your logic lives here.
  renderer.js        WebGL2: shader compilation, render loop, uniforms (engine, don't touch)
  recorder.js        Canvas + audio recording to .webm, length = even number of cycles
  editor.js          CodeMirror (pattern + shader), uniform autocomplete
  highlight.js       Highlighting of currently playing notes in the pattern editor
  mp4.js             webm → mp4 conversion via ffmpeg.wasm (lazy-loaded from CDN)
  scenes/default.js  Default scene { pattern, shader }
```
The engine modules (audio, renderer, recorder, editor) rarely need
modification. Creative work happens in scenes/ and bridge.js.

## Tagging Sounds for Visuals — .vis()

No name-guessing. Every channel is an explicit tag on a track:
`.vis("<prefix><Name>")` — prefix (lowercase) picks the channel *type* only,
it does NOT appear in the uniform name. Name (capitalized, your choice) is
what shows up after `u`: `.vis("dKick")` just gives you `uKick` in the shader.

| Prefix | Tracks | Uniform for `.vis("xName")` |
|---|---|---|
| `d` | level only (drums/hits), fast impulse decay | `uniform float uName;` |
| `i` | velocity (decays) + pitch (holds) | `uniform AVInstrument uName;` → `.vel` / `.pitch` |
| `p` | pitch only, holds last note | `uniform float uName;` |

```js
s("bd*4").vis("dKick")                       // → uKick
note("<c2 g1>").s("sawtooth").vis("iBass")    // → uBass.vel, uBass.pitch (struct)
note("c5 e5").s("triangle").vis("pArp")       // → uArp
```

`i`-tagged channels are ONE struct uniform (WebGL2 struct uniforms, native
support) with `.vel`/`.pitch` fields — not two separate names. Two different
tags resolving to the same Name (e.g. `dPad` and `iPad`, both → `uPad`)
collide; the second one is skipped with a warning. Names of built-in uniforms
(`uTime`, `uPitch`, `uHue`, `uEnergy`, `uBeat`, `uLoop`, `uBeatFrac`, `uResolution`)
are reserved — a tag like `.vis("dTime")` is skipped with a warning.

The shader editor autocompletes: type `uLe` to see `uLead` from the tags
currently in the pattern editor, type `uLead.` to see `.vel`/`.pitch` — live,
scanned from the pattern text as you type, no need to press Play first.

Decay speed is NOT a per-instrument-name lookup table — if the event has a
Strudel ADSR control (`.release(sec)` / `.decay(sec)`), that real envelope
time is used for the visual decay too. Otherwise a per-type default applies
(`d` fast, `i` smooth). Pitch channels never decay.

Tags must appear as literal strings in the pattern source — uniforms are
collected via a scan of the pattern text *before* the shader compiles, so a
shader referencing a uniform with no matching `.vis("...")` tag in the
pattern will fail to compile (undeclared identifier) — this is intentional:
pattern and shader must literally agree on tags. Unrecognized prefixes,
malformed tags, or name collisions don't crash the pattern; they log a
warning (debug panel) and produce no uniform.

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