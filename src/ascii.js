const unit = value => Math.max(0, Math.min(1, value));

export const asciiPresets = {
  flow: 'Liquid field',
  rings: 'Orbits',
  lattice: 'Lattice',
  storm: 'Electric cloud',
};

function sourceLight(source, x, y, time, aspect) {
  const radius = Math.hypot((x - 0.5) * Math.min(aspect, 4), y - 0.5);
  switch (source) {
    case 'rings':
      return (0.5 + 0.5 * Math.cos(radius * 38 - time * 3)) ** 4 * Math.exp(-radius * 0.9);
    case 'lattice': {
      const shift = Math.sin(time * 0.6) * 0.5;
      const tiles = Math.sin((x + y * shift) * 29 + time) * Math.cos((y - x * shift) * 27 - time);
      return unit(0.13 + Math.abs(tiles) ** 6 * 0.83);
    }
    case 'storm': {
      const a = Math.sin(x * 11 + Math.cos(y * 9 + time) * 2);
      const b = Math.cos(y * 14 + Math.sin(x * 10 - time) * 3);
      return unit(1 - Math.abs(a + b) * 2) ** 3;
    }
    default:
      return (0.52 + Math.sin(radius * 21 - time * 1.7 + Math.sin(x * 12 + y * 7 + time) * 2) * 0.33)
        * Math.max(0.1, 1 - radius * 0.75);
  }
}

const ramps = new WeakMap();

function palette(layer) {
  const key = layer.colors.join() + ':' + layer.midpoint;
  const previous = ramps.get(layer);
  if (previous?.key === key) return previous.colors;
  const stops = layer.colors.map(hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16)));
  const middle = layer.midpoint / 100;
  const colors = Array.from({ length: 64 }, (_, index) => {
    const position = index / 63;
    const edge = position < middle ? 0 : 1;
    const mix = edge === 0 ? position / middle : (position - middle) / (1 - middle);
    return 'rgb(' + stops[edge].map((value, i) => Math.round(value + (stops[edge + 1][i] - value) * mix)).join(',') + ')';
  });
  ramps.set(layer, { key, colors });
  return colors;
}

export function drawAscii(ctx, layer, width, height, time, uniforms) {
  const gradient = palette(layer);
  const glyphs = Array.from(layer.glyphs || ' .:-=+*#%@');
  const columns = layer.columns;
  const aspect = width / height;
  const rows = Math.max(1, Math.min(160, Math.round(columns / aspect * 0.61)));
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const warp = layer.warp / 100;
  const signal = layer.signal ? unit(uniforms[layer.signal] ?? 0) * layer.amount / 100 : 0;

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = Math.min(cellHeight * 0.95, cellWidth * 1.6) + 'px monospace';
  if (!layer.transparent) {
    ctx.fillStyle = gradient[Math.round(signal * 63)];
    ctx.fillRect(0, 0, width, height);
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = (column + 0.5) / columns;
      const y = (row + 0.5) / rows;
      const u = x + Math.sin(y * 11 + time) * warp * 0.09;
      const v = y + Math.sin(x * 9 - time) * warp * 0.07;
      const light = unit(sourceLight(layer.preset, u, v, time, aspect));
      const character = glyphs[Math.round(light * (glyphs.length - 1))];
      if (character === ' ') continue;
      ctx.fillStyle = gradient[Math.round((light + (1 - light) * signal) * 63)];
      ctx.fillText(character, x * width, y * height);
    }
  }
}
