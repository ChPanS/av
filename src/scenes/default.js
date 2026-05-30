// Визитка: лоу-фай хаус с DnB-брейком + развёрнутый domain-warp шейдер.
// Шейдер использует uKick (пульс), uEnergy (секция интро<->дроп: наезд+фишай+
// сбор облаков к центру), uPad (гармоническое дыхание/яркость), uHue (палитра),
// uSnare/uHat (акценты). Фоновые облака другого цвета летают в обратную сторону.

export const defaultScene = {
  pattern: `// loop: 24   (длина аранжировки в циклах -> сброс uBeat/uLoop)
setcps(0.42)

// ── палитра ──────────────────────────────────────────────
const harmony = "<[c3,eb3,g3,bb3] [ab2,c3,eb3,g3] [eb3,g3,bb3,c4] [f2,ab2,c3,eb3]>"
const roots   = "<c2 ab1 eb2 f2>"

const pad = note(harmony)
  .s("sawtooth").lpf(sine.range(650,1500).slow(8)).lpq(6)
  .attack(0.04).release(0.6).room(0.6).coarse(2).gain(0.5)

const bass = note(roots)
  .s("sawtooth").lpf(420).lpq(3).attack(0.01).release(0.3).gain(0.7)

const crackle = s("hh*16").gain(rand.range(0.02,0.07)).hpf(6500).pan(rand)

const kick  = s("bd*4").gain(0.9)
const clap  = s("~ cp ~ cp").gain(0.55).room(0.3)
const hats  = s("[~ hh]*4").gain(0.35).pan(sine.range(0.35,0.65).fast(2))
const ohat  = s("~ ~ ~ oh").gain(0.28)

const lead = note("<g4 bb4 c5 bb4 g4 f4 eb4 f4>")
  .s("triangle").lpf(2600).gain(0.4)
  .delay(0.4).delaytime(0.1875).delayfeedback(0.3).room(0.4)

const dnbDrums = stack(
  s("bd ~ ~ ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ ~ ~").gain(0.9),
  s("~ ~ ~ ~ sn ~ ~ ~ ~ ~ ~ ~ sn ~ ~ ~").gain(0.7).room(0.2),
  s("hh*16").gain(saw.range(0.15,0.4)).pan(rand)
)
const dnbBass = note(roots).s("sawtooth").lpf(500).lpq(5)
  .struct("x ~ ~ x ~ ~ x ~").gain(0.75)

// ── аранжировка (24 цикла, бесшовная петля) ──────────────
arrange(
  [4, stack(pad, crackle)],                                       // intro
  [4, stack(pad, bass, crackle, hats)],                           // build
  [8, stack(pad, bass, kick, clap, hats, ohat, lead, crackle)],   // house drop
  [4, stack(pad, dnbDrums, dnbBass, lead.gain(0.28), crackle)],   // DnB break
  [4, stack(pad, bass.gain(0.5), hats.gain(0.22), crackle)]       // outro -> intro
)`,

  shader: `// ── палитра ──────────────────────────────────────────────
vec3 hsv2rgb(vec3 c){
  vec3 p = abs(fract(c.xxx + vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0);
  return c.z * mix(vec3(1.0), clamp(p-1.0,0.0,1.0), c.y);
}

// domain-warp турбулентность (твоя петля)
vec2 warp(vec2 uv, float t, float amt, float fa, float fb){
  for(float i=1.0;i<8.0;i++){
    uv.x += amt/i * cos(i*fa*uv.y + t);
    uv.y += amt/i * cos(i*fb*uv.x + t);
  }
  return uv;
}

// поле филаментов (sin ограничен -> значение всегда конечно, без NaN)
float field(vec2 uv, float t){
  return 0.1 / max(abs(sin(t - uv.x - uv.y)), 0.06);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 res = uResolution;
  vec2 uv = (2.0*fragCoord - res)/min(res.x,res.y);

  float sec  = smoothstep(0.2, 0.85, uEnergy);  // 0 интро .. 1 дроп
  float pad  = clamp(uPad, 0.0, 1.0);
  float kick = uKick;
  float d    = length(uv);

  // ── ФОН: облака другого цвета, дрейф в обратную сторону, весь кадр ──
  vec2 bwarp = warp(uv*1.2, -uTime*0.20, 0.55, 2.0, 1.3);
  vec3 bg = hsv2rgb(vec3(fract(uHue+0.5+uTime*0.01), 0.6, 1.0)) * field(bwarp, uTime*0.3);
  bg *= mix(0.85, 0.45, sec);                    // на дропе фон тусклее

  // ── ЦЕНТРАЛЬНЫЙ ШАР: формируется к дропу, пульсирует под кик ──
  float R = mix(0.0, 1.05, sec) + pad*0.04;      // радиус: 0 в интро -> растёт
  R *= 1.0 + kick*0.18;                          // кик «надувает» шар
  float ball = smoothstep(R, R-0.45, d);         // 1 в ядре, мягкий край к R

  // выпуклая линза-фишай внутри шара
  vec2 sp = uv / max(R, 0.001);
  float z = sqrt(max(0.0, 1.0 - dot(sp, sp)));
  vec2 luv = sp / (z + 0.7);                      // центр выпучивается наружу
  vec2 fwarp = warp(luv*1.4, uTime*0.6, 0.6, 2.5, 1.5);
  float ff = field(fwarp, uTime) * (1.0 + kick*1.6);   // пульс под кик
  vec3 sphere = hsv2rgb(vec3(fract(uHue + pad*0.06), mix(0.5,0.95,sec), 1.0)) * ff;

  // стеклянный ободок по краю шара
  float rim = smoothstep(0.045, 0.0, abs(d - R)) * sec;
  sphere += vec3(1.0) * rim * (0.3 + kick*0.4);

  // ── композит ──
  vec3 col = mix(bg, sphere, ball);
  col *= 0.85 + pad*0.5;                          // дыхание пэда
  col += vec3(uSnare)*0.22;                       // блик снейра
  col += hsv2rgb(vec3(fract(uHue+0.15),0.6,1.0))*uHat*0.20*(1.0-ball); // искры хэтов вокруг
  col *= 1.0 - 0.25*dot(uv,uv);                   // виньетка
  col = pow(max(col,0.0), vec3(0.85));

  fragColor = vec4(col, 1.0);
}`,
};
