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
function toRange(loc) {
  let from, to;
  if (Array.isArray(loc)) { from = loc[0]; to = loc[1]; }
  else if (loc && typeof loc === 'object') { from = loc.start ?? loc.from; to = loc.end ?? loc.to; }
  if (from && typeof from === 'object') from = from.offset ?? from.index;
  if (to && typeof to === 'object') to = to.offset ?? to.index;
  if (typeof from !== 'number' || typeof to !== 'number') return null;
  if (from < 0) from = 0;
  if (to <= from) return null;
  return { from, to };
}

// контроллер: держит активные подсветки, гасит по времени (rAF),
// рассылает их во ВСЕ привязанные редакторы (живой + read-only зеркало для оверлея)
export function createHighlighter() {
  let views = [];
  let active = [];        // { from, to, expire } — сырые смещения
  let raf = null;
  let lastSig = '';

  function loop() {
    const now = performance.now();
    active = active.filter((a) => a.expire > now);
    const sig = active.map((a) => a.from + ':' + a.to).join('|');
    if (sig !== lastSig) {
      lastSig = sig;
      for (const v of views) dispatchTo(v);
    }
    raf = requestAnimationFrame(loop);
  }
  function dispatchTo(v) {
    const docLen = v.state.doc.length;
    const ranges = [];
    for (const a of active) {
      const from = Math.min(a.from, docLen);
      const to = Math.min(a.to, docLen);
      if (to > from) ranges.push({ from, to });
    }
    try { v.dispatch({ effects: setHighlights.of(ranges) }); } catch (e) {}
  }
  if (raf === null) loop();

  return {
    addView(v) { if (v && !views.includes(v)) views.push(v); },
    removeView(v) {
      views = views.filter((x) => x !== v);
      try { v.dispatch({ effects: setHighlights.of([]) }); } catch (e) {}
    },
    // locations: hap.context.locations; holdMs: длительность ноты в мс
    light(locations, holdMs) {
      if (!Array.isArray(locations) || !locations.length) return;
      const exp = performance.now() + Math.max(60, Math.min(holdMs || 140, 600));
      for (const loc of locations) {
        const r = toRange(loc);
        if (r) active.push({ from: r.from, to: r.to, expire: exp });
      }
    },
    clear() { active = []; },
  };
}
