// Мост музыка -> визуал.
//
// Никакого угадывания по имени сэмпла. Всё явно тегами: .vis("<префикс><Имя>").
// Префикс определяет ТИП канала (что именно трекать и как это гаснет),
// Имя — придумывает пользователь. Префикс в имя юниформа НЕ попадает —
// в шейдере всегда просто "u" + Имя, чтобы было чисто (uKick, не uDKick):
//
//   d<Имя>  — удар: только громкость, импульс + быстрое затухание.
//             .vis("dKick") -> uniform float uKick
//   i<Имя>  — инструмент: велосити (гаснет) + питч (держится), ДВА поля ОДНОГО
//             uniform-а через точку (структура в GLSL, WebGL2 умеет так нативно):
//             .vis("iLead") -> uniform AVInstrument uLead;  =>  uLead.vel, uLead.pitch
//   p<Имя>  — только питч: держит последнюю ноту, без огибающей громкости.
//             .vis("pLead") -> uniform float uLead
//
// Если два разных тега (например dPad и iPad) метят в одно и то же Имя — второй
// пропускается с предупреждением (см. warnings из syncTags), юниформ не дублируется.
//
// Набор активных каналов ПОЛНОСТЬЮ определяется тегами, которые встречаются
// в коде паттерна (см. syncTags ниже) — если тега нет, юниформа не будет и
// в шейдере, попытка сослаться на него — ошибка компиляции (это осознанно:
// шейдер и паттерн должны буквально совпадать по тегам, никакой магии).
// scanUniformCatalog(code) — то же самое сканирование, но БЕЗ побочных эффектов
// (не трогает uniforms/decay) — им кормится автокомплит в редакторе шейдера
// (main.js передаёт live-текст паттерна), поэтому uPad. подсказывает .vel/.pitch
// сразу по мере набора тега в паттерне, без нажатия Play.
//
// Скорость затухания (tau, в секундах) НЕ гадается по названию инструмента —
// если у события паттерна задан .release()/.decay() (Strudel ADSR), берём его
// как есть, это и есть реальная огибающая звука. Нет — используем дефолт типа
// (d гаснет быстро, i — плавно). uEnergy/uHue/uPitch — глобальные, считаются
// из КАЖДОГО события одинаково, тегов не требуют.

export const uniforms = {
  uTime: 0,
  uPitch: 0,    // высота последней ноты вообще (класс в октаве 0..1)
  uHue: 0,      // оттенок, плавно ведём за нотой
  uEnergy: 0,   // плотность/громкость потока -> прокси секции (интро..дроп)
  uBeat: 0, uLoop: 0, uBeatFrac: 0,
};
const GLOBAL_KEYS = new Set(Object.keys(uniforms));

// --- типы каналов -------------------------------------------------------
// channels(base) получает уже готовое имя юниформа ("u" + Имя тега) и
// возвращает { ключ: 'level'|'pitch' }. 'level' гаснет по tau, 'pitch' держится.
const KIND_SPECS = {
  d: { // удар: только громкость
    defaultTau: 0.12,
    cap: 1.5,
    channels: (base) => ({ [base]: 'level' }),
  },
  i: { // инструмент: велосити + питч, поля одной структуры
    defaultTau: 0.35,
    cap: 1.0,
    channels: (base) => ({ [base + '.vel']: 'level', [base + '.pitch']: 'pitch' }),
  },
  p: { // только питч, держит значение
    defaultTau: null,
    cap: 1.0,
    channels: (base) => ({ [base]: 'pitch' }),
  },
};
const STRUCT_NAME = 'AVInstrument'; // имя GLSL-структуры для i-каналов (.vel/.pitch)

const TAG_SHAPE = /^([a-z]+)([A-Z][A-Za-z0-9]*)$/;
function parseTag(tag) {
  const m = TAG_SHAPE.exec(tag);
  return m ? { prefix: m[1], name: m[2] } : null;
}

