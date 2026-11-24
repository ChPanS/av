import { uniforms, uniformSource } from './bridge.js';

function floatingMonitor(panel) {
  const dock = panel.parentElement;
  const toggle = panel.querySelector('#signal-float');
  const move = panel.querySelector('#signal-move');
  const handle = panel.querySelector('#signal-handle');
  let detached = false;
  let x = 0;
  let y = 0;
  let drag;

  function place(left, top) {
    const maxX = Math.max(8, document.documentElement.clientWidth - panel.offsetWidth - 8);
    const maxY = Math.max(8, document.documentElement.clientHeight - panel.offsetHeight - 8);
    x = Math.min(maxX, Math.max(8, left));
    y = Math.min(maxY, Math.max(8, top));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }

  toggle.onclick = () => {
    const bounds = panel.getBoundingClientRect();
    detached = !detached;
    panel.classList.toggle('floating', detached);
    move.hidden = !detached;
    toggle.textContent = detached ? 'Dock' : 'Detach';
    toggle.setAttribute('aria-pressed', String(detached));
    drag = null;
    if (detached) {
      document.body.append(panel);
      place(bounds.left, bounds.top);
    } else {
      dock.append(panel);
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
    }
    toggle.focus();
  };
  handle.onpointerdown = event => {
    if (!detached || event.button !== 0 || event.target.closest('#signal-float')) return;
    drag = { id: event.pointerId, x: event.clientX - x, y: event.clientY - y };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  handle.onpointermove = event => {
    if (drag?.id === event.pointerId) place(event.clientX - drag.x, event.clientY - drag.y);
  };
  handle.onlostpointercapture = () => { drag = null; };
  move.onkeydown = event => {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!detached || !direction) return;
    event.preventDefault();
    place(x + direction[0] * 18, y + direction[1] * 18);
  };
  const clamp = () => { if (detached) place(x, y); };
  const observer = new ResizeObserver(clamp);
  observer.observe(panel);
  window.addEventListener('resize', clamp);
}

export function createMonitor(panel, list, description, pattern) {
  floatingMonitor(panel);
  const count = panel.querySelector('#signal-count');
  const graphs = new Map();
  let selected = '';
  let previous = 0;

  function graph(key) {
    const button = document.createElement('button');
    button.className = 'signal';
    const label = document.createElement('span');
    const valueLabel = document.createElement('span');
    valueLabel.className = 'signal-value';
    const headline = document.createElement('span');
    headline.className = 'signal-heading';
    label.textContent = key;
    headline.append(label, valueLabel);
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 56;
    button.append(headline, canvas);
    button.onclick = () => {
      selected = key;
      description.value = uniformSource(key);
    };
    list.append(button);
    return { button, valueLabel, canvas, ctx: canvas.getContext('2d'), values: [] };
  }

  return now => {
    if (!panel.open || now - previous < 32) return;
    previous = now;
    const keys = Object.keys(uniforms).filter(key => uniformSource(key));
    const countText = keys.length ? String(keys.length) : '';
    if (count.textContent !== countText) count.textContent = countText;
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
      const { button, valueLabel, canvas, ctx, values } = graphs.get(key);
      const value = uniforms[key] ?? 0;
      values.push(value);
      if (values.length > 64) values.shift();
      valueLabel.textContent = value.toFixed(2);
      button.setAttribute('aria-pressed', String(key === selected));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.strokeStyle = key === selected ? '#c6ff2e' : '#83dbfa';
      ctx.lineWidth = 2;
      values.forEach((sample, index) => {
        const x = (index + 64 - values.length) * (canvas.width - 1) / 63;
        const y = canvas.height - 1 - Math.min(1, Math.max(0, sample)) * (canvas.height - 2);
        if (index) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.lineTo(canvas.width - 1, canvas.height);
      ctx.lineTo((64 - values.length) * (canvas.width - 1) / 63, canvas.height);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, 0, 0, canvas.height);
      fill.addColorStop(0, key === selected ? '#c6ff2e38' : '#83dbfa30');
      fill.addColorStop(1, '#83dbfa00');
      ctx.fillStyle = fill;
      ctx.fill();
    }
  };
}
