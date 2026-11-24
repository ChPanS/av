import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';

const colors = {
  comment: '#a0aabd', keyword: '#dfa4ff', string: '#f3bd82',
  number: '#aee688', operator: '#83dbfa', type: '#83dbfa', variable: '#f1f4fc',
};
const highlight = tagHighlighter(Object.entries(colors).map(([key]) => ({
  tag: tags[key === 'variable' ? 'variableName' : key === 'type' ? 'typeName' : key],
  class: key,
})));

function snapshot(editor, name, full) {
  const { state } = editor.view;
  const selection = state.selection.main;
  const from = full || selection.empty ? 0 : state.doc.lineAt(selection.from).from;
  const to = full ? state.doc.length : selection.empty
    ? state.doc.line(Math.min(16, state.doc.lines)).to
    : state.doc.lineAt(Math.max(selection.from, selection.to - 1)).to;
  const spans = [];
  const tree = ensureSyntaxTree(state, to, 40) ?? syntaxTree(state);
  highlightTree(tree, highlight, (start, end, style) => spans.push([start, end, style]), from, to);
  const lines = [];
  let index = 0;
  for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
    const line = state.doc.line(n);
    const parts = [];
    let offset = line.from;
    while (index < spans.length && spans[index][1] <= offset) index++;
    for (let i = index; i < spans.length && spans[i][0] < line.to; i++) {
      const [start, end, style] = spans[i];
      if (start > offset) parts.push([state.sliceDoc(offset, start), colors.variable]);
      parts.push([state.sliceDoc(Math.max(start, offset), Math.min(end, line.to)), colors[style] ?? colors.variable]);
      offset = Math.min(end, line.to);
    }
    if (offset < line.to) parts.push([state.sliceDoc(offset, line.to), colors.variable]);
    lines.push({ ...line, parts });
  }
  return { name, lines, document: state.doc.toString() };
}

function wrappedRows(pane, columns) {
  pane.layouts ??= new Map();
  if (pane.layouts.has(columns)) return pane.layouts.get(columns);
  const rows = [];
  for (const line of pane.lines) {
    const runs = [];
    let offset = 0;
    for (const [text, color] of line.parts) {
      runs.push({ from: offset, to: offset + text.length, color });
      offset += text.length;
    }
    let run = 0;
    let from = 0;
    do {
      let to = from;
      let width = 0;
      let breakAt = from;
      while (to < line.text.length) {
        const char = String.fromCodePoint(line.text.codePointAt(to));
        const units = char === '\t' ? 4 : 1;
        if (width + units > columns && to > from) break;
        width += units;
        to += char.length;
        if (/\s/.test(char)) breakAt = to;
      }
      if (to < line.text.length && breakAt > from + (to - from) / 2) to = breakAt;
      while (run < runs.length && runs[run].to <= from) run++;
      const parts = [];
      for (let i = run; i < runs.length && runs[i].from < to; i++) {
        const part = runs[i];
        parts.push([line.text.slice(Math.max(from, part.from), Math.min(to, part.to)), part.color]);
      }
      rows.push({ from: line.from + from, to: line.from + to, text: line.text.slice(from, to), parts });
      from = to;
    } while (from < line.text.length);
  }
  if (pane.layouts.size >= 4) pane.layouts.delete(pane.layouts.keys().next().value);
  pane.layouts.set(columns, rows);
  return rows;
}

function fitLayout(ctx, pane, scale, innerWidth, innerHeight, sizeFactor, minSize, maxSize) {
  pane.frames ??= new Map();
  const key = [scale, innerWidth, innerHeight, sizeFactor].join(':');
  if (pane.frames.has(key)) return pane.frames.get(key);

  function layout(size) {
    const font = size + 'px "JetBrains Mono", monospace';
    ctx.font = font;
    const columns = Math.max(1, Math.floor(innerWidth / ctx.measureText('M').width));
    const rows = wrappedRows(pane, columns);
    const lineHeight = size * 1.36;
    const capacity = Math.max(1, Math.floor(innerHeight / lineHeight) - 1);
    return { font, rows, lineHeight, capacity };
  }

  const nominal = scale * minSize;
  let minimum = nominal;
  let result = layout(nominal);
  const fits = candidate => candidate.rows.length <= candidate.capacity;
  if (!fits(result)) {
    const maxRows = pane.lines.reduce((sum, line) => sum + Math.max(1, line.text.length), 0);
    let low = innerHeight / ((maxRows + 2) * 1.36);
    let high = nominal;
    for (let i = 0; i < 16; i++) {
      const middle = (low + high) / 2;
      if (fits(layout(middle))) low = middle;
      else high = middle;
    }
    minimum = low;
    result = layout(minimum);
  }
  if (sizeFactor > 0) result = layout(minimum + sizeFactor * (scale * maxSize - minimum));
  if (pane.frames.size >= 4) pane.frames.delete(pane.frames.keys().next().value);
  pane.frames.set(key, result);
  return result;
}

