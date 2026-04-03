import m from 'mithril'
import { S, downloadProfile } from '../state'
import { formatBytes } from '../utils/format'
import { TextView } from './TextView'

const selected = new Set<string>()
let lastProfileSet = ''

function syncSelection(): void {
  const currentSet = S.profiles.map(p => p.fileName).sort().join('\0')
  if (currentSet !== lastProfileSet) {
    selected.clear()
    for (const p of S.profiles) selected.add(p.fileName)
    lastProfileSet = currentSet
  }
}

function toggleSelect(fileName: string): void {
  if (selected.has(fileName)) selected.delete(fileName)
  else selected.add(fileName)
}

function selectAll(): void {
  for (const p of S.profiles) selected.add(p.fileName)
}

function selectNone(): void {
  selected.clear()
}

function downloadSelected(): void {
  for (const p of S.profiles) {
    if (selected.has(p.fileName)) downloadProfile(p)
  }
}

export const Results: m.Component = {
  view() {
    const profiles = S.profiles
    if (profiles.length === 0) {
      return m('.card', m('p', { style: 'color: var(--text-secondary);' }, 'No profiles generated yet.'))
    }

    syncSelection()

    const totalRows = profiles.reduce((s, p) => s + p.rowCount, 0)
    const totalSamples = profiles.reduce((s, p) => s + p.sampleCount, 0)
    const totalBytes = profiles.reduce((s, p) => s + p.data.length, 0)
    const allSelected = profiles.every(p => selected.has(p.fileName))
    const noneSelected = selected.size === 0
    const selectedCount = profiles.filter(p => selected.has(p.fileName)).length
    const isText = S.resultsView === 'text'

    return m('div', [
      // Summary card with view toggle
      m('.card', [
        m('.card-title-row', [
          m('.card-title', 'Generated profiles'),
          m('.view-toggle', [
            m('button', {
              class: !isText ? 'active' : '',
              onclick: () => { S.resultsView = 'cards' },
            }, 'Cards'),
            m('button', {
              class: isText ? 'active' : '',
              onclick: () => { S.resultsView = 'text' },
            }, 'Text'),
          ]),
        ]),
        m('.stats', [
          m('.stat', [m('strong', profiles.length), profiles.length === 1 ? ' profile' : ' profiles']),
          m('.stat', [m('strong', totalRows.toLocaleString()), ' total rows']),
          m('.stat', [m('strong', totalSamples.toLocaleString()), ' unique stacks']),
          m('.stat', [m('strong', formatBytes(totalBytes)), ' total size']),
        ]),
        !isText && profiles.length > 1 ? m('.actions.actions-flush-sm', [
          m('button.btn.sm', {
            onclick: allSelected ? selectNone : selectAll,
          }, allSelected ? 'Deselect all' : 'Select all'),
          m('.spacer'),
          m('button.btn.sm', {
            disabled: noneSelected,
            onclick: downloadSelected,
          }, selectedCount === profiles.length
            ? 'Download all'
            : `Download ${selectedCount} selected`),
        ]) : null,
      ]),

      // Cards view
      !isText ? m('.profile-list', profiles.map(p =>
        m('.profile-card', { key: p.fileName }, [
          profiles.length > 1
            ? m('input[type=checkbox]', {
                checked: selected.has(p.fileName),
                onchange: () => toggleSelect(p.fileName),
                'aria-label': `Select ${p.name}`,
                class: 'checkbox-accent',
              })
            : null,
          m('.profile-info', [
            m('.profile-name', p.name),
            m('.profile-meta', [
              `${p.rowCount.toLocaleString()} rows, `,
              `${p.sampleCount.toLocaleString()} samples, `,
              formatBytes(p.data.length),
            ]),
            m('.profile-file', p.fileName),
          ]),
          m('button.btn.sm.primary', {
            onclick: () => downloadProfile(p),
            'aria-label': `Download ${p.fileName}`,
          }, 'Download'),
        ])
      )) : null,

      // Text view
      isText ? m(TextView) : null,

      // Usage hint
      m('.card.section-gap.hint-card', [
        m('.card-title', 'View profiles'),
        m('.hint-text', [
          'Upload to ',
          m('strong', 'Perfetto UI'),
          ' at ',
          m('code.code-inline', 'ui.perfetto.dev'),
        ]),
      ]),
    ])
  },
}
