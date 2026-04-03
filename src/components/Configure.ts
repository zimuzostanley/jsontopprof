import m from 'mithril'
import { S, setRole, moveFrame, generate } from '../state'
import { ColumnRole } from '../models/types'

const ROLES: { key: ColumnRole; label: string }[] = [
  { key: 'none', label: 'Skip' },
  { key: 'frame', label: 'Frame' },
  { key: 'metric', label: 'Metric' },
  { key: 'partition', label: 'Partition' },
]

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
          // JSON parent columns are informational only
          if (col.source === col.name && S.columns.some(c => c.source === col.name && c.jsonKey !== undefined)) {
            return m('.col-row.json-parent', [
              m('span', `${col.name} `),
              m('span', { style: 'font-style: italic;' }, '(JSON object \u2014 sub-fields below)'),
            ])
          }

          const role = S.roles.get(col.name) ?? 'none'
          const canBeMetric = col.isNumeric
          const isJsonArray = col.isJsonArray

          return [
            m('.col-row', [
              m('.col-name', [
                col.jsonKey !== undefined
                  ? [m('span.json-prefix', `${col.source}.`), col.jsonKey]
                  : col.isJsonArray
                    ? [col.name, ' ', m('span.json-prefix', '[array]')]
                    : col.name,
              ]),
              m('.col-samples', col.sampleValues.join(', ') || '\u2014'),
              m('.col-role', ROLES
                .filter(r => {
                  // Only show metric for numeric columns
                  if (r.key === 'metric' && !canBeMetric) return false
                  return true
                })
                .map(r =>
                  m('button.role-btn', {
                    class: role === r.key ? 'active' : '',
                    onclick: () => setRole(col.name, r.key),
                  }, r.label)
                )
              ),
            ]),

            // JSON array label key selector
            isJsonArray && role === 'frame' && col.jsonArrayKeys && col.jsonArrayKeys.length > 0
              ? m('.json-array-config', [
                  'Label key: ',
                  m('select', {
                    value: S.jsonArrayLabelKey.get(col.name) ?? col.jsonArrayKeys[0],
                    onchange: (e: Event) => {
                      S.jsonArrayLabelKey.set(col.name, (e.target as HTMLSelectElement).value)
                    },
                  }, col.jsonArrayKeys.map(k =>
                    m('option', { value: k }, k)
                  )),
                ])
              : null,
          ]
        })),
      ]),

      // Frame order
      hasFrames ? m('.card', [
        m('.card-title', 'Frame order (top = root, bottom = leaf)'),
        m('.frame-order', frameColumns.map((name, idx) => {
          const col = S.columns.find(c => c.name === name)
          const isFirst = idx === 0
          const isLast = idx === frameColumns.length - 1

          return m('.frame-item', [
            m('.frame-idx', `${idx + 1}.`),
            m('.frame-name', name),
            isLast && frameColumns.length > 1
              ? m('.frame-label', 'leaf')
              : isFirst && frameColumns.length > 1
                ? m('.frame-label', 'root')
                : null,
            m('.frame-arrows', [
              m('button', {
                disabled: isFirst,
                onclick: () => moveFrame(name, -1),
              }, '\u25B2'),
              m('button', {
                disabled: isLast,
                onclick: () => moveFrame(name, 1),
              }, '\u25BC'),
            ]),
            // JSON array label key inline
            col?.isJsonArray && col.jsonArrayKeys && col.jsonArrayKeys.length > 0
              ? m('span', { style: 'font-size: 0.72rem; color: var(--text-tertiary);' }, [
                  'key: ',
                  m('select.sm', {
                    value: S.jsonArrayLabelKey.get(name) ?? col.jsonArrayKeys[0],
                    onchange: (e: Event) => {
                      S.jsonArrayLabelKey.set(name, (e.target as HTMLSelectElement).value)
                    },
                  }, col.jsonArrayKeys.map(k => m('option', { value: k }, k))),
                ])
              : null,
          ])
        })),
      ]) : null,

      // Metric units
      metricColumns.length > 0 ? m('.card', [
        m('.card-title', 'Metrics & units'),
        m('.metric-list', [
          ...metricColumns.map(col =>
            m('.metric-item', [
              m('.metric-name', col.name),
              m('select', {
                value: S.metricUnits.get(col.name) ?? 'count',
                onchange: (e: Event) => {
                  S.metricUnits.set(col.name, (e.target as HTMLSelectElement).value)
                },
              }, [
                m('option', { value: 'bytes' }, 'bytes'),
                m('option', { value: 'count' }, 'count'),
                m('option', { value: 'nanoseconds' }, 'nanoseconds'),
                m('option', { value: 'microseconds' }, 'microseconds'),
                m('option', { value: 'milliseconds' }, 'milliseconds'),
                m('option', { value: 'seconds' }, 'seconds'),
              ]),
            ])
          ),
          // Always-present rows metric
          m('.metric-item', [
            m('.metric-name', 'rows'),
            m('.rows-badge', 'auto \u2014 count of input rows'),
          ]),
        ]),
      ]) : m('.card', [
        m('.card-title', 'Metrics'),
        m('.metric-list', [
          m('.metric-item', [
            m('.metric-name', 'rows'),
            m('.rows-badge', 'auto \u2014 count of input rows'),
          ]),
        ]),
      ]),

      // Generate button
      m('.actions', [
        m('.spacer'),
        S.generateError ? m('span', { style: 'color: var(--error); font-size: 0.85rem;' }, S.generateError) : null,
        S.generating
          ? m('button.btn.primary', { disabled: true }, [m('.spinner'), ' Generating...'])
          : m('button.btn.primary', {
              disabled: !hasFrames,
              onclick: generate,
              title: !hasFrames ? 'Select at least one frame column' : '',
            }, 'Generate profiles'),
      ]),
    ])
  },
}