export function createOverlay(shader, overlay, patternEd, shaderEd, highlighter, activePattern) {
  const preview = overlay.getContext('2d');
  const input = id => document.getElementById(id);
  const controls = ['overlay-source', 'overlay-scope', 'overlay-corner', 'overlay-size', 'overlay-opacity'].map(input);
  const minSize = Number(controls[3].min);
  const maxSize = Number(controls[3].max);
  let cached;

  function config() {
    const [source, scope, corner, size, opacity] = controls.map(control => control.value);
    if (source === 'off') return null;
    const key = JSON.stringify([source, scope, corner, size, opacity, patternEd.range(), shaderEd.range()]);
    if (cached?.key === key && cached.pattern === patternEd.view.state.doc && cached.shader === shaderEd.view.state.doc) return cached;
    const panes = [];
    if (source !== 'glsl') panes.push(snapshot(patternEd, 'Strudel', scope === 'full'));
    if (source !== 'strudel') panes.push(snapshot(shaderEd, 'GLSL', scope === 'full'));
    cached = { key, panes, corner, sizeFactor: (Number(size) - minSize) / (maxSize - minSize), opacity: Number(opacity) / 100, pattern: patternEd.view.state.doc, shader: shaderEd.view.state.doc };
    return cached;
  }

  function paint(ctx, width, height, options, now) {
    if (!options) return;
    const active = highlighter.ranges();
    const margin = Math.min(width, height) * 0.035;
    const paneWidth = (width * (options.panes.length > 1 ? 0.94 : 0.68) - margin * (options.panes.length - 1)) / options.panes.length;
    const padding = Math.max(8, margin * 0.55);
    for (const [index, pane] of options.panes.entries()) {
      const innerWidth = paneWidth - padding * 2;
      const innerHeight = height * 0.84 - padding * 2;
      if (innerWidth <= 0 || innerHeight <= 0) continue;
      const { font, rows, lineHeight, capacity } = fitLayout(ctx, pane,
        Math.min(width, height) / 590, innerWidth, innerHeight, options.sizeFactor, minSize, maxSize);
      const matches = pane.name === 'Strudel' && pane.document === activePattern();
      const visibleNotes = matches ? active.filter(range => range.expire > now) : [];
      const playingRow = visibleNotes.length ? rows.findIndex(line => visibleNotes.some(range => range.from < line.to && range.to > line.from)) : -1;
      const pageStart = playingRow < 0 ? 0 : Math.floor(playingRow / capacity) * capacity;
      const shownRows = rows.slice(pageStart, pageStart + capacity);
      const boxHeight = (shownRows.length + 1) * lineHeight + padding * 2;
      const x = (options.corner.endsWith('right') ? width - margin - paneWidth * options.panes.length - margin * (options.panes.length - 1) : margin)
        + index * (paneWidth + margin);
      const y = options.corner.startsWith('bottom') ? height - margin - boxHeight : margin;
      ctx.fillStyle = 'rgba(10, 15, 24, ' + options.opacity + ')';
      ctx.fillRect(x, y, paneWidth, boxHeight);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, paneWidth, boxHeight);
      ctx.clip();
      ctx.font = font;
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#aee688';
      const label = rows.length > capacity ? pane.name + '  ' + (pageStart + 1) + '–' + (pageStart + shownRows.length) + '/' + rows.length : pane.name;
      ctx.fillText(label, x + padding, y + padding, paneWidth - padding * 2);
      shownRows.forEach((line, row) => {
        const top = y + padding + (row + 1) * lineHeight;
        const left = x + padding;
        const measure = text => ctx.measureText(text.replaceAll('\t', '    ')).width;
        if (visibleNotes.length) {
          for (const range of visibleNotes) {
            const from = Math.max(line.from, range.from);
            const to = Math.min(line.to, range.to);
            if (to <= from) continue;
            ctx.fillStyle = 'rgba(198,255,46,0.36)';
            ctx.fillRect(left + measure(line.text.slice(0, from - line.from)), top, measure(line.text.slice(from - line.from, to - line.from)), lineHeight);
          }
        }
        let offset = left;
        for (const [text, color] of line.parts) {
          ctx.fillStyle = color;
          ctx.fillText(text.replaceAll('\t', '    '), offset, top);
          offset += measure(text);
        }
      });
      ctx.restore();
    }
  }

  return {
    preview(now) {
      const options = config();
      overlay.hidden = !options;
      if (!options) return;
      const { width, height } = shader;
      if (overlay.width !== width) overlay.width = width;
      if (overlay.height !== height) overlay.height = height;
      preview.clearRect(0, 0, width, height);
      paint(preview, width, height, options, now);
    },
    capture(height) {
      const options = config();
      const canvas = document.createElement('canvas');
      canvas.height = height;
      canvas.width = Math.max(2, Math.round(height * shader.width / Math.max(shader.height, 1) / 2) * 2);
      const ctx = canvas.getContext('2d', { alpha: false });
      return {
        canvas,
        draw(now) {
          ctx.drawImage(shader, 0, 0, canvas.width, canvas.height);
          paint(ctx, canvas.width, canvas.height, options, now);
        },
      };
    },
  };
}
