import m from 'mithril'
import { S, loadData, reset } from '../state'

let dragging = false

function handleFile(file: File): void {
  const reader = new FileReader()
  reader.onload = () => {
    loadData(reader.result as string, file.name)
  }
  reader.readAsText(file)
}

function handleDrop(e: DragEvent): void {
  e.preventDefault()
  dragging = false
  const file = e.dataTransfer?.files[0]
  if (file) handleFile(file)
}

function handlePaste(e: ClipboardEvent): void {
  const text = e.clipboardData?.getData('text')
  if (text) {
    // Let the textarea handle it naturally, we'll pick it up on input
  }
}

export const Import: m.Component = {
  view() {
    return m('div', [
      // If we have data loaded, show summary + option to re-import
      S.data ? m('.card', [
        m('.stats', [
          m('.stat', [m('strong', S.data.headers.length), ' columns']),
          m('.stat', [m('strong', S.data.rows.length.toLocaleString()), ' rows']),
          S.fileName ? m('.stat', ['from ', m('strong', S.fileName)]) : null,
        ]),
        m('.actions', { style: 'border-top: none; padding-top: 0; margin-top: 8px;' }, [
          m('button.btn.sm', { onclick: reset }, 'Load different data'),
        ]),
      ]) : null,

      // Import area
      !S.data ? [
        m('.card', [
          m('.card-title', 'Paste or upload TSV data'),

          // Textarea
          m('textarea', {
            placeholder: 'Paste tab-separated data here...\n\ncolumn1\\tcolumn2\\tjson_column\nvalue1\\t42\\t{"key": "val"}\n\nJSON columns are auto-detected and expanded.',
            value: S.rawText,
            oninput: (e: InputEvent) => {
              S.rawText = (e.target as HTMLTextAreaElement).value
            },
            onpaste: handlePaste,
          }),

          // File upload
          m('.drop-zone' + (dragging ? '.dragging' : ''), {
            style: 'margin-top: 12px;',
            ondragover: (e: DragEvent) => { e.preventDefault(); dragging = true },
            ondragleave: () => { dragging = false },
            ondrop: handleDrop,
            onclick: () => {
              const input = document.getElementById('file-input') as HTMLInputElement
              input?.click()
            },
          }, [
            m('div', 'Drop a .tsv file here or click to browse'),
            m('input#file-input', {
              type: 'file',
              accept: '.tsv,.csv,.txt',
              onchange: (e: Event) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (file) handleFile(file)
              },
            }),
          ]),

          // Load button
          S.rawText.trim() ? m('.actions', [
            m('.spacer'),
            m('button.btn.primary', {
              onclick: () => loadData(S.rawText, ''),
            }, 'Parse data'),
          ]) : null,
        ]),

        // Error
        S.parseError ? m('.msg-error', S.parseError) : null,
      ] : null,

      // Data preview
      S.data && S.step === 'import' ? m('.card.section-gap', [
        m('.card-title', 'Data preview'),
        m('.preview-table', [
          m('table', [
            m('thead', m('tr', S.data.headers.map(h => m('th', h)))),
            m('tbody', S.data.rows.slice(0, 5).map(row =>
              m('tr', S.data!.headers.map(h => {
                const val = row[h] ?? ''
                return m('td', { title: val }, val.length > 50 ? val.slice(0, 47) + '...' : val)
              }))
            )),
            S.data.rows.length > 5 ? m('tfoot', m('tr',
              m('td.truncated', { colspan: S.data.headers.length },
                `... and ${(S.data.rows.length - 5).toLocaleString()} more rows`)
            )) : null,
          ]),
        ]),
      ]) : null,
    ])
  },
}
