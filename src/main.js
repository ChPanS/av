// superdough 1.3.0 в dev-режиме сыплет ложный deprecation-warning про
// 'node.onended = callback' — его собственный хелпер onceEnded триггерит
// его же проверку при завершении каждой ноты. В прод-сборке этого нет
// (ветка стоит за NODE_ENV==='development'). Гасим ровно это сообщение в dev.
if (import.meta.env.DEV) {
  const _log = console.log;
  console.log = (...a) => {
    if (typeof a[0] === 'string' && a[0].includes("'node.onended = callback'")) return;
    _log.apply(console, a);
  };
}

import {
  initAudio, setHapCallback, setStateCallback, getState,
  evaluatePattern, start, stop, isInitialized, getCps, getRecorderStream,
  getClock, setLoopCycles, setMasterVolume, getHistory,
} from './audio.js';
import { initRenderer, loadShader, startRenderLoop, setClockProvider, observeFrames } from './renderer.js';
import { handleHap, syncTags, scanUniformCatalog, resetVisualState, decayUniforms } from './bridge.js';
import { createHighlighter } from './highlight.js';
import { createEditor } from './editor.js';
import { recordingMime, recordClip, downloadBlob } from './recorder.js';
import { convertWebmToMp4 } from './mp4.js';
import { createOverlay } from './overlay.js';
import { createTimeline } from './timeline.js';
import { createMonitor } from './monitor.js';
import { defaultScene } from './scenes/default.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const playBtn = $('play');
const stopBtn = $('stop');
const shareBtn = $('share');
const fsBtn = $('fullscreen');
const linkBtn = $('copylink');
const debugBtn = $('debug');
const infoBtn = $('info');
const infoModal = $('infomodal');
const infoClose = $('infoclose');
const volSlider = $('volume');
const status = $('status');
const logPanel = $('logpanel');
const logEl = $('log');
const tabPattern = $('tab-pattern');
const tabShader = $('tab-shader');
const panePattern = $('pane-pattern');
const paneShader = $('pane-shader');

// ---------- редакторы ----------
const loaded = loadFromHash() || defaultScene;
let appliedShader = '';
const runFromEditor = () => playBtn.click();
const patternEd = createEditor(panePattern, loaded.pattern, 'js', runFromEditor);
const shaderEd = createEditor(paneShader, loaded.shader, 'glsl', runFromEditor, () => scanUniformCatalog(patternEd.get()));
const highlighter = createHighlighter(patternEd.view); // подсветка играющих нот

// ---------- вкладки + мобильный аккордеон ----------
const leftSection = $('left');
const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

function setTab(which) {
  const onPattern = which === 'pattern';
  panePattern.classList.toggle('hidden', !onPattern);
  paneShader.classList.toggle('hidden', onPattern);
  tabPattern.classList.toggle('active', onPattern);
  tabShader.classList.toggle('active', !onPattern);
  // CodeMirror нужно пересчитать размеры после показа/ресайза контейнера
  const ed = onPattern ? patternEd : shaderEd;
  requestAnimationFrame(() => ed.view.requestMeasure());
}

let mobileOpen = false;
function setOpen(open) {
  mobileOpen = open;
  leftSection.classList.toggle('open', open);
  if (open) {
    const ed = tabPattern.classList.contains('active') ? patternEd : shaderEd;
    // после анимации раскрытия перемерить редактор
    setTimeout(() => ed.view.requestMeasure(), 240);
  }
}

function onTab(which) {
  const tab = which === 'pattern' ? tabPattern : tabShader;
  const wasActive = tab.classList.contains('active');
  setTab(which);
  if (isMobile()) {
    // тап по уже активной вкладке сворачивает; иначе разворачивает
    if (wasActive && mobileOpen) setOpen(false);
    else setOpen(true);
  }
}
tabPattern.onclick = () => onTab('pattern');
tabShader.onclick = () => onTab('shader');
setTab('pattern'); // на мобиле стартуем свёрнутыми (mobileOpen=false)

