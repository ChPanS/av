// Визитка: лоу-фай хаус с DnB-брейком + развёрнутый domain-warp шейдер.
// Шейдер использует uKick (пульс), uEnergy (секция интро<->дроп: наезд+фишай+
// сбор облаков к центру), uPad (гармоническое дыхание/яркость), uHue (палитра),
// uSnare/uHat (акценты). Фоновые облака другого цвета летают в обратную сторону.

export const defaultScene = {
  pattern: `setcps(0.42)

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

arrange(
  [4, stack(pad, crackle)],                                    
  [4, stack(pad, bass, crackle, hats)],                        
  [8, stack(pad, bass, kick, clap, hats, ohat, lead, crackle)],
  [4, stack(pad, dnbDrums, dnbBass, lead.gain(0.28), crackle)],
  [4, stack(pad, bass.gain(0.5), hats.gain(0.22), crackle)]    
)`,

  shader: `vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * uResolution) / uResolution.y;
  vec2 uv0 = uv;
  vec3 col = vec3(0.0);
  float pad  = clamp(uPad, 0.0, 1.0);
  
  uv *= 1.0 - uKick * 0.15;

  for (float i = 0.0; i < 4.0; i++) {
    uv = fract(uv * 1.5 - pad) - 0.5;
    float d = length(uv) * exp(-length(uv0));

    vec3 c = hsv2rgb(vec3(uHue + i * 0.05 + uTime * 0.02, 0.7, 1.0));

    d = sin(d * 8.0 + uTime + uPitch * 6.28) / 8.0;
    d = abs(d);
    d = pow(0.012 / d, 1.3);

    col += c * d;
  }

  col += vec3(uSnare) * 0.25;

  col += vec3(0.1, 0.2, 0.3) * uHat * length(uv0);

  fragColor = vec4(col, 1.0);
}`,
};
