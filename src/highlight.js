// Подсветка играющих сейчас нот в редакторе (как в strudel.cc).
//
// Идея: транспайлер Strudel эмитит позиции мини-нотации (emitMiniLocations),
// поэтому каждое событие несёт hap.context.locations — смещения [start,end]
// в исходном коде. На триггере события мы «зажигаем» эти диапазоны и гасим их
// через длительность ноты. Декорации CodeMirror рисуют фон поверх символов.
//
// Модуль НЕ зависит от того, где физически находится редактор в DOM — он
// работает с любым EditorView. Это и есть задел под будущий полноэкранный
// оверлей: тот же редактор можно положить поверх рендера, подсветка поедет с ним.

import { StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';

export const setHighlights = StateEffect.define();
const playMark = Decoration.mark({ class: 'cm-playing' });

// StateField с декорациями — добавляется в расширения редактора (см. editor.js)
export const highlightField = StateField.define({
  create() { return Decoration.none; },
  update(deco, tr) {
    deco = deco.map(tr.changes); // переносим подсветки при правках кода
    for (const e of tr.effects) {
      if (e.is(setHighlights)) {
        const ranges = e.value
          .slice()
          .sort((a, b) => a.from - b.from || a.to - b.to)
          .map((r) => playMark.range(r.from, r.to));
        deco = Decoration.set(ranges, true);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const highlightTheme = EditorView.baseTheme({
  '.cm-playing': {
    backgroundColor: 'rgba(198,255,46,0.22)',
    borderRadius: '2px',
    boxShadow: '0 0 0 1px rgba(198,255,46,0.45)',
  },
});

// нормализуем элемент locations в {from,to} (поддержка разных форм)
function toRange(loc, docLen) {
  let from, to;
  if (Array.isArray(loc)) { from = loc[0]; to = loc[1]; }
  else if (loc && typeof loc === 'object') { from = loc.start ?? loc.from; to = loc.end ?? loc.to; }
  if (from && typeof from === 'object') from = from.offset ?? from.index;
  if (to && typeof to === 'object') to = to.offset ?? to.index;
  if (typeof from !== 'number' || typeof to !== 'number') return null;
  from = Math.max(0, Math.min(from, docLen));
  to = Math.max(from, Math.min(to, docLen));
  if (to <= from) return null;
  return { from, to };
}

// контроллер: держит активные подсветки и гасит их по времени (rAF)
export function createHighlighter(view) {
  let active = [];        // { from, to, expire }
  let raf = null;
  let lastSig = '';

  function loop() {
    const now = performance.now();
    active = active.filter((a) => a.expire > now);
    const ranges = active.map((a) => ({ from: a.from, to: a.to }));
    const sig = ranges.map((r) => r.from + ':' + r.to).join('|');
    if (sig !== lastSig) {             // диспатчим только при изменении набора
      lastSig = sig;
      try { view.dispatch({ effects: setHighlights.of(ranges) }); } catch (e) {}
    }
    raf = requestAnimationFrame(loop);
  }
  if (raf === null) loop();

  return {
    // locations: hap.context.locations; holdMs: длительность ноты в мс
    light(locations, holdMs) {
      if (!Array.isArray(locations) || !locations.length) return;
      const docLen = view.state.doc.length;
      const exp = performance.now() + Math.max(60, Math.min(holdMs || 140, 600));
      for (const loc of locations) {
        const r = toRange(loc, docLen);
        if (r) active.push({ from: r.from, to: r.to, expire: exp });
      }
    },
    clear() { active = []; },
  };
}