const workspace = document.querySelector('main');
const split = $('split');
const focus = $('editor-full');
const measureEditors = () => {
  patternEd.view.requestMeasure();
  shaderEd.view.requestMeasure();
};
split.onclick = () => {
  const enabled = leftSection.classList.toggle('split');
  split.setAttribute('aria-pressed', String(enabled));
  if (enabled) setOpen(true);
  measureEditors();
};
focus.onclick = () => {
  const enabled = workspace.classList.toggle('editor-focus');
  focus.setAttribute('aria-pressed', String(enabled));
  if (enabled) setOpen(true);
  measureEditors();
};

let font = 16;
try { font = Math.max(12, Math.min(28, Number(localStorage.getItem('av-editor-font')) || 16)); } catch {}
function fontSize(delta) {
  font = Math.max(12, Math.min(28, font + delta));
  leftSection.style.setProperty('--editor-font', font + 'px');
  try { localStorage.setItem('av-editor-font', String(font)); } catch {}
  measureEditors();
}
$('font-down').onclick = () => fontSize(-1);
$('font-up').onclick = () => fontSize(1);
fontSize(0);

function addDivider(divider, container, property, initial) {
  let percent = initial;
  function resize(value) {
    percent = Math.min(75, Math.max(25, value));
    container.style.setProperty(property, percent + '%');
    divider.setAttribute('aria-valuenow', String(Math.round(percent)));
    measureEditors();
  }
  divider.onpointerdown = event => divider.setPointerCapture(event.pointerId);
  divider.onpointermove = event => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    const bounds = container.getBoundingClientRect();
    resize(100 * (event.clientX - bounds.left) / bounds.width);
  };
  divider.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    resize(percent + (event.key === 'ArrowLeft' ? -3 : 3));
  };
}
addDivider($('workspace-divider'), workspace, '--workspace-width', 48);
addDivider($('code-divider'), panePattern.parentElement, '--code-width', 50);

// ---------- лог / дебаг ----------
let debugOn = false;
let logCount = 0;
const MAX_LOG = 300;

function log(msg, kind = 'info') {
  // info | ok | err | event
  const line = document.createElement('div');
  line.className = 'logline ' + kind;
  const t = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  line.textContent = `${t}  ${msg}`;
  logEl.appendChild(line);
  logCount++;
  if (logCount > MAX_LOG) {
    logEl.removeChild(logEl.firstChild);
    logCount--;
  }
  logEl.scrollTop = logEl.scrollHeight;
}

debugBtn.onclick = () => {
  debugOn = !debugOn;
  debugBtn.classList.toggle('on', debugOn);
  logPanel.classList.toggle('hidden', !debugOn);
  if (debugOn) log('debug включён — события, команды и ошибки пишутся сюда', 'ok');
};

// Логгер Strudel шлёт ВСЕ свои сообщения через CustomEvent 'strudel.log'
// на document: и "[eval] code updated", и "[eval] error: ...".
// Перехватываем и пишем в нашу панель (ошибки — красным).
document.addEventListener('strudel.log', (e) => {
  const d = e.detail || {};
  const kind = d.type === 'error' ? 'err' : 'cmd';
  log(d.message, kind);
  if (d.type === 'error') setStatus(d.message.split('\n')[0], true);
});

// Состояние repl: ловим ошибки во время ИГРЫ (несуществующий сэмпл и т.п.),
// которые происходят уже после нажатия play.
setStateCallback((state) => {
  if (state.schedulerError) {
    reportError('An error occurred while playing', state.schedulerError);
  }
});

// статус-строка (короткая). Ошибки дублируем в лог полностью.
function setStatus(msg, isError = false) {
  status.textContent = msg;
  status.classList.toggle('err', isError);
}
function reportError(prefix, e) {
  const full = (e && e.message) ? e.message : String(e);
  setStatus(prefix + ': ' + full.split('\n')[0], true);
  // в лог — целиком, многострочно
  log(prefix + ':', 'err');
  full.split('\n').forEach((l) => l.trim() && log('  ' + l, 'err'));
}

