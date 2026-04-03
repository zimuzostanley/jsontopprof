import m from 'mithril'
import { S, loadData, reset } from '../state'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
const PREVIEW_ROWS = 5
const PREVIEW_CELL_MAX = 50

let dragging = false

function handleFile(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    S.parseError = `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max ${MAX_FILE_SIZE / 1024 / 1024} MB)`
    m.redraw()
    return
  }
  const reader = new FileReader()
  reader.onload = () => loadData(reader.result as string, file.name)
  reader.onerror = () => {
    S.parseError = 'Failed to read file'
    m.redraw()
  }
  reader.readAsText(file)
}

function handleDrop(e: DragEvent): void {
  e.preventDefault()
  dragging = false
  m.redraw()
  const file = e.dataTransfer?.files[0]
  if (file) handleFile(file)
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s
}

export const Import: m.Component = {
  view() {
    return m('div', [
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

      !S.data ? [
        m('.card', [
          m('.card-title', 'Paste or upload TSV data'),

          m('textarea', {
            placeholder: 'Paste tab-separated data here...\n\nSupports quoted fields, JSON columns, and large datasets.',
            value: S.rawText,
            oninput: (e: InputEvent) => {
              S.rawText = (e.target as HTMLTextAreaElement).value
            },
          }),

          m('.drop-zone' + (dragging ? '.dragging' : ''), {
            style: 'margin-top: 12px;',
            ondragover: (e: DragEvent) => {
              e.preventDefault()
              if (!dragging) { dragging = true; m.redraw() }
            },
            ondragleave: () => {
              if (dragging) { dragging = false; m.redraw() }
            },
            ondrop: handleDrop,
            onclick: () => {
              (document.getElementById('file-input') as HTMLInputElement)?.click()
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

          S.rawText.trim() ? m('.actions', [
            m('.spacer'),
            m('button.btn.primary', {
              onclick: () => loadData(S.rawText, ''),
            }, 'Parse data'),
          ]) : null,
        ]),

        S.parseError ? m('.msg-error', S.parseError) : null,
      ] : null,

      S.data && S.step === 'import' ? m('.card.section-gap', [
        m('.card-title', 'Data preview'),
        m('.preview-table', [
          m('table', [
            m('thead', m('tr', S.data.headers.map(h => m('th', h)))),
            m('tbody', S.data.rows.slice(0, PREVIEW_ROWS).map(row =>
              m('tr', S.data!.headers.map(h => {
                const val = row[h] ?? ''
                return m('td', { title: val }, truncate(val, PREVIEW_CELL_MAX))
              }))
            )),
            S.data.rows.length > PREVIEW_ROWS ? m('tfoot', m('tr',
              m('td.truncated', { colspan: S.data.headers.length },
                `\u2026 and ${(S.data.rows.length - PREVIEW_ROWS).toLocaleString()} more rows`)
            )) : null,
          ]),
        ]),
      ]) : null,
    ])
  },
}
