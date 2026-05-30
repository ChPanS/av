// Обёртка над движком Strudel.
// Используем низкоуровневый repl() из @strudel/core + webaudioOutput,
// чтобы:
//   1) иметь доступ к scheduler (старт/стоп, чтение cps),
//   2) обернуть аудио-вывод и дополнительно дёргать визуальный колбэк
//      РОВНО в момент звучания (через deadline), а не с упреждением.

import { repl, evalScope, controls } from '@strudel/core';
import {
  initAudioOnFirstClick,
  getAudioContext,
  webaudioOutput,
  registerSynthSounds,
  samples,
} from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';

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
let anchorCycle = 0;           // номер цикла в момент anchorTime
let anchorTime = 0;            // время AudioContext, к которому привязан anchorCycle
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
  if (anchorTime === 0) return null;
  const cps = getCps();
  const cyc = anchorCycle + (getAudioContext().currentTime - anchorTime) * cps;
  const inLoop = ((cyc % loopCycles) + loopCycles) % loopCycles;
  return { beat: inLoop, loop: inLoop / loopCycles, frac: cyc - Math.floor(cyc) };
}

// кастомный вывод: звук + визуальное событие + обновление часов лупа
function makeOutput() {
  return (...args) => {
    // сигнатура: (hap, deadline, duration, cps, t)
    const hap = args[0];
    const deadline = args[1] ?? 0;
    // звук
    webaudioOutput(...args);

    // якорь часов: цикл события + момент его звучания
    const begin = hap?.whole?.begin;
    const cyc = typeof begin?.valueOf === 'function' ? begin.valueOf() : begin;
    if (typeof cyc === 'number' && isFinite(cyc)) {
      anchorCycle = cyc;
      anchorTime = getAudioContext().currentTime + deadline;
    }

    // визуал — откладываем на deadline, чтобы совпасть со звуком
    if (hapCallback) {
      const ms = Math.max(0, deadline * 1000);
      setTimeout(() => hapCallback(hap), ms);
    }
  };
}

export async function initAudio() {
  if (initialized) return;

  // регистрируем мини-нотацию, тональные хелперы, синты и эффекты в scope eval
  await evalScope(
    controls,
    import('@strudel/core'),
    import('@strudel/mini'),
    import('@strudel/tonal'),
    import('@strudel/webaudio'),
  );

  const ctx = getAudioContext();
  installMasterChain(ctx);

  await registerSynthSounds();
  // дефолтная библиотека ударных/сэмплов TidalCycles
  await samples('github:tidalcycles/dirt-samples');

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
  await evaluate(code); // парсит + ставит активный паттерн в scheduler
}

export function start() {
  if (scheduler) scheduler.start();
}

export function stop() {
  if (scheduler) scheduler.stop();
  anchorTime = 0; // часы лупа сброшены
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
