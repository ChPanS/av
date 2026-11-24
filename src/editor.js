// Обёртка над CodeMirror 6 с приятными для кодинга клавишами:
//  - Tab: принять автокомплит (если открыт) ИЛИ сделать отступ
//  - Shift-Tab: убрать отступ
//  - Ctrl/Cmd-Enter: запустить (onRun), БЕЗ вставки переноса строки
import { EditorView, basicSetup } from 'codemirror';
import { keymap, Decoration } from '@codemirror/view';
import { Prec, StateEffect, StateField } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { acceptCompletion } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { cpp, cppLanguage } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';
import { highlightField, highlightTheme } from './highlight.js';

// Автокомплит доступных юниформов в редакторе шейдера: "uPa|" -> uPad,
// "uPad.|" -> vel/pitch (если тег .vis("iPad") инструментного типа). getCatalog()
// дёргается на каждый вызов — живой список текущих тегов из редактора паттерна
// (main.js передаёт () => scanUniformCatalog(patternEd.get())), поэтому список
// актуален по мере набора тега, без нажатия Play.
function uniformCompletionSource(getCatalog) {
  return (context) => {
    // "uPad." или "uPad.ve" — подсказка полей структуры
    const dotMatch = context.matchBefore(/[A-Za-z_]\w*\.\w*/);
    if (dotMatch) {
      const dot = dotMatch.text.indexOf('.');
      const base = dotMatch.text.slice(0, dot);
      const entry = getCatalog().find((u) => u.name === base);
      if (!entry || !entry.fields) return null;
      return {
        from: dotMatch.from + dot + 1,
        options: entry.fields.map((f) => ({ label: f, type: 'property' })),
        validFor: /^\w*$/,
      };
    }
    // "uP|" — подсказка имён юниформов
    const word = context.matchBefore(/u[A-Za-z0-9]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    return {
      from: word.from,
      options: getCatalog().map((u) => ({
        label: u.name,
        type: 'variable',
        detail: u.fields ? u.fields.map((f) => '.' + f).join(' ') : u.type,
      })),
      validFor: /^\w*$/,
    };
  };
}

const shaderErrors = StateEffect.define();
const errorDecoration = Decoration.line({ class: 'cm-shader-error' });
const errorField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects) {
      if (effect.is(shaderErrors)) value = effect.value;
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

export function createEditor(parent, doc, kind /* 'js' | 'glsl' */, onRun, getUniformCatalog) {
  const lang = kind === 'glsl' ? cpp() : javascript();
  // подсветка играющих нот — только для редактора паттерна (js)
  const hl = kind === 'glsl' ? [] : [highlightField, highlightTheme];
  // автокомплит юниформов — только для редактора шейдера, и только если дали каталог
  const uniformHints = kind === 'glsl' && getUniformCatalog
    ? [cppLanguage.data.of({ autocomplete: uniformCompletionSource(getUniformCatalog) })]
    : [];

  // высокий приоритет, чтобы перебить дефолтные Enter/Tab
  const runKeys = Prec.highest(
    keymap.of([
      {
        key: 'Mod-Enter',
        run: () => { onRun && onRun(); return true; }, // true -> перенос не вставится
        preventDefault: true,
      },
      // Tab: сперва пытаемся принять автокомплит; если попапа нет — отступ
      { key: 'Tab', run: acceptCompletion },
      indentWithTab,
    ]),
  );

  const view = new EditorView({
    doc,
    parent,
    extensions: [
      runKeys,
      basicSetup,
      lang,
      oneDark,
      ...hl,
      ...(kind === 'glsl' ? [errorField] : []),
      ...uniformHints,
      indentUnit.of('  '),       // отступ 2 пробела
      EditorView.theme({
        '&': { height: '100%', fontSize: 'var(--editor-font, 16px)', lineHeight: '1.55' },
        '.cm-content': { padding: '12px 0', caretColor: '#c6ff2e' },
        '.cm-line': { padding: '0 8px' },
        '.cm-shader-error': { backgroundColor: '#74283466', boxShadow: 'inset 3px 0 #ff7888' },
        '.cm-gutters': { minWidth: '45px', padding: '12px 0' },
        '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, monospace" },
      }),
    ],
  });

  return {
    get: () => view.state.doc.toString(),
    set: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    range: () => {
      const { from, to } = view.state.selection.main;
      return [from, to];
    },
    errors(message) {
      if (kind !== 'glsl') return;
      const lines = new Set([...String(message ?? '').matchAll(/(?:ERROR|WARNING):\s*1:(\d+)/g)].map(match => Number(match[1])));
      const ranges = [...lines].filter(n => n > 0 && n <= view.state.doc.lines)
        .map(n => errorDecoration.range(view.state.doc.line(n).from));
      view.dispatch({ effects: shaderErrors.of(Decoration.set(ranges, true)) });
    },
    view,
  };
}
