// Тонкая обёртка над CodeMirror 6: создаёт редактор и даёт get/set значения.
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';

export function createEditor(parent, doc, kind /* 'js' | 'glsl' */) {
  const lang = kind === 'glsl' ? cpp() : javascript();
  const view = new EditorView({
    doc,
    parent,
    extensions: [
      basicSetup,
      lang,
      oneDark,
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
