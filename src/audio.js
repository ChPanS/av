// Обёртка над движком Strudel.
// Используем низкоуровневый repl() из @strudel/core + webaudioOutput,
// чтобы:
//   1) иметь доступ к scheduler (старт/стоп, чтение cps),
//   2) обернуть аудио-вывод и дополнительно дёргать визуальный колбэк
//      РОВНО в момент звучания (через deadline), а не с упреждением.

import { repl, evalScope, controls, register, Pattern, createParams } from '@strudel/core';
import * as strudelCore from '@strudel/core';
import * as strudelMini from '@strudel/mini';
import * as strudelTonal from '@strudel/tonal';
import * as strudelDraw from '@strudel/draw';
import * as strudelWebaudio from '@strudel/webaudio';
import {
  initAudioOnFirstClick,
  getAudioContext,
  webaudioOutput,
  registerSynthSounds,
  registerZZFXSounds,
  samples,
  soundMap,
} from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';
import { registerSoundfonts } from '@strudel/soundfonts';

let scheduler = null;
let evaluate = null;
let replState = null;          // живой объект состояния repl (evalError, schedulerError, started…)
let stateCallback = null;      // колбэк изменения состояния (ставит main.js)
let hapCallback = null;        // визуальный колбэк (ставит main.js)
let recorderDest = null;       // MediaStreamDestination для записи аудио
let masterGain = null;         // мастер-громкость (всё идёт через него)
let initialized = false;

// --- часы лупа (для uBeat) -------------------------------------------
// Ведём текущий цикл от событий паттерна: у hap есть whole.begin (номер цикла).
// Между событиями интерполируем по времени и cps. mod на длину лупа -> сброс в 0.
let sourcePattern;
let playbackRange;
let generation = 0;
let stopAt = Infinity;
let loopCycles = 24;           // длина лупа в циклах (из "// loop: N" в паттерне)

// --- мастер-цепочка: громкость + ответвление на запись ----------------
// У superdough нет публичного мастер-выхода. Перехватываем connect:
// всё, что шло в динамики (ctx.destination), заворачиваем в masterGain,
// а masterGain -> динамики + recorderDest. Громкость и запись — пост-фейдер.
function installMasterChain(ctx) {
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.5;               // дефолт 50%
  recorderDest = ctx.createMediaStreamDestination();
  const realDest = ctx.destination;

  const origConnect = AudioNode.prototype.connect;
  // подключаем мастер ДО патча (оригинальным connect), чтобы не зациклить
  origConnect.call(masterGain, realDest);
  origConnect.call(masterGain, recorderDest);

  AudioNode.prototype.connect = function (target, ...rest) {
    if (target === realDest && this !== masterGain) {
      // заворачиваем голоса в мастер вместо прямого выхода в динамики
      return origConnect.call(this, masterGain);
    }
    return origConnect.call(this, target, ...rest);
  };
}

export function setMasterVolume(v) {
  if (!masterGain) return;
  const ctx = getAudioContext();
  const val = Math.max(0, Math.min(1, v));
  // короткий рамп, чтобы не щёлкало
  masterGain.gain.setTargetAtTime(val, ctx.currentTime, 0.02);
}

export function setLoopCycles(n) {
  loopCycles = Math.max(1, Number(n) || 1);
}

// текущее положение в лупе: { beat: 0..loopCycles, loop: 0..1, frac: 0..1 }
export function getClock() {
  if (!scheduler?.started || scheduler.seconds_at_cps_change === undefined) return null;
  const elapsed = getAudioContext().currentTime - scheduler.seconds_at_cps_change - scheduler.latency;
  const cycle = scheduler.num_cycles_at_cps_change + elapsed * getCps();
  const position = playbackRange && cycle >= playbackRange.from
    ? playbackRange.from + (cycle - playbackRange.from) % (playbackRange.to - playbackRange.from)
    : Math.max(0, cycle);
  const beat = position % loopCycles;
  return { cycle, position, beat, loop: beat / loopCycles, frac: position % 1, seconds: position / getCps() };
}

function makeOutput() {
  return (hap, deadline, duration, cps, time) => {
    const cycle = Number(hap.whole?.begin);
    if (cycle >= stopAt) return;
    webaudioOutput(hap, deadline, duration, cps, time);
    const currentGeneration = generation;
    const delay = Math.max(0, (time - getAudioContext().currentTime) * 1000);
    setTimeout(() => {
      if (generation === currentGeneration) hapCallback?.(hap);
    }, delay);
  };
}

function repeatRange(pattern, { from, to }) {
  const length = to - from;
  return new Pattern(state => {
    const haps = [];
    const end = Number(state.span.end);
    for (let start = Number(state.span.begin); start < end;) {
      const shift = Math.max(0, Math.floor((start - from) / length)) * length;
      const next = Math.min(end, to + shift);
      if (next <= start) break;
      const span = new strudelCore.TimeSpan(start - shift, next - shift);
      for (const hap of pattern.query(state.setSpan(span))) {
        haps.push(hap.withSpan(part => part.withTime(t => t.add(shift))));
      }
      start = next;
    }
    return haps;
  });
}