// ---------- рендер: за предупреждением об эпилепсии ----------
initRenderer(canvas);
setClockProvider(getClock);   // uBeat/uLoop/uBeatFrac берутся из часов лупа
syncTags(patternEd.get());    // юниформы под теги .vis() из паттерна — ДО первой компиляции шейдера
applyShader(true);
// startRenderLoop() вызывается только после согласия (см. ниже)

const EPI_KEY = 'av-gate-ack-v2'; // версия повышается при изменении текста уведомления
const epiModal = $('epilepsy');
const epiOk = $('epi-ok');
const epiRemember = $('epi-remember');

function hasEpiConsent() {
  try { return localStorage.getItem(EPI_KEY) === '1'; } catch (e) { return false; }
}

// если согласие уже сохранено — стартуем сразу; иначе показываем предупреждение
if (hasEpiConsent()) {
  startRenderLoop();
} else {
  epiModal.classList.remove('hidden');
}

if (epiOk) {
  epiOk.onclick = () => {
    if (epiRemember && epiRemember.checked) {
      try { localStorage.setItem(EPI_KEY, '1'); } catch (e) {}
    }
    epiModal.classList.add('hidden');
    startRenderLoop();
  };
}

// компиляция шейдера из редактора; true = успех
function applyShader(silent = false) {
  const err = loadShader(shaderEd.get());
  shaderEd.errors(err);
  if (err) {
    reportError('Shader error', new Error(err));
    return false;
  }
  appliedShader = shaderEd.get();
  if (!silent) log('shader compiled', 'ok');
  return true;
}

// визуальный колбэк: всегда двигаем юниформы, в дебаге ещё и логируем
let lastEventLog = 0;
setHapCallbackSafe();
function setHapCallbackSafe() {
  setHapCallback((hap) => {
    handleHap(hap);
    // подсветка играющих нот: зажигаем позиции в коде на длительность ноты
    const locs = hap?.context?.locations;
    if (locs && patternEd.get() === appliedPattern) {
      let holdMs = 140;
      try {
        const b = hap.whole?.begin, e = hap.whole?.end;
        const bc = typeof b?.valueOf === 'function' ? b.valueOf() : b;
        const ec = typeof e?.valueOf === 'function' ? e.valueOf() : e;
        const cps = getCps() || 0.5;
        if (isFinite(bc) && isFinite(ec) && ec > bc) holdMs = ((ec - bc) / cps) * 1000;
      } catch (e) {}
      highlighter.light(locs, holdMs);
    }
    if (debugOn) {
      const v = hap?.value ?? {};
      const s = v.s ?? v.sound ?? '';
      const note = v.note ?? v.n ?? '';
      // лёгкий троттлинг, чтобы не залить лог тысячей строк
      const now = performance.now();
      if (now - lastEventLog > 20) {
        log(`event  s=${s || '—'}  note=${note !== '' ? note : '—'}  gain=${v.gain ?? '—'}`, 'event');
        lastEventLog = now;
      }
    }
  });
}

let started = false;
let appliedPattern = '';
let exporting;
let captured;
let lastTimeline = 0;
let cueRevision = 0;

function seedVisuals(from) {
  resetVisualState();
  let previous = 0;
  const cps = getCps();
  function advance(to) {
    let seconds = Math.max(0, Math.min(30, (to - previous) / cps));
    while (seconds > 0) {
      const step = Math.min(0.25, seconds);
      decayUniforms(step);
      seconds -= step;
    }
    previous = to;
  }
  for (const hap of getHistory(from)) {
    advance(Number(hap.whole.begin));
    handleHap(hap);
  }
  advance(from);
}

async function seek(cycle) {
  if (!started || exporting) return;
  const revision = ++cueRevision;
  try {
    stop();
    highlighter.clear();
    seedVisuals(cycle);
    const repeat = timeline.repeat();
    await start({ from: cycle, repeat: repeat && cycle < repeat.to ? repeat : null });
    if (revision === cueRevision) setStatus('playing · cycle ' + (cycle + 1));
  } catch (error) {
    if (revision === cueRevision) reportError('Could not seek', error);
  }
}

