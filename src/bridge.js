// Мост музыка -> визуал.
// Ключевая идея: вклад события масштабируется его громкостью (gain),
// поэтому тихий винил почти не влияет, а громкий кик/дроп — сильно.
// Это делает uEnergy честным индикатором плотности (интро vs дроп),
// а uPad — отдельной сустейн-огибающей гармонии (пэд/бас/синты).

export const uniforms = {
  uTime: 0,
  uKick: 0,   // удар бочки (масштаб от громкости), быстрый спад
  uSnare: 0,  // снейр/клэп
  uHat: 0,    // хэты
  uPitch: 0,  // высота последней ноты в октаве, 0..1
  uHue: 0,    // оттенок (сглаженно ведём за гармонией)
  uEnergy: 0, // плотность/громкость потока -> прокси секции (интро..дроп)
  uPad: 0,    // сустейн гармонических синтов (пэд)
  uBeat: 0,   // позиция в лупе в циклах: 0..loopCycles (floor = номер такта)
  uLoop: 0,   // позиция в лупе нормированная: 0..1 (сбрасывается в 0)
  uBeatFrac: 0, // фаза внутри текущего цикла: 0..1
};

let hueTarget = 0;

const decay = {
  uKick: 0.86,
  uSnare: 0.85,
  uHat: 0.80,
  uEnergy: 0.965,
  uPad: 0.94,
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

// применить событие к группе визуала (явной из .vis или угаданной по имени)
function applyGroup(group, g) {
  switch (group) {
    case 'kick': case 'bd':
      uniforms.uKick = Math.max(uniforms.uKick, Math.min(1.5, 0.6 + g)); break;
    case 'snare': case 'sn': case 'clap': case 'cp':
      uniforms.uSnare = Math.max(uniforms.uSnare, g); break;
    case 'hat': case 'hh': case 'oh':
      uniforms.uHat = Math.min(1, uniforms.uHat + g * 0.8); break;
    case 'pad': case 'chord': case 'keys':
      uniforms.uPad = Math.min(1.2, uniforms.uPad + 0.25); break;
    case 'bass': case 'sub':
      uniforms.uPad = Math.min(1.2, uniforms.uPad + 0.12); break;
    case 'lead': case 'melody':
      uniforms.uPad = Math.min(1.2, uniforms.uPad + 0.18); break;
    default: break;
  }
}

export function handleHap(hap) {
  const v = hap?.value ?? {};
  const s = soundName(v);
  const g = typeof v.gain === 'number' ? v.gain : 0.7;   // громкость события

  // 1) если пользователь явно пометил группу через .vis("...") — она в приоритете
  if (typeof v.vis === 'string' && v.vis) {
    applyGroup(v.vis.toLowerCase(), g);
  } else {
    // 2) иначе — эвристика по имени звука
    if (s.includes('bd')) {
      uniforms.uKick = Math.max(uniforms.uKick, Math.min(1.5, 0.6 + g));
    } else if (s.includes('sn') || s.includes('cp') || s.includes('clap')) {
      uniforms.uSnare = Math.max(uniforms.uSnare, g);
    } else if (s.includes('hh') || s.includes('hat') || s.includes('oh')) {
      uniforms.uHat = Math.min(1, uniforms.uHat + g * 0.8);
    } else if (/saw|tri|squ|sine|gm_|super|pad|epiano|piano|rhodes|string/.test(s)) {
      // мелодические/гармонические синты и инструменты -> пэд
      uniforms.uPad = Math.min(1.2, uniforms.uPad + 0.2);
    }
  }

  // ноты (высота/цвет) — всегда, независимо от группы
  const midi = noteMidi(v);
  if (midi !== null) {
    uniforms.uPitch = (((midi % 12) + 12) % 12) / 12;
    hueTarget = uniforms.uPitch;
  }

  uniforms.uEnergy = Math.min(1.0, uniforms.uEnergy + g * 0.5);
}
