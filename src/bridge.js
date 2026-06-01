// Мост музыка -> визуал.
//
// Каналы делятся на три типа:
//  1) Ударные — импульсы (всплеск + быстрый спад): uKick uSnare uClap uHat uOpenHat
//  2) Инструменты — у каждого ДВА юниформа:
//       u<Name>Vel   — велосити-огибающая, плавно спадает 1->0 (как звук ноты)
//       u<Name>Pitch — высота последней ноты этого инструмента (класс в октаве 0..1)
//     Инструменты: Pad Atmo Key Lead Bass Arp Fx Vox
//  3) Глобальные — uTime uPitch uHue uEnergy uPad(совместимость) uBeat uLoop uBeatFrac
//
// Приоритет маршрутизации: явный тег .vis("...") важнее автоугадывания по имени.
// Тонкие каналы (atmosphere/lead/arp/fx/vox) задаются ТОЛЬКО тегом — по имени
// их не угадать; автоугадывание даёт грубое деление (kick/snare/clap/hat/oh/bass/pad/key).

export const uniforms = {
  uTime: 0,
  // --- ударные (импульсы, быстрый спад) ---
  uKick: 0, uSnare: 0, uClap: 0, uHat: 0, uOpenHat: 0,
  // --- инструменты: велосити (плавный спад) + питч (держится) ---
  uPadVel: 0,  uPadPitch: 0,
  uAtmoVel: 0, uAtmoPitch: 0,
  uKeyVel: 0,  uKeyPitch: 0,
  uLeadVel: 0, uLeadPitch: 0,
  uBassVel: 0, uBassPitch: 0,
  uArpVel: 0,  uArpPitch: 0,
  uFxVel: 0,   uFxPitch: 0,
  uVoxVel: 0,  uVoxPitch: 0,
  // --- глобальные ---
  uPitch: 0,    // высота последней ноты вообще (класс в октаве 0..1)
  uHue: 0,      // оттенок, плавно ведём за нотой
  uEnergy: 0,   // плотность/громкость потока -> прокси секции (интро..дроп)
  uPad: 0,      // СОВМЕСТИМОСТЬ: общая гармоническая огибающая (старые шейдеры)
  uBeat: 0, uLoop: 0, uBeatFrac: 0,
};

let hueTarget = 0;

// что и как быстро гаснет (питчи НЕ гаснут — держат последнее значение;
// uTime/uBeat/uLoop/uBeatFrac выставляются каждый кадр в рендерере)
const decay = {
  // ударные — быстро
  uKick: 0.86, uSnare: 0.85, uClap: 0.85, uHat: 0.80, uOpenHat: 0.82,
  // инструменты — плавный «релиз» (атмосфера тянется дольше всех)
  uPadVel: 0.94, uAtmoVel: 0.965, uKeyVel: 0.90, uLeadVel: 0.91,
  uBassVel: 0.92, uArpVel: 0.88,  uFxVel: 0.93,  uVoxVel: 0.93,
  // глобальные огибающие
  uEnergy: 0.965, uPad: 0.94,
};

export function decayUniforms() {
  for (const k in decay) {
    uniforms[k] *= decay[k];
    if (uniforms[k] < 0.0001) uniforms[k] = 0;
  }
  // плавно ведём hue к цели по кратчайшему пути на цветовом круге
  let d = hueTarget - uniforms.uHue;
  d -= Math.round(d);                 // в диапазон [-0.5, 0.5]
  uniforms.uHue = (uniforms.uHue + d * 0.08 + 1) % 1;
}

function soundName(v) {
  const s = v.s ?? v.sound ?? '';
  return typeof s === 'string' ? s.toLowerCase() : '';
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

// удар инструмента: велосити (с учётом громкости) + питч (если есть нота)
function hitInstrument(name, g, midi) {
  const velKey = 'u' + name + 'Vel';
  const pitKey = 'u' + name + 'Pitch';
  uniforms[velKey] = Math.max(uniforms[velKey], Math.min(1, 0.2 + g));
  if (midi !== null) uniforms[pitKey] = octaveClass(midi);
}

// совместимость со старыми шейдерами: общая гармоническая огибающая
function nudgePad(amount = 0.2) {
  uniforms.uPad = Math.min(1.2, uniforms.uPad + amount);
}

// угадать группу по имени звука (когда тега .vis нет). Возвращает '' если не понятно.
function guessGroup(s) {
  if (!s) return '';
  if (s.includes('bd')) return 'kick';
  if (s.includes('cp') || s.includes('clap')) return 'clap';
  if (s.includes('sn') || s.includes('rim')) return 'snare';
  if (s.includes('oh') || s.includes('open')) return 'oh';
  if (s.includes('hh') || s.includes('hat')) return 'hat';
  if (s.includes('bass') || s.includes('sub') || s.includes('reese') || s.includes('808')) return 'bass';
  if (/piano|epiano|rhodes|keys|\bkey\b/.test(s)) return 'key';
  if (/pad|string|atmos/.test(s)) return 'pad';
  if (/saw|tri|squ|sine|super|gm_/.test(s)) return 'pad';  // прочие синты -> pad
  return '';
}

// маршрутизация группы в нужный канал
function route(group, g, midi) {
  switch (group) {
    // --- ударные ---
    case 'kick': case 'bd':
      uniforms.uKick = Math.max(uniforms.uKick, Math.min(1.5, 0.6 + g)); break;
    case 'snare': case 'sn':
      uniforms.uSnare = Math.max(uniforms.uSnare, g); break;
    case 'clap': case 'cp':
      uniforms.uClap = Math.max(uniforms.uClap, g); break;
    case 'hat': case 'hh': case 'closedhat':
      uniforms.uHat = Math.min(1, uniforms.uHat + g * 0.8); break;
    case 'oh': case 'openhat':
      uniforms.uOpenHat = Math.min(1, uniforms.uOpenHat + g * 0.8); break;
    // --- инструменты ---
    case 'pad':
      hitInstrument('Pad', g, midi); nudgePad(0.2); break;
    case 'atmosphere': case 'atmo':
      hitInstrument('Atmo', g, midi); nudgePad(0.12); break;
    case 'key': case 'keys': case 'chord':
      hitInstrument('Key', g, midi); nudgePad(0.2); break;
    case 'lead': case 'melody':
      hitInstrument('Lead', g, midi); nudgePad(0.15); break;
    case 'bass': case 'sub':
      hitInstrument('Bass', g, midi); break;
    case 'arp':
      hitInstrument('Arp', g, midi); nudgePad(0.12); break;
    case 'fx':
      hitInstrument('Fx', g, midi); break;
    case 'vox': case 'vocal':
      hitInstrument('Vox', g, midi); break;
    default: break;
  }
}

export function handleHap(hap) {
  const v = hap?.value ?? {};
  const s = soundName(v);
  const g = typeof v.gain === 'number' ? v.gain : 0.7;   // громкость события
  const midi = noteMidi(v);

  // явный тег .vis важнее автоугадывания
  const group = (typeof v.vis === 'string' && v.vis) ? v.vis.toLowerCase() : guessGroup(s);
  route(group, g, midi);

  // глобальные питч/цвет — всегда, независимо от группы
  if (midi !== null) {
    uniforms.uPitch = octaveClass(midi);
    hueTarget = uniforms.uPitch;
  }
  uniforms.uEnergy = Math.min(1.0, uniforms.uEnergy + g * 0.5);
}