const timeline = createTimeline($, seek);
timeline.setLength(loopLength(loaded.pattern));
setLoopCycles(loopLength(loaded.pattern));
timeline.update(null);
const overlay = createOverlay(canvas, $('code-overlay'), patternEd, shaderEd, highlighter, () => appliedPattern);
const monitor = createMonitor($('signal-panel'), $('signal-list'), $('signal-source'), () => appliedPattern || patternEd.get());
observeFrames(now => {
  overlay.preview(now);
  captured?.draw(now);
  monitor(now);
  if (now - lastTimeline > 100) {
    lastTimeline = now;
    timeline.update(getClock());
  }
});

function loopLength(code) {
  return Math.min(10000, Math.max(1, Number(code.match(/\/\/\s*loop:\s*(\d+)/i)?.[1]) || 24));
}

// ---------- PLAY = применить код + запустить (live update) ----------
playBtn.onclick = async () => {
  if (exporting) return;
  try {
    playBtn.disabled = true;

    if (!isInitialized()) {
      setStatus('sound initialization, loading samples…');
      log('initAudio: loading samples…', 'info');
      await initAudio();
      setHapCallbackSafe();
      setMasterVolume((volSlider?.value ?? 50) / 100); // применяем громкость слайдера
      log('audio ready', 'ok');
    }

    // 1) теги .vis() из паттерна -> набор юниформов, ЗАТЕМ шейдер (он на них ссылается)
    const code = patternEd.get();
    const { warnings } = syncTags(code);
    warnings.forEach((w) => log(w, 'err'));
    if (!applyShader()) { playBtn.disabled = false; return; }

    // 2) паттерн (live). ВАЖНО: evaluate НЕ бросает исключение при ошибке кода —
    //    он пишет её в state.evalError. Поэтому проверяем состояние вручную.
    // длина лупа для uBeat: из комментария "// loop: N" в паттерне (иначе 24)
    const length = loopLength(code);
    if (debugOn) {
      log('evaluate pattern:', 'info');
      code.split('\n').forEach((l) => log('  ' + l, 'info'));
    }
    await evaluatePattern(code);

    const st = getState();
    if (st.evalError) {
      // ошибка уже улетела в лог через 'strudel.log'; дублируем в статус крупно
      reportError('Code is not running (Strudel error)', st.evalError);
      return; // НЕ стартуем — играет прежний валидный паттерн (или тишина)
    }

    // 3) запуск (один раз; повторный play обновляет паттерн вживую)
    setLoopCycles(length);
    timeline.setLength(length);
    appliedPattern = code;
    if (!started) {
      const repeat = timeline.repeat();
      const from = repeat?.from ?? timeline.cue();
      seedVisuals(from);
      await start({ from, repeat });
      started = true;
    }

    const cps = getCps();
    setStatus('playing · updated · cps ' + cps.toFixed(2));
    log('pattern updated · cps ' + cps.toFixed(2), 'ok');
  } catch (e) {
    reportError('Pattern error', e);
  } finally {
    playBtn.disabled = false;
  }
};

// ---------- STOP ----------
stopBtn.onclick = () => {
  cueRevision++;
  if (exporting) {
    exporting.abort();
    return;
  }
  stop();
  highlighter.clear();
  started = false;
  setStatus('stopped');
  log('stop', 'info');
};

// ---------- FULLSCREEN ----------
fsBtn.onclick = () => {
  const wrap = $('stage');
  if (!document.fullscreenElement) wrap.requestFullscreen?.();
  else document.exitFullscreen?.();
};