export function getHistory(until, from = 0) {
  const events = [];
  for (let cycle = from; sourcePattern && cycle < until; cycle++) {
    const next = Math.min(cycle + 1, until);
    events.push(...sourcePattern.queryArc(cycle, next, { _cps: getCps(), cyclist: 'cyclist' })
      .filter(hap => hap.hasOnset()));
  }
  return events.sort((a, b) => Number(a.whole.begin) - Number(b.whole.begin));
}

// делает каждое имя звука из soundMap методом паттерна (.piano(), .casio() ...)
function registerSoundsAsMethods() {
  let names = [];
  try {
    names = Object.keys(soundMap.get() || {});
  } catch (e) {
    return;
  }
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue; // валидный JS-идентификатор
    if (Pattern.prototype[name]) continue;                // не затираем существующие методы
    try {
      register(name, (pat) => pat.s(name));
    } catch (e) {
      /* конфликт имени — пропускаем */
    }
  }
}

export async function initAudio() {
  if (initialized) return;

  // кастомный пасс-тру контрол .vis("...") — пользователь сам помечает группу
  // визуала (kick/snare/hat/pad/bass/lead). Звука не меняет, просто кладёт
  // значение в hap.value.vis, которое читает bridge.js.
  const visParams = createParams('vis');

  // регистрируем мини-нотацию, тональные хелперы, синты, эффекты и draw в scope eval
  // (статические namespace-импорты, чтобы не было предупреждений о смешении
  //  динамического и статического импорта)
  await evalScope(
    controls,
    visParams,
    strudelCore,
    strudelMini,
    strudelTonal,
    strudelDraw,
    strudelWebaudio,
  );

  const ctx = getAudioContext();
  installMasterChain(ctx);

  // ── prebake как на strudel.cc: синты + ZZFX + GM-саундфонты ──────────
  await Promise.allSettled([
    registerSynthSounds(),
    registerZZFXSounds(),
    registerSoundfonts(), // gm_* инструменты (грузятся лениво)
  ]);

  // ── дефолтные банки сэмплов (felixroos/dough-samples) ────────────────
  // даёт .piano, tambourine, драм-машины (RolandTR909 и т.д.), инструменты VCSL.
  // JSON содержат _base, поэтому второй аргумент не нужен. Грузятся манифесты
  // (лёгкие), сами аудио-сэмплы подтягиваются лениво при первом использовании.
  const ds = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/';
  await Promise.allSettled([
    samples(ds + 'tidal-drum-machines.json'),
    samples(ds + 'piano.json'),
    samples(ds + 'Dirt-Samples.json'),
    samples(ds + 'EmuSP12.json'),
    samples(ds + 'vcsl.json'),
    samples(ds + 'mridangam.json'),
  ]);

  // делаем каждое зарегистрированное имя звука методом паттерна:
  // .piano(), .tambourine(), .gm_clarinet() и т.д. (как .s("name")).
  // Пропускаем имена-невалидные-идентификаторы и уже существующие функции.
  registerSoundsAsMethods();

  const r = repl({
    defaultOutput: makeOutput(),
    getTime: () => ctx.currentTime,
    transpiler, // позволяет писать "bd sn" мини-нотацией в двойных кавычках
    // вызывается при любом изменении состояния: тут приходят
    // evalError (ошибка кода) и schedulerError (ошибка во время игры)
    onUpdateState: (state) => {
      replState = state;
      try { stateCallback && stateCallback(state); } catch (e) {}
    },
  });
  scheduler = r.scheduler;
  evaluate = r.evaluate;
  replState = r.state;

  initialized = true;
}

export function setStateCallback(cb) {
  stateCallback = cb;
}

// текущее состояние repl: { evalError, schedulerError, started, ... }
export function getState() {
  return replState || {};
}

export function setHapCallback(cb) {
  hapCallback = cb;
}

// применить код паттерна вживую (НЕ запускает планировщик).
// бросает исключение с текстом ошибки, если код не парсится.
export async function evaluatePattern(code) {
  if (!evaluate) throw new Error('audio не инициализирован');
  await getAudioContext().resume();
  await evaluate(code, false);
  if (!replState.evalError) {
    sourcePattern = scheduler.pattern;
    if (playbackRange) scheduler.pattern = repeatRange(sourcePattern, playbackRange);
  }
}

export async function start({ from = 0, repeat = null, end = Infinity } = {}) {
  playbackRange = repeat;
  stopAt = end;
  scheduler.pattern = repeat ? repeatRange(sourcePattern, repeat) : sourcePattern;
  scheduler.lastEnd = from;
  await scheduler.start();
}

export function stop() {
  generation++;
  if (scheduler) {
    scheduler.stop();
    strudelWebaudio.resetGlobalEffects();
  }
  playbackRange = null;
}

export function isInitialized() {
  return initialized;
}

// текущее число циклов в секунду (для расчёта длины видео)
export function getCps() {
  // setcps() в коде обновляет scheduler.cps; дефолт strudel ~0.5
  const cps = scheduler?.cps;
  return typeof cps === 'number' && cps > 0 ? cps : 0.5;
}

export function getRecorderStream() {
  return recorderDest ? recorderDest.stream : null;
}

export function getCtx() {
  return getAudioContext();
}

// инициализировать «разблокировку звука по первому клику» сразу при загрузке
initAudioOnFirstClick();
