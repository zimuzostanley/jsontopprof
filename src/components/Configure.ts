import m from 'mithril'
import { S, setRole, moveFrame, generate } from '../state'
import type { ColumnRole, ColumnInfo } from '../models/types'

const ROLES: { key: ColumnRole; label: string }[] = [
  { key: 'none', label: 'Skip' },
  { key: 'frame', label: 'Frame' },
  { key: 'metric', label: 'Metric' },
  { key: 'label', label: 'Label' },
  { key: 'partition', label: 'Partition' },
]

const UNIT_SUGGESTIONS = [
  'bytes', 'count', 'nanoseconds', 'microseconds', 'milliseconds', 'seconds',
  'objects', 'pages', 'requests', 'errors',
]

function isJsonParent(col: ColumnInfo): boolean {
  // JSON object parent: has sub-fields with jsonKey
  if (S.columns.some(c => c.source === col.name && c.jsonKey !== undefined && !c.isJsonArrayField)) {
    return col.name === col.source && !col.jsonKey
  }
  // JSON array parent: has sub-fields with isJsonArrayField
  if (col.isJsonArray) return true
  return false
}

export const Configure: m.Component = {
  view() {
    if (!S.data) return null

    const frameColumns = S.frameOrder
    const metricColumns = S.columns.filter(c => S.roles.get(c.name) === 'metric')
    const hasFrames = frameColumns.length > 0

    return m('div', [
      // Column assignment
      m('.card', [
        m('.card-title', 'Assign column roles'),
        m('.col-list', S.columns.map(col => {
          // Skip JSON parent columns — only show their expanded sub-fields
          if (isJsonParent(col)) return null

          const role = S.roles.get(col.name) ?? 'none'

          return m('.col-row', { key: col.name }, [
            m('.col-role', ROLES
              .filter(r => r.key !== 'metric' || col.isNumeric)
              .map(r =>
                m('button.role-btn', {
                  class: role === r.key ? 'active' : '',
                  onclick: () => setRole(col.name, r.key),
                }, r.label)
              )
            ),
            m('.col-name', [
              col.jsonKey !== undefined
                ? [m('span.json-prefix', `${col.source}.`), col.jsonKey]
                : col.name,
            ]),
            m('.col-samples', col.sampleValues.join(', ') || '\u2014'),
          ])
        })),
      ]),

      // Frame order
      hasFrames ? m('.card', [
        m('.card-title', 'Frame order (top \u2192 root, bottom \u2192 leaf)'),
        m('.frame-order', frameColumns.map((name, idx) => {
          const col = S.columns.find(c => c.name === name)
          const isFirst = idx === 0
          const isLast = idx === frameColumns.length - 1

          return m('.frame-item', { key: name }, [
            m('.frame-idx', `${idx + 1}.`),
            m('.frame-name', name),
            frameColumns.length > 1
              ? m('.frame-label', isFirst ? 'root' : isLast ? 'leaf' : '')
              : null,
            m('.frame-arrows', [
              m('button', {
                disabled: isFirst,
                onclick: () => moveFrame(name, -1),
                'aria-label': `Move ${name} up`,
              }, '\u25B2'),
              m('button', {
                disabled: isLast,
                onclick: () => moveFrame(name, 1),
                'aria-label': `Move ${name} down`,
              }, '\u25BC'),
            ]),
            // JSON array sub-field: show which array column it expands
            col?.isJsonArrayField
              ? m('.frame-label', `expands ${col.source}`)
              : null,
          ])
        })),
      ]) : null,

      // Metrics & units
      m('.card', [
        m('.card-title', metricColumns.length > 0 ? 'Metrics & units' : 'Metrics'),
        m('.metric-list', [
          ...metricColumns.map(col =>
            m('.metric-item', { key: col.name }, [
              m('.metric-name', col.name),
              m('input[type=text].unit-input', {
                'aria-label': `Unit for ${col.name}`,
                list: 'unit-suggestions',
                value: S.metricUnits.get(col.name) ?? 'count',
                oninput: (e: InputEvent) => {
                  S.metricUnits.set(col.name, (e.target as HTMLInputElement).value)
                },
                placeholder: 'unit',
              }),
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
              disabled: !hasFrames,
              onclick: generate,
              title: hasFrames ? '' : 'Select at least one frame column',
            }, 'Generate profiles'),
      ]),

      // Progress bar
      S.generating && S.progress ? m('.progress-bar', [
        m('.progress-fill', { style: `width: ${Math.round(S.progress.pct)}%` }),
      ]) : null,
    ])
  },
}
