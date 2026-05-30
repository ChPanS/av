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
let initialized = false;

// --- зеркалируем аудиограф в поток для записи -------------------------
// У superdough нет публичного «мастер-выхода», поэтому мы один раз
// патчим AudioNode.connect: всё, что подключается к динамикам (ctx.destination),
// дополнительно подключаем к recorderDest. Так MediaRecorder получит звук.
function installRecorderTap(ctx) {
  recorderDest = ctx.createMediaStreamDestination();
  const realDest = ctx.destination;
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target === realDest) {
      try {
        origConnect.call(this, recorderDest);
      } catch (e) {
        /* некоторые узлы могут не подключиться повторно — это ок */
      }
    }
    return origConnect.call(this, target, ...rest);
  };
}

// кастомный вывод: звук + визуальное событие, синхронизированное по времени
function makeOutput() {
  return (...args) => {
    // сигнатура: (hap, deadline, duration, cps, t)
    const hap = args[0];
    const deadline = args[1] ?? 0;
    // звук
    webaudioOutput(...args);
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
  installRecorderTap(ctx);

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
