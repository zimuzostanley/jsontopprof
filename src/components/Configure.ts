import m from 'mithril'
import { S, setRole, moveFrame, generate } from '../state'
import type { ColumnRole, ColumnInfo } from '../models/types'

const UNIT_SUGGESTIONS = [
  'bytes', 'count', 'nanoseconds', 'microseconds', 'milliseconds', 'seconds',
  'objects', 'pages', 'requests', 'errors',
]

function isJsonParent(col: ColumnInfo): boolean {
  if (col.isJsonArray) return true
  if (S.columns.some(c => c.source === col.name && c.jsonKey !== undefined && !c.isJsonArrayField)) {
    return col.name === col.source && !col.jsonKey
  }
  return false
}

/** Columns available to assign (not already assigned + not JSON parents). */
function availableFor(role: ColumnRole): ColumnInfo[] {
  return S.columns.filter(c => {
    if (isJsonParent(c)) return false
    const current = S.roles.get(c.name) ?? 'none'
    if (current !== 'none') return false
    if (role === 'metric' && !c.isNumeric) return false
    return true
  })
}

function assignedAs(role: ColumnRole): ColumnInfo[] {
  return (role === 'frame' ? S.frameOrder : S.columns.filter(c => S.roles.get(c.name) === role).map(c => c.name))
    .map(name => S.columns.find(c => c.name === name))
    .filter((c): c is ColumnInfo => c !== undefined)
}

function addColumn(name: string, role: ColumnRole): void {
  setRole(name, role)
}

function removeColumn(name: string): void {
  setRole(name, 'none')
}

function colLabel(col: ColumnInfo): string {
  if (col.jsonKey !== undefined) return `${col.source}.${col.jsonKey}`
  return col.name
}

function renderAddDropdown(role: ColumnRole, label: string): m.Vnode | null {
  const available = availableFor(role)
  if (available.length === 0) return null
  return m('select.add-col-select', {
    'aria-label': label,
    value: '',
    onchange: (e: Event) => {
      const val = (e.target as HTMLSelectElement).value
      if (val) addColumn(val, role)
    },
  }, [
    m('option', { value: '', disabled: true, selected: true }, `+ ${label}`),
    ...available.map(c => m('option', { value: c.name }, colLabel(c))),
  ])
}

export const Configure: m.Component = {
  view() {
    if (!S.data) return null

    const frames = assignedAs('frame')
    const metrics = assignedAs('metric')
    const labels = assignedAs('label')
    const partitions = assignedAs('partition')

    return m('div', [
      // Frames
      m('.card', [
        m('.card-title-row', [
          m('.card-title', 'Frames'),
          renderAddDropdown('frame', 'Add frame'),
        ]),
        frames.length === 0
          ? m('.empty-hint', 'Select at least one column to define the call stack.')
          : m('.frame-order', frames.map((col, idx) => {
              const isFirst = idx === 0
              const isLast = idx === frames.length - 1
              return m('.frame-item', { key: col.name }, [
                m('.frame-idx', `${idx + 1}.`),
                m('.frame-name', colLabel(col)),
                frames.length > 1
                  ? m('.frame-label', isFirst ? 'root' : isLast ? 'leaf' : '')
                  : null,
                col.isJsonArrayField
                  ? m('.frame-label', `expands ${col.source}`)
                  : null,
                m('.frame-arrows', [
                  m('button', {
                    disabled: isFirst,
                    onclick: () => moveFrame(col.name, -1),
                    'aria-label': `Move ${col.name} up`,
                  }, '\u25B2'),
                  m('button', {
                    disabled: isLast,
                    onclick: () => moveFrame(col.name, 1),
                    'aria-label': `Move ${col.name} down`,
                  }, '\u25BC'),
                ]),
                m('button.remove-btn', {
                  onclick: () => removeColumn(col.name),
                  'aria-label': `Remove ${col.name}`,
                }, '\u00D7'),
              ])
            })),
      ]),

      // Metrics
      m('.card', [
        m('.card-title-row', [
          m('.card-title', 'Metrics'),
          renderAddDropdown('metric', 'Add metric'),
        ]),
        m('.metric-list', [
          ...metrics.map(col =>
            m('.metric-item', { key: col.name }, [
              m('.metric-name', colLabel(col)),
              m('.metric-controls', [
                m('input[type=text].unit-input', {
                  'aria-label': `Unit for ${col.name}`,
                  list: 'unit-suggestions',
                  value: S.metricUnits.get(col.name) ?? 'count',
                  oninput: (e: InputEvent) => {
                    S.metricUnits.set(col.name, (e.target as HTMLInputElement).value)
                  },
                  placeholder: 'unit',
                }),
                m('button.remove-btn', {
                  onclick: () => removeColumn(col.name),
                  'aria-label': `Remove ${col.name}`,
                }, '\u00D7'),
              ]),
            ])
          ),
          m('datalist#unit-suggestions', { key: '_datalist' },
            UNIT_SUGGESTIONS.map(u => m('option', { value: u })),
          ),
          m('.metric-item', { key: '_rows' }, [
            m('.metric-name', 'rows'),
            m('.rows-badge', 'auto \u2014 count of input rows'),
          ]),
        ]),
      ]),

      // Labels
      m('.card', [
        m('.card-title-row', [
          m('.card-title', 'Labels'),
          renderAddDropdown('label', 'Add label'),
        ]),
        labels.length === 0
          ? m('.empty-hint', 'Optional metadata attached to each sample.')
          : m('.tag-list', labels.map(col =>
              m('.tag-item', { key: col.name }, [
                m('span', colLabel(col)),
                m('button.remove-btn', {
                  onclick: () => removeColumn(col.name),
                  'aria-label': `Remove ${col.name}`,
                }, '\u00D7'),
              ])
            )),
      ]),

      // Partition
      m('.card', [
        m('.card-title-row', [
          m('.card-title', 'Partition by'),
          renderAddDropdown('partition', 'Add partition'),
        ]),
        partitions.length === 0
          ? m('.empty-hint', 'Optional. Splits output into separate profiles.')
          : m('.tag-list', partitions.map(col =>
              m('.tag-item', { key: col.name }, [
                m('span', colLabel(col)),
                m('button.remove-btn', {
                  onclick: () => removeColumn(col.name),
                  'aria-label': `Remove ${col.name}`,
                }, '\u00D7'),
              ])
            )),
      ]),

      // Generate
      m('.actions', [
        m('.spacer'),
        S.generateError
          ? m('span', { style: 'color: var(--error); font-size: 0.85rem;' }, S.generateError)
          : null,
        S.generating
          ? m('button.btn.primary', { disabled: true }, [
              m('.spinner'),
              S.progress ? ` ${S.progress.message}` : ' Generating\u2026',
            ])
          : m('button.btn.primary', {
              disabled: frames.length === 0,
              onclick: generate,
              title: frames.length === 0 ? 'Add at least one frame column' : '',
            }, 'Generate profiles'),
      ]),

      S.generating && S.progress ? m('.progress-bar', [
        m('.progress-fill', { style: `width: ${Math.round(S.progress.pct)}%` }),
      ]) : null,
    ])
  },
}
