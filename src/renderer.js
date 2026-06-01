// WebGL2-рендерер фрагментного шейдера на полный экран (два треугольника).
// Пользователь пишет только тело mainImage(); мы оборачиваем его в полный
// шейдер с объявленными юниформами.

import { uniforms, decayUniforms } from './bridge.js';

let gl, canvas, program, vao;
let startTime = performance.now();
let rafId = null;
let clockProvider = null; // () => { beat, loop, frac } | null
const uLoc = {}; // кэш локаций юниформов

// источник часов лупа (ставит main.js: () => getClock())
export function setClockProvider(fn) {
  clockProvider = fn;
}

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

function uniformDecls() {
  // объявления генерируются из объекта uniforms — добавил канал в bridge.js,
  // он автоматически объявлен здесь. Все скалярные каналы — float, uResolution — vec2.
  let s = 'uniform vec2  uResolution;\n';
  for (const k of Object.keys(uniforms)) s += `uniform float ${k};\n`;
  return s;
}

function fragWrapper(userBody) {
  return `#version 300 es
precision highp float;

${uniformDecls()}
out vec4 outColor;

${userBody}

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

export function initRenderer(canvasEl) {
  canvas = canvasEl;
  gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 не поддерживается этим браузером');

  // полноэкранный квад
  const quad = new Float32Array([-1, -1, 3, -1, -1, 3]); // большой треугольник
  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', resize);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // на ретине не раздуваем
  const w = canvas.clientWidth * dpr;
  const h = canvas.clientHeight * dpr;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
}

// компилирует пользовательский шейдер. Возвращает null при успехе
// или строку с ошибкой компиляции (для показа в UI).
export function loadShader(userBody) {
  try {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, fragWrapper(userBody));
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      return log || 'link error';
    }
    // успех — меняем активную программу
    if (program) gl.deleteProgram(program);
    program = prog;

    // настраиваем атрибут позиции
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // кэшируем локации юниформов
    for (const name of Object.keys(uniforms).concat(['uResolution'])) {
      uLoc[name] = gl.getUniformLocation(program, name);
    }
    return null;
  } catch (e) {
    return e.message;
  }
}

function frame() {
  uniforms.uTime = (performance.now() - startTime) / 1000;
  // часы лупа
  if (clockProvider) {
    const c = clockProvider();
    if (c) {
      uniforms.uBeat = c.beat;
      uniforms.uLoop = c.loop;
      uniforms.uBeatFrac = c.frac;
    }
  }
  resize();

  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  if (program) {
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.uniform2f(uLoc.uResolution, canvas.width, canvas.height);
    // все скалярные каналы — одним циклом (null-локации инактивных юниформов
    // WebGL молча игнорирует, так что неиспользуемые в шейдере каналы безвредны)
    for (const k of Object.keys(uniforms)) {
      const loc = uLoc[k];
      if (loc !== null && loc !== undefined) gl.uniform1f(loc, uniforms[k]);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  decayUniforms();
  rafId = requestAnimationFrame(frame);
}

export function startRenderLoop() {
  if (rafId === null) {
    startTime = performance.now();
    frame();
  }
}

export function getCanvas() {
  return canvas;
}
