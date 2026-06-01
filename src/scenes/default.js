// Визитка: лоу-фай хаус с DnB-брейком + развёрнутый domain-warp шейдер.
// Шейдер использует uKick (пульс), uEnergy (секция интро<->дроп: наезд+фишай+
// сбор облаков к центру), uPad (гармоническое дыхание/яркость), uHue (палитра),
// uSnare/uHat (акценты). Фоновые облака другого цвета летают в обратную сторону.

export const defaultScene = {
  pattern: `// loop: 24
setcps(0.42)

const harmony = "<[c3,eb3,g3,bb3] [ab2,c3,eb3,g3] [eb3,g3,bb3,c4] [f2,ab2,c3,eb3]>"
const harmony_2 = "<[[c3,eb3,g3,bb3]*4] [[ab2,c3,eb3,g3]*4] [[eb3,g3,bb3,c4]*4] [[f2,ab2,c3,eb3]*4]>"
const sax_roll = "<[[c4,eb4,g4,bb4] [ab3,c4,eb4,g4] [eb4,g4,bb4,c5] [f3,ab3, c4, eb4]]*4 [[c4,eb4,g4,bb4] [ab3,c4,eb4,g4] [eb4,g4,bb4,c5] [f3,ab3, c4, eb4]]*4 [[c4,eb4,g4,bb4] [ab3,c4,eb4,g4] [eb4,g4,bb4,c5] [f3,ab3, c4, eb4]]*4 [[c4,eb4,g4,bb4] [ab3,c4,eb4,g4] [eb4,g4,bb4,c5] [f3,ab3, c4, eb4]]*4>"
const roots   = "<c2 ab1 eb2 f2>"

const pad = note(harmony)
  .s("gm_fx_atmosphere:1").lpf(sine.range(650,1500).slow(8)).lpq(6)
  .attack(0.04).release(0.6).room(0.6).coarse(2).gain(0.5).vis("pad")

const sax_1 = note(harmony_2)
  .s("gm_baritone_sax").lpf(sine.range(650,1500).slow(8)).lpq(6)
  .attack(0.04).release(0.6).room(0.6).coarse(2).gain(0.5)

const sax_2 = note(sax_roll)
  .s("gm_electric_guitar_muted").hpf(sine.range(650,1500).slow(8)).lpq(6)
  .attack(0.04).release(0.6).room(0.6).coarse(2).gain(0.7)

const bass = note(roots)
  .s("square").lpf(420).lpq(3).attack(0.01).release(0.3).gain(0.7)

const crackle = s("hh*16").gain(rand.range(0.3,0.5)).hpf(6500).pan(rand)

const kick  = s("bd*4").gain(0.9)
const clap  = s("~ cp ~ cp").gain(0.55).room(0.3)
const hats  = s("[~ hh]*4").gain(0.85).pan(sine.range(0.35,0.65).fast(2))
const ohat  = s("~ ~ ~ oh").gain(0.28)

const lead = note("<g4 bb4 c5 bb4 g4 f4 eb4 f4>")
  .s("triangle").lpf(2600).gain(0.4)
  .delay(0.4).delaytime(0.1875).delayfeedback(0.3).room(0.4)

const dnbDrums = stack(
  s("bd ~ ~ ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ ~ ~").gain(0.9),
  s("~ ~ ~ ~ cp ~ ~ ~ ~ ~ ~ ~ cp ~ ~ ~").gain(0.7).room(0.2),
  s("hh*16").gain(saw.range(0.15,0.4)).pan(rand)
)
const dnbBass = note(roots).s("sawtooth").lpf(500).lpq(5)
  .struct("x ~ ~ x ~ ~ x ~").gain(0.75)

const arpp = note("0 2 4 7")
  .scale("minor")
  .fast(4)
  .every(4, rev).gain(1.0)

arrange(
  [4, stack(pad, bass, crackle, sax_2, arpp)],                                     
  [4, stack(pad, bass, crackle, hats, sax_1, sax_2, arpp)],                          
  [8, stack(pad, bass, kick, clap, hats, ohat, lead, crackle, sax_1, sax_2, arpp)],  
  [4, stack(pad, dnbDrums, dnbBass, lead.gain(0.28), crackle, sax_1, sax_2)],   
  [4, stack(pad, bass.gain(0.5), hats.gain(0.22), crackle, sax_1, arpp)]       
)`,

  shader: `precision highp float;

// auxilary
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec2 rotate(vec2 p, float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s,
                s,  c) * p;
}

mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c,s,-s,c);
}

const float pi = acos(-1.0);
const float pi2 = pi*2.0;

vec2 pmod(vec2 p, float r) {
    float a = atan(p.x, p.y) + pi/r;
    float n = pi2 / r;
    a = floor(a/n)*n;
    return p*rot(-a);
}

float box( vec3 p, vec3 b ) {
    vec3 d = abs(p) - b;
    return min(max(d.x,max(d.y,d.z)),0.0) + length(max(d,0.0));
}

float ifsBox(vec3 p) {
    for (int i=0; i<5; i++) {
        p = abs(p) - 1.0;
        p.xy *= rot(uTime*0.3);
        p.xz *= rot(uTime*0.1);
    }
    p.xz *= rot(uTime);
    return box(p, vec3(0.4,0.8,0.3));
}

float map(vec3 p, vec3 cPos) {
    vec3 p1 = p;
    p1.x = mod(p1.x-5., 10.) - 5.;
    p1.y = mod(p1.y-5., 10.) - 5.;
    p1.z = mod(p1.z, 16.)-8.;
    p1.xy = pmod(p1.xy, 5.0);
    return ifsBox(p1);
}

// background
vec4 create_bg(vec2 fragCoord) {
  vec2 p = (fragCoord.xy * 2.0 - uResolution.xy) / min(uResolution.x, uResolution.y);

    vec3 cPos = vec3(0.0,0.0, -3.0 * uTime);
    // vec3 cPos = vec3(0.3*sin(uTime*0.8), 0.4*cos(uTime*0.3), -6.0 * uTime);
    vec3 cDir = normalize(vec3(0.0, 0.0, -1.0));
    vec3 cUp  = vec3(sin(uTime), 1.0, 0.0);
    vec3 cSide = cross(cDir, cUp);

    vec3 ray = normalize(cSide * p.x + cUp * p.y + cDir);

    float acc = 0.0;
    float acc2 = 0.0;
    float t = 0.0;
    for (int i = 0; i < 99; i++) {
        vec3 pos = cPos + ray * t;
        float dist = map(pos, cPos);
        dist = max(abs(dist), 0.02);
        float a = exp(-dist*3.0);
        if (mod(length(pos)+24.0*uTime, 30.0) < 3.0 + uKick * 10.0) {
            a *= 2.0;
            acc2 += a;
        }
        acc += a;
        t += dist * 0.5;
    }

    vec3 col = vec3(acc * 0.01 + uPadVel * 0.3, acc * 0.011 + acc2*0.002 + uPadVel * 0.1, acc * 0.012+ acc2*0.005 + uPadVel * 0.6);
    vec4 fragColor = vec4(col, 1.0 - t * 0.03);
  return fragColor;
}

vec4 create_fg(vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * uResolution) / uResolution.y;
  vec2 uv0 = uv;
  vec3 col = vec3(0.0);
  float pad  = clamp(uPad, 0.0, 1.0);
  
  uv *= 1.0 - uKick * 0.15;
  float angle = uTime / 2.0;
  float sign = 0.0;
  if(int(uBeat) % 4 == 0)
  {
    sign =  1.0;
  }
  else
  {
    sign = -1.0;
  }
  uv = rotate(uv, sign * angle);
  for (float i = 0.0; i < 4.0; i++) {
    uv = fract(uv * 1.5) - 0.5;
    float d = length(uv) * exp(-length(uv0));

    vec3 c = hsv2rgb(vec3(uHue + i * 0.05 + uTime * 0.02, 0.7 * tan(uPadVel), 1.0));

    d = sin(d * 8.0 + uTime * 6.28) / 8.0;
    d = abs(d);
    d = pow(0.012 / d, 1.3);

    col += c * d;
  }

  col += vec3(uSnare) * 0.25;

  col += vec3(0.1, 0.2, 0.3) * length(uv0);

  vec4 fragColor = vec4(col * 0.05, 0.5);
  
  return fragColor;
}


void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 fg = create_fg(fragCoord);
  vec4 bg = create_bg(fragCoord);
  fragColor = mix(fg, bg, fg.a);
}`,
};
