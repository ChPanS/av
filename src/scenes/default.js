// Визитка: лоу-фай хаус с DnB-брейком + развёрнутый domain-warp шейдер.
// Шейдер использует uKick (пульс), uEnergy (секция интро<->дроп: наезд+фишай+
// сбор облаков к центру), uPad (гармоническое дыхание/яркость), uHue (палитра),
// uSnare/uHat (акценты). Фоновые облака другого цвета летают в обратную сторону.

export const defaultScene = {
  pattern: `setcps(0.42)

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

// domain-warp турбулентность: твоя петля, вынесена в функцию
vec2 warp(vec2 uv, float t, float amt, float fa, float fb){
  for(float i=1.0;i<8.0;i++){
    uv.x += amt/i * cos(i*fa*uv.y + t);
    uv.y += amt/i * cos(i*fb*uv.x + t);
  }
  return uv;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 res = uResolution;
  vec2 uv = (2.0*fragCoord - res)/min(res.x,res.y);

  float sec  = smoothstep(0.25, 0.9, uEnergy); // 0 интро .. 1 дроп
  float pad  = clamp(uPad, 0.0, 1.0);
  float kick = uKick;

  // камера: интро — широкий дрейф; дроп — наезд к центру + микро-удар по кику
  float zoom = mix(1.35, 0.78, sec) * (1.0 - kick*0.06);
  vec2 cuv = uv * zoom;
  float center = smoothstep(1.3, 0.0, length(uv));

  // ФОН: облака другого цвета, дрейф в обратную сторону, всегда живые
  vec2 buv = warp(cuv*1.25, -uTime*0.18, 0.55, 2.0, 1.3);
  float bf = 0.09 / max(abs(sin(uTime*0.3 - buv.x - buv.y)), 0.05);
  float bhue = fract(uHue + 0.5 + uTime*0.01);
  vec3 bg = hsv2rgb(vec3(bhue, mix(0.5,0.75,sec), 1.0)) * bf;
  bg *= mix(0.9, 0.5, sec);                    // на дропе фон тусклее

  // ПЕРЕДНИЙ слой: на дропе стягивается к центру (фишай) и пульсирует
  vec2 fuv = cuv * mix(1.0, 0.5, sec);
  float r = length(fuv);
  fuv *= 1.0 + sec*0.7*r*r;                     // баррель/фишай, крепнет к дропу
  vec2 wuv = warp(fuv, uTime*0.5, 0.6, 2.5, 1.5);
  float ff = 0.1 / max(abs(sin(uTime - wuv.x - wuv.y)), 0.05);

  ff *= 1.0 + kick*(0.4 + sec*1.6)*mix(0.4,1.0,center);  // пульс под кик
  ff *= mix(1.0, 0.5 + 1.1*center, sec);                 // свечение в центр на дропе

  float fhue = fract(uHue + pad*0.06 + uTime*0.008);
  vec3 fg = hsv2rgb(vec3(fhue, mix(0.4,0.95,sec), 1.0)) * ff;

  vec3 col = bg + fg;
  col *= 0.85 + pad*0.5;                         // дыхание пэда
  col += vec3(uSnare)*0.22;                      // блик снейра
  col += hsv2rgb(vec3(fract(uHue+0.15),0.6,1.0))*uHat*0.22*(1.0-center); // искры хэтов
  col *= 1.0 - 0.25*dot(uv,uv);                  // виньетка
  col = pow(max(col,0.0), vec3(0.85));

  fragColor = vec4(col, 1.0);
}`,
};
