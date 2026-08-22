// Обёртка над CodeMirror 6 с приятными для кодинга клавишами:
//  - Tab: принять автокомплит (если открыт) ИЛИ сделать отступ
//  - Shift-Tab: убрать отступ
//  - Ctrl/Cmd-Enter: запустить (onRun), БЕЗ вставки переноса строки
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
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
      ...uniformHints,
      indentUnit.of('  '),       // отступ 2 пробела
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, monospace" },
      }),
      EditorView.lineWrapping,
    ],
  });

  return {
    get: () => view.state.doc.toString(),
    set: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    view,
  };
}