// ---------- SHARE: видео по циклам ----------
shareBtn.onclick = async () => {
  if (!started || !appliedPattern) {
    setStatus('Press play to apply the pattern before exporting.', true);
    return;
  }
  if (exporting) return;
  if (patternEd.get() !== appliedPattern || shaderEd.get() !== appliedShader) {
    setStatus('Press play / update to apply your edits before exporting.', true);
    return;
  }
  const format = $('video-format').value;
  const mime = recordingMime(format);
  if (!mime) {
    setStatus('Video recording is unavailable in this browser.', true);
    return;
  }
  const range = timeline.range();
  if ((range.to - range.from) / getCps() > 300) {
    setStatus('Choose a range up to 5 minutes.', true);
    return;
  }
  exporting = new AbortController();
  timeline.disable(true);
  shareBtn.disabled = playBtn.disabled = true;
  try {
    stop();
    highlighter.clear();
    const warmup = Math.max(0, range.from - Math.min(4, Math.ceil(1.5 * getCps())));
    seedVisuals(warmup);
    captured = overlay.capture(Number($('video-height').value));
    captured.draw(performance.now());
    setStatus('Preparing cycles ' + (range.from + 1) + '–' + range.to + '…');
    await start({ from: warmup, end: range.to });
    const blob = await recordClip({
      canvas: captured.canvas, audioStream: getRecorderStream(), mime,
      fps: Number($('video-fps').value), getClock, ...range, signal: exporting.signal,
      onProgress: progress => setStatus('Recording… ' + Math.round(progress * 100) + '%'),
    });
    stop();
    captured = null;
    started = false;
    stopBtn.disabled = true;
    const filename = 'av-' + (range.from + 1) + '-' + range.to;
    if (format === 'mp4' && !blob.type.includes('mp4')) {
      setStatus('Converting to MP4…');
      try {
        const mp4 = await convertWebmToMp4(blob, {
          onProgress: progress => setStatus('Converting… ' + Math.round(progress * 100) + '%'),
        });
        downloadBlob(mp4, filename + '.mp4');
        setStatus('MP4 downloaded');
      } catch (error) {
        downloadBlob(blob, filename + '.webm');
        reportError('MP4 conversion failed; WebM downloaded', error);
      }
    } else {
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(blob, filename + '.' + extension);
      setStatus(extension.toUpperCase() + ' downloaded');
    }
  } catch (error) {
    if (error.name === 'AbortError') setStatus('Export cancelled');
    else reportError('Export failed', error);
  } finally {
    stop();
    started = false;
    captured = null;
    exporting = null;
    timeline.disable(false);
    stopBtn.disabled = shareBtn.disabled = playBtn.disabled = false;
  }
};

// ---------- URL-шеринг сцены ----------
linkBtn.onclick = async () => {
  const payload = { pattern: patternEd.get(), shader: shaderEd.get() };
  const hash = btoa(encodeURIComponent(JSON.stringify(payload)));
  const url = location.origin + location.pathname + '#' + hash;
  try {
    await navigator.clipboard.writeText(url);
    setStatus('copied link');
  } catch {
    setStatus('link in url');
    location.hash = hash;
  }
};

// ---------- громкость (мастер) ----------
if (volSlider) {
  volSlider.value = 50; // дефолт 50%
  volSlider.addEventListener('input', () => {
    setMasterVolume(volSlider.value / 100); // no-op пока audio не инициализирован
    setStatus('volume ' + volSlider.value + '%');
  });
}

// ---------- инфо-модалка ----------
if (infoBtn && infoModal) {
  infoBtn.onclick = () => infoModal.classList.remove('hidden');
  infoClose.onclick = () => infoModal.classList.add('hidden');
  infoModal.addEventListener('click', (e) => {
    if (e.target === infoModal) infoModal.classList.add('hidden'); // клик по фону закрывает
  });
}

// ---------- хоткей: Ctrl/Cmd+Enter = play (когда фокус НЕ в редакторе) ----------
// Внутри редактора Mod-Enter обрабатывает сам CodeMirror (см. editor.js),
// поэтому тут пропускаем, чтобы play не сработал дважды и не вставился перенос.
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (document.activeElement && document.activeElement.closest('.cm-editor')) return;
    e.preventDefault();
    playBtn.click();
  }
});

function loadFromHash() {
  if (!location.hash || location.hash.length < 2) return null;
  try {
    const obj = JSON.parse(decodeURIComponent(atob(location.hash.slice(1))));
    if (obj.pattern && obj.shader) return obj;
  } catch {}
  return null;
}
