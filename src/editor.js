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
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';

export function createEditor(parent, doc, kind /* 'js' | 'glsl' */, onRun) {
  const lang = kind === 'glsl' ? cpp() : javascript();

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
