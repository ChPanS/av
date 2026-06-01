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
  getClock, setLoopCycles, setMasterVolume,
} from './audio.js';
import { initRenderer, loadShader, startRenderLoop, getCanvas, setClockProvider } from './renderer.js';
import { handleHap } from './bridge.js';
import { createHighlighter } from './highlight.js';
import { createEditor } from './editor.js';
import { computeClipDuration, recordClip, downloadBlob } from './recorder.js';
import { convertWebmToMp4 } from './mp4.js';
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
const runFromEditor = () => playBtn.click();
const patternEd = createEditor(panePattern, loaded.pattern, 'js', runFromEditor);
const shaderEd = createEditor(paneShader, loaded.shader, 'glsl', runFromEditor);
const highlighter = createHighlighter(patternEd.view); // подсветка играющих нот

// Задел под будущую кнопку «совмещение»: кладёт редактор (с подсветкой) поверх
// рендера. Сейчас не привязано к кнопке — вызывать setEditorOverlay(true/false).
// Для полноэкранного режима кнопка дополнительно дёрнет requestFullscreen на #stage.
function setEditorOverlay(on) {
  document.querySelector('main')?.classList.toggle('overlay-mode', !!on);
}
window.__setEditorOverlay = setEditorOverlay; // временный доступ для теста из консоли

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
    reportError('Ошибка во время игры', state.schedulerError);
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
  if (err) {
    reportError('Ошибка шейдера', new Error(err));
    return false;
  }
  if (!silent) log('shader скомпилирован', 'ok');
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
    if (locs) {
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

let started = false; // своя метка состояния (не полагаемся на внутренности scheduler)

// ---------- PLAY = применить код + запустить (live update) ----------
playBtn.onclick = async () => {
  try {
    playBtn.disabled = true;

    if (!isInitialized()) {
      setStatus('инициализация звука, загрузка сэмплов…');
      log('initAudio: загрузка сэмплов…', 'info');
      await initAudio();
      setHapCallbackSafe();
      setMasterVolume((volSlider?.value ?? 50) / 100); // применяем громкость слайдера
      log('audio готов', 'ok');
    }

    // 1) шейдер
    if (!applyShader()) { playBtn.disabled = false; return; }

    // 2) паттерн (live). ВАЖНО: evaluate НЕ бросает исключение при ошибке кода —
    //    он пишет её в state.evalError. Поэтому проверяем состояние вручную.
    const code = patternEd.get();
    // длина лупа для uBeat: из комментария "// loop: N" в паттерне (иначе 24)
    const loopMatch = code.match(/loop:\s*(\d+)/i);
    setLoopCycles(loopMatch ? parseInt(loopMatch[1], 10) : 24);
    if (debugOn) {
      log('evaluate pattern:', 'info');
      code.split('\n').forEach((l) => log('  ' + l, 'info'));
    }
    await evaluatePattern(code);

    const st = getState();
    if (st.evalError) {
      // ошибка уже улетела в лог через 'strudel.log'; дублируем в статус крупно
      reportError('Код не запущен (ошибка Strudel)', st.evalError);
      return; // НЕ стартуем — играет прежний валидный паттерн (или тишина)
    }

    // 3) запуск (один раз; повторный play обновляет паттерн вживую)
    if (!started) {
      start();
      started = true;
    }

    const cps = getCps();
    setStatus('играет · обновлено · cps ' + cps.toFixed(2));
    log('pattern применён · cps ' + cps.toFixed(2), 'ok');
  } catch (e) {
    reportError('Ошибка в паттерне', e);
  } finally {
    playBtn.disabled = false;
  }
};

// ---------- STOP ----------
stopBtn.onclick = () => {
  stop();
  started = false;
  setStatus('остановлено');
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
  if (!started) {
    setStatus('сначала нажми play — нужно играющее аудио', true);
    return;
  }
  const cps = getCps();
  const { seconds, cycles } = computeClipDuration(cps, 60);
  try {
    shareBtn.disabled = true;
    log(`запись клипа: ${seconds.toFixed(1)}с, ${Math.round(cycles)} циклов`, 'info');
    setStatus(`запись ${seconds.toFixed(1)}с (${Math.round(cycles)} циклов)…`);
    const blob = await recordClip({
      canvas: getCanvas(),
      audioStream: getRecorderStream(),
      durationSec: seconds,
      fps: 60,
      onProgress: (p) => setStatus(`запись… ${Math.round(p * 100)}%`),
    });
    // нативный mp4 (Safari/новые Chrome) -> отдаём сразу, без конвертации
    if (blob.type.includes('mp4')) {
      downloadBlob(blob, 'av-clip.mp4');
      setStatus('готово — mp4 скачан');
      log('клип готов (нативный mp4, ' + (blob.size / 1024 / 1024).toFixed(1) + ' МБ)', 'ok');
    } else {
      // webm -> конвертируем в mp4 через ffmpeg.wasm (ленивая загрузка ~31МБ)
      setStatus('конвертация webm → mp4 (первый раз грузит ~31МБ ядро)…');
      log('конвертация webm → mp4 через ffmpeg.wasm…', 'info');
      try {
        const mp4 = await convertWebmToMp4(blob, {
          onProgress: (p) => setStatus('конвертация… ' + Math.round(p * 100) + '%'),
          onLog: (m) => { if (debugOn) log('[ffmpeg] ' + m, 'cmd'); },
        });
        downloadBlob(mp4, 'av-clip.mp4');
        setStatus('готово — mp4 скачан');
        log('mp4 готов (' + (mp4.size / 1024 / 1024).toFixed(1) + ' МБ)', 'ok');
      } catch (convErr) {
        // если конвертация упала (память/сеть на слабом устройстве) — отдаём webm
        reportError('Конвертация не удалась, отдаю webm', convErr);
        downloadBlob(blob, 'av-clip.webm');
      }
    }
  } catch (e) {
    reportError('Запись не удалась', e);
  } finally {
    shareBtn.disabled = false;
  }
};

// ---------- URL-шеринг сцены ----------
linkBtn.onclick = async () => {
  const payload = { pattern: patternEd.get(), shader: shaderEd.get() };
  const hash = btoa(encodeURIComponent(JSON.stringify(payload)));
  const url = location.origin + location.pathname + '#' + hash;
  try {
    await navigator.clipboard.writeText(url);
    setStatus('ссылка на сцену скопирована');
  } catch {
    setStatus('ссылка в адресной строке');
    location.hash = hash;
  }
};

// ---------- громкость (мастер) ----------
if (volSlider) {
  volSlider.value = 50; // дефолт 50%
  volSlider.addEventListener('input', () => {
    setMasterVolume(volSlider.value / 100); // no-op пока audio не инициализирован
    setStatus('громкость ' + volSlider.value + '%');
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
