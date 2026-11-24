import { asciiPresets } from './ascii.js';

const fallback = 'void mainImage(out vec4 color, in vec2 pixel) { color = vec4(pixel / uResolution, 0.3, 1.0); }';

function number(value, min, max, initial) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value))) : initial;
}

function normalize(raw, index) {
  const base = {
    id: String(index + 1),
    name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '',
    visible: raw.visible !== false,
    opacity: number(raw.opacity, 0, 100, 100),
  };
  if (raw.type === 'shader') {
    return { ...base, type: 'shader', code: typeof raw.code === 'string' ? raw.code : fallback };
  }
  const colors = ['#08101d', '#287b78', '#bcffe0'].map((color, i) =>
    /^#[a-f\d]{6}$/i.test(raw.colors?.[i]) ? raw.colors[i] : color);
  return {
    ...base, type: 'ascii', preset: Object.hasOwn(asciiPresets, raw.preset) ? raw.preset : 'flow',
    colors, midpoint: number(raw.midpoint, 1, 99, 50),
    columns: number(raw.columns, 24, 144, 80), warp: number(raw.warp, 0, 100, 35),
    glyphs: typeof raw.glyphs === 'string' ? raw.glyphs.slice(0, 48) : ' .:-=+*#%@',
    transparent: raw.transparent !== false,
    x: number(raw.x, 0, 100, 50), y: number(raw.y, 0, 100, 50),
    scale: number(raw.scale, 10, 200, 100),
    signal: typeof raw.signal === 'string' ? raw.signal : '', amount: number(raw.amount, 0, 100, 75),
  };
}

export function createLayers($, loaded, editor, catalog) {
  const restored = Array.isArray(loaded.layers)
    ? loaded.layers.filter(layer => layer && ['shader', 'ascii'].includes(layer.type)) : null;
  const layers = (restored ?? [{ type: 'shader', code: loaded.shader }]).map(normalize);
  let serial = layers.length;
  let selected = layers.at(-1)?.id;
  let editing = layers.find(layer => layer.type === 'shader');
  const pickShader = $('shader-layer');
  const list = $('layer-list');
  const inspector = $('layer-inspector');
  const kind = $('layer-kind');
  const controls = $('layer-controls');
  kind.replaceChildren(new Option('GLSL', 'shader'),
    ...Object.entries(asciiPresets).map(([key, label]) => new Option('ASCII · ' + label, key)));

  const title = layer => layer.name || (layer.type === 'shader' ? 'Shader ' + layer.id : asciiPresets[layer.preset]);
  function saveCode() {
    if (editing) editing.code = editor.get();
  }

  function selectShader(layer) {
    if (layer === editing) return;
    saveCode();
    editing = layer;
    editor.set(layer?.code ?? '');
    editor.errors(null);
  }

  function refreshSignals() {
    const select = inspector.querySelector('[data-layer-field=signal]');
    const layer = layers.find(item => item.id === selected);
    if (!select || !layer) return;
    const options = catalog().filter(item => item.kind === 'tag')
      .flatMap(item => item.fields ? item.fields.map(field => item.name + '.' + field) : [item.name]);
    const key = JSON.stringify([options, layer.signal]);
    if (select.dataset.current === key) return;
    select.dataset.current = key;
    select.replaceChildren(new Option('None', ''), ...options.map(value => new Option(value, value)));
    if (layer.signal && !options.includes(layer.signal)) select.add(new Option(layer.signal + ' (missing)', layer.signal));
    select.value = layer.signal;
  }

  function render() {
    const shaders = layers.filter(layer => layer.type === 'shader');
    pickShader.replaceChildren(...shaders.map(layer => new Option(title(layer), layer.id)));
    pickShader.value = editing?.id ?? '';
    pickShader.disabled = !shaders.length;
    const layer = layers.find(item => item.id === selected);
    list.replaceChildren(...[...layers].reverse().map(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = (item.visible ? '' : 'Hidden · ') + title(item);
      button.setAttribute('aria-pressed', String(item === layer));
      button.onclick = () => {
        selected = item.id;
        if (item.type === 'shader') selectShader(item);
        render();
      };
      return button;
    }));
    const index = layers.indexOf(layer);
    $('layer-up').disabled = index < 0 || index === layers.length - 1;
    $('layer-down').disabled = index <= 0;
    $('layer-remove').disabled = !layer;
    inspector.replaceChildren();
    if (!layer) return;
    inspector.append($('layer-settings').content.cloneNode(true));
    if (layer.type !== 'ascii') inspector.querySelector('[data-ascii]').remove();
    else inspector.querySelector('[data-layer-field=preset]').replaceChildren(
      ...Object.entries(asciiPresets).map(([key, label]) => new Option(label, key)));
    for (const input of inspector.querySelectorAll('[data-layer-field], [data-color]')) {
      const key = input.dataset.layerField;
      if (key === 'signal') continue;
      if (input.type === 'checkbox') input.checked = layer[key];
      else input.value = key ? layer[key] : layer.colors[Number(input.dataset.color)];
      input.oninput = () => {
        const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? input.valueAsNumber : input.value;
        if (key) layer[key] = value;
        else layer.colors[Number(input.dataset.color)] = value;
        if (key === 'visible' || key === 'preset') render();
      };
    }
    const signal = inspector.querySelector('[data-layer-field=signal]');
    if (signal) signal.onchange = event => { layer.signal = event.target.value; };
    refreshSignals();
  }

  function move(delta) {
    const index = layers.findIndex(layer => layer.id === selected);
    if (index < 0 || !layers[index + delta]) return;
    [layers[index], layers[index + delta]] = [layers[index + delta], layers[index]];
    render();
  }

  pickShader.onchange = () => {
    const layer = layers.find(item => item.id === pickShader.value);
    selectShader(layer);
    selected = layer.id;
    render();
  };
  $('layer-add').onclick = () => {
    saveCode();
    const type = kind.value === 'shader' ? 'shader' : 'ascii';
    const layer = normalize({ type, preset: kind.value, code: editing?.code ?? loaded.shader }, serial++);
    layers.push(layer);
    selected = layer.id;
    if (type === 'shader') selectShader(layer);
    render();
  };
  $('layer-up').onclick = () => move(1);
  $('layer-down').onclick = () => move(-1);
  $('layer-remove').onclick = () => {
    const index = layers.findIndex(layer => layer.id === selected);
    if (index < 0) return;
    const [removed] = layers.splice(index, 1);
    if (removed === editing) selectShader(layers.find(layer => layer.type === 'shader'));
    selected = layers[Math.min(index, layers.length - 1)]?.id;
    render();
  };

  editor.set(editing?.code ?? '');
  render();
  return {
    items: () => layers,
    snapshot() { saveCode(); return layers; },
    shaderKey() {
      saveCode();
      return JSON.stringify(layers.filter(layer => layer.type === 'shader').map(({ id, code }) => [id, code]).sort());
    },
    showError(id, error) {
      const layer = layers.find(item => item.id === id);
      if (layer) {
        selectShader(layer);
        selected = layer.id;
        render();
      }
      editor.errors(error);
      return layer ? title(layer) : 'Shader';
    },
    lock(value) { controls.disabled = value; pickShader.disabled = value || !editing; },
    refreshSignals,
  };
}