const TAG_IN_CODE_RE = /\.vis\(\s*(['"])([^'"]+)\1\s*\)/g;

// достаёт все .vis("...") из текста паттерна и разбирает каждый тег.
// Чистая функция — без побочных эффектов, можно дёргать на каждый кейстрок.
function scan(code) {
  const found = new Set();
  TAG_IN_CODE_RE.lastIndex = 0;
  let m;
  while ((m = TAG_IN_CODE_RE.exec(code || ''))) found.add(m[2]);

  const parsed = [];
  for (const tag of found) {
    const p = parseTag(tag);
    if (!p) {
      parsed.push({ tag, error: `тег .vis("${tag}") не распознан — нужен формат префикс+Имя, например dKick` });
      continue;
    }
    const spec = KIND_SPECS[p.prefix];
    if (!spec) {
      parsed.push({ tag, error: `тег .vis("${tag}"): неизвестный префикс "${p.prefix}" (доступны: ${Object.keys(KIND_SPECS).join(', ')})` });
      continue;
    }
    parsed.push({ tag, prefix: p.prefix, name: p.name, spec });
  }
  return parsed;
}

// раздаёт готовые имена юниформов ("u"+Имя), отсекая коллизии (два тега -> одно Имя)
function resolveBases(parsedTags) {
  const usedBase = new Map(); // base -> tag, который его занял
  const resolved = [];
  const warnings = [];
  for (const item of parsedTags) {
    if (item.error) { warnings.push(item.error); continue; }
    const base = 'u' + item.name;
    if (usedBase.has(base)) {
      warnings.push(`тег .vis("${item.tag}"): юниформ ${base} уже занят тегом "${usedBase.get(base)}" — пропущен`);
      continue;
    }
    usedBase.set(base, item.tag);
    resolved.push({ ...item, base });
  }
  return { resolved, warnings };
}

// tag -> { spec, chans: {ключ: 'level'|'pitch'} }
const channelIndex = new Map();
// ключ уровня -> текущий tau в секундах (обновляется на каждый хит по ADSR события)
const tauByKey = {};

// Пересобрать набор каналов из ИСХОДНОГО текста паттерна.
// Вызывается перед каждой компиляцией шейдера (main.js), чтобы юниформы,
// которых требует текущий текст паттерна, существовали к моменту сборки шейдера.
// Возвращает { tags, warnings } — warnings стоит показать пользователю в лог.
export function syncTags(code) {
  const { resolved, warnings } = resolveBases(scan(code));

  // сбрасываем всё динамическое (глобальные каналы не трогаем)
  for (const k of Object.keys(uniforms)) {
    if (!GLOBAL_KEYS.has(k)) delete uniforms[k];
  }
  channelIndex.clear();
  for (const k of Object.keys(tauByKey)) delete tauByKey[k];

  for (const item of resolved) {
    const chans = item.spec.channels(item.base);
    for (const [key, kind] of Object.entries(chans)) {
      uniforms[key] = 0;
      if (kind === 'level') tauByKey[key] = item.spec.defaultTau;
    }
    channelIndex.set(item.tag, { spec: item.spec, chans });
  }
  return { tags: resolved.map((r) => r.tag), warnings };
}

// Каталог для автокомплита в редакторе шейдера:
// [{ name: 'uPad', type: 'AVInstrument', fields: ['vel','pitch'] }, { name: 'uKick', type: 'float', fields: null }, ...].
// Чистая функция (не мутирует состояние) — можно звать на живой текст паттерна на каждый кейстрок.
export function scanUniformCatalog(code) {
  const { resolved } = resolveBases(scan(code));
  const catalog = resolved.map((r) => (
    r.prefix === 'i'
      ? { name: r.base, type: STRUCT_NAME, fields: ['vel', 'pitch'] }
      : { name: r.base, type: 'float', fields: null }
  ));
  for (const g of GLOBAL_KEYS) catalog.push({ name: g, type: 'float', fields: null });
  catalog.push({ name: 'uResolution', type: 'vec2', fields: null });
  return catalog;
}

// GLSL-объявления для текущего набора юниформов (глобальные float + один общий
// struct-тип для всех i-каналов + per-тег uniform-ы). Дергается renderer.js
// при каждой компиляции шейдера — ключи с точкой ("uPad.vel") группируются
// в структуру, обычные ключи объявляются как float.
export function shaderUniformDecls() {
  const structBases = [];
  const flats = [];
  for (const key of Object.keys(uniforms)) {
    const dot = key.indexOf('.');
    if (dot === -1) { flats.push(key); continue; }
    const base = key.slice(0, dot);
    if (!structBases.includes(base)) structBases.push(base);
  }
  let s = '';
  if (structBases.length) s += `struct ${STRUCT_NAME} { float vel; float pitch; };\n`;
  for (const k of flats) s += `uniform float ${k};\n`;
  for (const base of structBases) s += `uniform ${STRUCT_NAME} ${base};\n`;
  return s;
}

let hueTarget = 0;
const ENERGY_TAU = 0.47;  // ~= старое 0.965/кадр при 60fps, переведено в секунды
const HUE_TAU = 0.2;      // ~= старое 0.08/кадр при 60fps

// dt в секундах (реальное время кадра, НЕ подразумевает 60fps) -> гасит
// огибающие и ведёт hue к цели. Питч-каналы (kind:'pitch') не гаснут вообще.
export function decayUniforms(dt) {
  dt = (typeof dt === 'number' && isFinite(dt)) ? Math.max(0, Math.min(0.25, dt)) : 0.016;

  for (const key in tauByKey) {
    const tau = tauByKey[key];
    if (!tau) continue;
    uniforms[key] *= Math.exp(-dt / tau);
    if (uniforms[key] < 0.0005) uniforms[key] = 0;
  }

  uniforms.uEnergy *= Math.exp(-dt / ENERGY_TAU);
  if (uniforms.uEnergy < 0.0005) uniforms.uEnergy = 0;

  let d = hueTarget - uniforms.uHue;
  d -= Math.round(d);                          // в диапазон [-0.5, 0.5]
  const k = 1 - Math.exp(-dt / HUE_TAU);
  uniforms.uHue = (uniforms.uHue + d * k + 1) % 1;
}

const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function noteNameToMidi(str) {
  const m = /^([a-gA-G])([#bsf]*)(-?\d+)?$/.exec(str.trim());
  if (!m) return null;
  let semi = NOTE[m[1].toLowerCase()];
  for (const ch of m[2]) { if (ch === '#' || ch === 's') semi++; else if (ch === 'b' || ch === 'f') semi--; }
  const oct = m[3] !== undefined ? parseInt(m[3], 10) : 3;
  return semi + (oct + 1) * 12;       // c3 -> 48
}
function noteMidi(v) {
  const n = v.note ?? v.n;
  if (typeof n === 'number') return n;
  if (typeof n === 'string') { const m = noteNameToMidi(n); if (m !== null) return m; }
  if (typeof v.freq === 'number') return Math.round(69 + 12 * Math.log2(v.freq / 440));
  return null;
}

const octaveClass = (midi) => (((midi % 12) + 12) % 12) / 12;

// tau канала для конкретного хита: если у события задан .release()/.decay()
// (реальная ADSR-огибающая звука) — берём его, иначе дефолт типа канала.
function clampTau(t) {
  if (typeof t !== 'number' || !isFinite(t) || t <= 0) return null;
  return Math.min(8, Math.max(0.02, t));
}
function estimateTau(v, fallback) {
  return clampTau(v.release) ?? clampTau(v.decay) ?? fallback;
}

function applyChannel(entry, v, g, midi) {
  const { spec, chans } = entry;
  for (const [key, kind] of Object.entries(chans)) {
    if (kind === 'level') {
      const level = Math.min(spec.cap, 0.2 + g);
      uniforms[key] = Math.max(uniforms[key], level);
      tauByKey[key] = estimateTau(v, spec.defaultTau);
    } else if (kind === 'pitch') {
      if (midi !== null) uniforms[key] = octaveClass(midi);
    }
  }
}

export function handleHap(hap) {
  const v = hap?.value ?? {};
  const tag = typeof v.vis === 'string' ? v.vis : '';
  const g = typeof v.gain === 'number' ? v.gain : 0.7;   // громкость события
  const midi = noteMidi(v);

  if (tag) {
    const entry = channelIndex.get(tag);
    if (entry) applyChannel(entry, v, g, midi);
    // тег без известного канала уже отловлен в syncTags как warning — тут молчим
  }

  // глобальные питч/цвет/энергия — всегда, независимо от тега
  if (midi !== null) {
    uniforms.uPitch = octaveClass(midi);
    hueTarget = uniforms.uPitch;
  }
  uniforms.uEnergy = Math.min(1.0, uniforms.uEnergy + g * 0.5);
}
