import { uniforms, uniformSource } from './bridge.js';

export function createMonitor(panel, list, description, pattern) {
  const graphs = new Map();
  let selected = '';
  let previous = 0;

  function graph(key) {
    const button = document.createElement('button');
    button.className = 'signal';
    const label = document.createElement('span');
    const canvas = document.createElement('canvas');
    canvas.width = 104;
    canvas.height = 25;
    button.append(label, canvas);
    button.onclick = () => {
      selected = key;
      description.value = uniformSource(key);
    };
    list.append(button);
    return { button, label, canvas, ctx: canvas.getContext('2d'), values: [] };
  }

  return now => {
    if (!panel.open || now - previous < 32) return;
    previous = now;
    const keys = Object.keys(uniforms).filter(key => uniformSource(key));
    for (const [key, entry] of graphs) {
      if (!keys.includes(key)) {
        entry.button.remove();
        graphs.delete(key);
      }
    }
    if (!keys.includes(selected)) selected = keys[0] ?? '';
    const signal = selected && uniformSource(selected);
    const tag = signal && signal.match(/"([^"]+)"/)?.[1];
    const match = tag && [...pattern().matchAll(/\.vis\(\s*(['"])([^'"]+)\1\s*\)/g)].find(([, , name]) => name === tag);
    const line = match ? pattern().slice(0, match.index).split('\n').length : null;
    description.value = signal ? signal + (line ? ' · Strudel line ' + line : '') : 'Add a .vis("dKick") tag to a pattern.';
    for (const key of keys) {
      if (!graphs.has(key)) graphs.set(key, graph(key));
      const { button, label, canvas, ctx, values } = graphs.get(key);
      const value = uniforms[key] ?? 0;
      values.push(value);
      if (values.length > 64) values.shift();
      label.textContent = key + '  ' + value.toFixed(2);
      button.setAttribute('aria-pressed', String(key === selected));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.strokeStyle = '#c6ff2e';
      values.forEach((sample, index) => {
        const x = index * canvas.width / 63;
        const y = canvas.height - 1 - Math.min(1, Math.max(0, sample)) * (canvas.height - 2);
        if (index) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
  };
}
