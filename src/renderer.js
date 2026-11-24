// WebGL2-рендерер фрагментного шейдера на полный экран (два треугольника).
// Пользователь пишет только тело mainImage(); мы оборачиваем его в полный
// шейдер с объявленными юниформами.

import { uniforms, decayUniforms, shaderUniformDecls } from './bridge.js';

import { drawAscii } from './ascii.js';

let gl, canvas, surface, context, vao;
let programs = new Map();
let sceneLayers = () => [];
let startTime = performance.now();
let lastFrameTime = performance.now();
let rafId = null;
let frameObserver;
let clockProvider = null; // () => { beat, loop, frac } | null


// источник часов лупа (ставит main.js: () => getClock())
export function setClockProvider(fn) {
  clockProvider = fn;
}

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

function uniformDecls() {
  // объявления берём у bridge.js (он знает, какие ключи — скаляры, а какие —
  // поля struct-а вида "uPad.vel"/"uPad.pitch" и генерирует валидный GLSL).
  // uResolution — единственный юниформ, не завязанный на теги, объявляем тут.
  return 'uniform vec2  uResolution;\n' + shaderUniformDecls();
}

function fragWrapper(userBody) {
  return `#version 300 es
precision highp float;

${uniformDecls()}
out vec4 outColor;

#line 1 1
${userBody}
#line 1 2

void main() {
  vec4 c = vec4(0.0);
  mainImage(c, gl_FragCoord.xy);
  outColor = c;
}
`;
}

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(log || 'shader compile error');
  }
  return sh;
}

export function initRenderer(canvasEl, layers) {
  canvas = canvasEl;
  sceneLayers = layers;
  context = canvas.getContext('2d', { alpha: false });
  surface = document.createElement('canvas');
  gl = surface.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 is not supported by your browser');

  // полноэкранный квад
  const quad = new Float32Array([-1, -1, 3, -1, -1, 3]); // большой треугольник
  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', resize);
}

function resize() {
  if (!canvas.clientWidth || !canvas.clientHeight) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // на ретине не раздуваем
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    surface.width = w;
    surface.height = h;
  }
  if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
}

function buildProgram(code) {
  let vertex;
  let fragment;
  let program;
  try {
    vertex = compile(gl.VERTEX_SHADER, VERT);
    fragment = compile(gl.FRAGMENT_SHADER, fragWrapper(code));
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'link error');
    }
    const locations = Object.fromEntries(Object.keys(uniforms).concat('uResolution')
      .map(key => [key, gl.getUniformLocation(program, key)]));
    return { program, locations };
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}

export function loadShaders(layers) {
  const next = new Map();
  for (const layer of layers) {
    if (layer.type !== 'shader') continue;
    try {
      next.set(layer.id, buildProgram(layer.code));
    } catch (error) {
      for (const item of next.values()) gl.deleteProgram(item.program);
      return { id: layer.id, error: error.message };
    }
  }
  for (const item of programs.values()) gl.deleteProgram(item.program);
  programs = next;
  return null;
}

function drawShader(item, width, height) {
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(item.program);
  gl.bindVertexArray(vao);
  gl.uniform2f(item.locations.uResolution, width, height);
  for (const [key, value] of Object.entries(uniforms)) {
    const location = item.locations[key];
    if (location != null) gl.uniform1f(location, value);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  context.drawImage(surface, 0, 0);
}

function frame() {
  const now = performance.now();
  const dt = (now - lastFrameTime) / 1000; // реальное время кадра (не 1/60 всегда)
  lastFrameTime = now;
  uniforms.uTime = (now - startTime) / 1000;
  // часы лупа
  if (clockProvider) {
    const c = clockProvider();
    if (c) {
      uniforms.uTime = c.seconds;
      uniforms.uBeat = c.beat;
      uniforms.uLoop = c.loop;
      uniforms.uBeatFrac = c.frac;
    }
  }
  resize();

  const { width, height } = canvas;
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  for (const layer of sceneLayers()) {
    if (!layer.visible || !layer.opacity) continue;
    context.globalAlpha = layer.opacity / 100;
    if (layer.type === 'ascii') {
      const scale = layer.scale / 100;
      context.save();
      context.translate(width * (layer.x / 100 - scale / 2), height * (layer.y / 100 - scale / 2));
      drawAscii(context, layer, width * scale, height * scale, uniforms.uTime, uniforms);
      context.restore();
    } else {
      const item = programs.get(layer.id);
      if (item) drawShader(item, width, height);
    }
  }
  context.globalAlpha = 1;

  frameObserver?.(now);
  decayUniforms(dt);
  rafId = requestAnimationFrame(frame);
}

export function startRenderLoop() {
  if (rafId === null) {
    startTime = performance.now();
    lastFrameTime = startTime;
    frame();
  }
}

export function getCanvas() {
  return canvas;
}

export function observeFrames(callback) { frameObserver = callback; }
