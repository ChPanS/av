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

## Adding Custom Uniforms
```
To add more channels (e.g., a dedicated uniform for melody):
Add the field to the uniforms object in bridge.js
Define its decay behavior
Route it in handleHap
Declare the uniform in the shader wrapper in renderer.js
```
## Sound Grouping for Visuals — .vis()

The engine auto-detects sound types by name (bd → kick, hh → hat,
synths → pad). For precise control (especially with custom samples), tag
tracks explicitly: s("mysample").vis("kick")

Drum groups: kick, snare, clap, hat, oh
Instrument groups: pad, atmosphere, key, lead, bass, arp, fx, vox

Instrument groups expose two uniforms: u…Vel (velocity, smoothly decays) and
u…Pitch (note pitch). An explicit tag always overrides auto-detection.

## Deployment
```
npm run build      # Outputs to dist/ (static files)
```
Deploy dist/ to any static hosting: Vercel, Netlify, Cloudflare Pages, or
GitHub Pages. No backend required.

## ⚠️ License
Strudel is distributed under AGPL-3.0. Accordingly, this project is
licensed under AGPL-3.0-or-later. See: https://www.gnu.org/licenses/agpl-3.0