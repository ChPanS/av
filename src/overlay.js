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

export function createOverlay(shader, overlay, patternEd, shaderEd, highlighter, activePattern) {
  const preview = overlay.getContext('2d');
  const input = id => document.getElementById(id);
  const controls = ['overlay-source', 'overlay-scope', 'overlay-corner', 'overlay-size', 'overlay-opacity'].map(input);
  let cached;

  function config() {
    const [source, scope, corner, size, opacity] = controls.map(control => control.value);
    if (source === 'off') return null;
    const key = JSON.stringify([source, scope, corner, size, opacity, patternEd.range(), shaderEd.range()]);
    if (cached?.key === key && cached.pattern === patternEd.view.state.doc && cached.shader === shaderEd.view.state.doc) return cached;
    const panes = [];
    if (source !== 'glsl') panes.push(snapshot(patternEd, 'Strudel', scope === 'full'));
    if (source !== 'strudel') panes.push(snapshot(shaderEd, 'GLSL', scope === 'full'));
    cached = { key, panes, corner, size: Number(size), opacity: Number(opacity) / 100, pattern: patternEd.view.state.doc, shader: shaderEd.view.state.doc };
    return cached;
  }

  function paint(ctx, width, height, options, now) {
    if (!options) return;
    const active = highlighter.ranges();
    const margin = Math.min(width, height) * 0.035;
    const paneWidth = (width * (options.panes.length > 1 ? 0.94 : 0.68) - margin * (options.panes.length - 1)) / options.panes.length;
    const padding = Math.max(8, margin * 0.55);
    for (const [index, pane] of options.panes.entries()) {
      const columns = Math.max(1, ...pane.lines.map(line => line.text.replaceAll('\t', '    ').length));
      const requested = Math.min(width, height) * options.size / 590;
      const size = Math.min(requested, (height * 0.84 - padding * 2) / ((pane.lines.length + 1) * 1.36),
        (paneWidth - padding * 2) / (columns * 0.63));
      if (size <= 0) continue;
      const lineHeight = size * 1.36;
      const boxHeight = (pane.lines.length + 1) * lineHeight + padding * 2;
      const x = (options.corner.endsWith('right') ? width - margin - paneWidth * options.panes.length - margin * (options.panes.length - 1) : margin)
        + index * (paneWidth + margin);
      const y = options.corner.startsWith('bottom') ? height - margin - boxHeight : margin;
      ctx.fillStyle = 'rgba(10, 15, 24, ' + options.opacity + ')';
      ctx.fillRect(x, y, paneWidth, boxHeight);
      ctx.font = size + 'px "JetBrains Mono", monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#aee688';
      ctx.fillText(pane.name, x + padding, y + padding);
      const matches = pane.name === 'Strudel' && pane.document === activePattern();
      pane.lines.forEach((line, row) => {
        const top = y + padding + (row + 1) * lineHeight;
        const left = x + padding;
        const measure = text => ctx.measureText(text.replaceAll('\t', '    ')).width;
        if (matches) {
          for (const range of active) {
            const from = Math.max(line.from, range.from);
            const to = Math.min(line.to, range.to);
            if (range.expire <= now || to <= from) continue;
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
