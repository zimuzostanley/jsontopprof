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
    // JSON array sub-fields can be Frame or Metric (not Label/Partition)
    if (c.isJsonArrayField && role !== 'frame' && role !== 'metric') return false
    return true
  })
}

function assignedAs(role: ColumnRole): ColumnInfo[] {
  return (role === 'frame' ? S.frameOrder : S.columns.filter(c => S.roles.get(c.name) === role).map(c => c.name))
    .map(name => S.columns.find(c => c.name === name))
    .filter((c): c is ColumnInfo => c !== undefined)
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
      if (val) setRole(val, role)
    },
  }, [
    m('option', { value: '', disabled: true, selected: true }, `+ ${label}`),
    ...available.map(c => m('option', { value: c.name }, colLabel(c))),
  ])
}

function sectionHeader(
  title: string,
  subtitle: string,
  role: ColumnRole,
  addLabel: string,
): m.Vnode {
  return m('.card-title-row', [
    m('.section-heading', [
      m('.card-title', title),
      m('.section-subtitle', subtitle),
    ]),
    renderAddDropdown(role, addLabel),
  ])
}

function removeBtn(name: string): m.Vnode {
  return m('button.remove-btn', {
    onclick: () => setRole(name, 'none'),
    'aria-label': `Remove ${name}`,
    title: 'Remove',
  }, '×')
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
        sectionHeader(
          'Frames',
          'The call stack, ordered from root to leaf.',
          'frame',
          'Add frame',
        ),
        frames.length === 0
          ? m('.empty-hint.empty-hint-block',
              'Select at least one column to define the call stack.')
          : m('.frame-order', frames.map((col, idx) => {
              const isFirst = idx === 0
              const isLast = idx === frames.length - 1
              const showRootLeaf = frames.length > 1
              return m('.frame-item', { key: col.name }, [
                m('.frame-idx', idx + 1),
                m('.frame-name', colLabel(col)),
                m('.frame-tags', [
                  showRootLeaf && isFirst
                    ? m('.frame-pill.frame-pill-accent', 'root') : null,
                  showRootLeaf && isLast
                    ? m('.frame-pill.frame-pill-accent', 'leaf') : null,
                  col.isJsonArrayField
                    ? m('.frame-pill.frame-pill-muted', `from ${col.source}`) : null,
                ]),
                m('.frame-arrows', [
                  m('button', {
                    disabled: isFirst,
                    onclick: () => moveFrame(col.name, -1),
                    'aria-label': `Move ${col.name} up`,
                    title: 'Move up',
                  }, '▴'),
                  m('button', {
                    disabled: isLast,
                    onclick: () => moveFrame(col.name, 1),
                    'aria-label': `Move ${col.name} down`,
                    title: 'Move down',
                  }, '▾'),
                ]),
                removeBtn(col.name),
              ])
            })),
      ]),

      // Metrics
      m('.card', [
        sectionHeader(
          'Metrics',
          'Numeric values aggregated across samples.',
          'metric',
          'Add metric',
        ),
        m('.metric-list', [
          ...metrics.map(col =>
            m('.metric-item', { key: col.name }, [
              m('.metric-name', colLabel(col)),
              m('.metric-controls', [
                m('span.metric-unit-label', 'unit'),
                m('input[type=text].unit-input', {
                  'aria-label': `Unit for ${col.name}`,
                  list: 'unit-suggestions',
                  value: S.metricUnits.get(col.name) ?? 'count',
                  oninput: (e: InputEvent) => {
                    S.metricUnits.set(col.name, (e.target as HTMLInputElement).value)
                  },
                  placeholder: 'unit',
                }),
                removeBtn(col.name),
              ]),
            ])
          ),
          m('datalist#unit-suggestions', { key: '_datalist' },
            UNIT_SUGGESTIONS.map(u => m('option', { value: u })),
          ),
          m('.metric-item.metric-item-auto', { key: '_rows' }, [
            m('.metric-name', 'rows'),
            m('.rows-badge', 'auto — one per input row'),
          ]),
        ]),
      ]),

      // Labels
      m('.card', [
        sectionHeader(
          'Labels',
          'Extra metadata attached to every sample.',
          'label',
          'Add label',
        ),
        labels.length === 0
          ? m('.empty-hint.empty-hint-block', 'Optional.')
          : m('.tag-list', labels.map(col =>
              m('.tag-item', { key: col.name }, [
                m('span', colLabel(col)),
                removeBtn(col.name),
              ])
            )),
      ]),

      // Partition
      m('.card', [
        sectionHeader(
          'Partition by',
          'Split output into one pprof per distinct value.',
          'partition',
          'Add partition',
        ),
        partitions.length === 0
          ? m('.empty-hint.empty-hint-block', 'Optional.')
          : m('.tag-list', partitions.map(col =>
              m('.tag-item', { key: col.name }, [
                m('span', colLabel(col)),
                removeBtn(col.name),
              ])
            )),
      ]),

      // Generate
      m('.actions.generate-actions', [
        frames.length === 0
          ? m('.generate-hint', 'Add at least one frame to generate profiles.')
          : null,
        S.generateError
          ? m('.inline-error', S.generateError)
          : null,
        m('.spacer'),
        S.generating
          ? m('button.btn.primary', { disabled: true }, [
              m('.spinner'),
              S.progress ? ` ${S.progress.message}` : ' Generating…',
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
