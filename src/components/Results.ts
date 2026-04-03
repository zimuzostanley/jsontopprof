import m from 'mithril'
import { S, downloadProfile, downloadAll } from '../state'
import { formatBytes } from '../utils/format'

export const Results: m.Component = {
  view() {
    const profiles = S.profiles
    if (profiles.length === 0) {
      return m('.card', m('p', { style: 'color: var(--text-secondary);' }, 'No profiles generated yet.'))
    }

    const totalRows = profiles.reduce((s, p) => s + p.rowCount, 0)
    const totalSamples = profiles.reduce((s, p) => s + p.sampleCount, 0)
    const totalBytes = profiles.reduce((s, p) => s + p.data.length, 0)

    return m('div', [
      m('.card', [
        m('.card-title', 'Generated profiles'),
        m('.stats', [
          m('.stat', [m('strong', profiles.length), profiles.length === 1 ? ' profile' : ' profiles']),
          m('.stat', [m('strong', totalRows.toLocaleString()), ' total rows']),
          m('.stat', [m('strong', totalSamples.toLocaleString()), ' unique stacks']),
          m('.stat', [m('strong', formatBytes(totalBytes)), ' total size']),
        ]),
        profiles.length > 1 ? m('.actions', { style: 'border-top: none; padding-top: 0; margin-top: 4px;' }, [
          m('.spacer'),
          m('button.btn.sm', { onclick: downloadAll }, 'Download all'),
        ]) : null,
      ]),

      m('.profile-list', profiles.map(p =>
        m('.profile-card', { key: p.fileName }, [
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
      )),

      m('.card.section-gap.hint-card', [
        m('.card-title', 'Usage'),
        m('div', { style: 'font-size: 0.8rem; color: var(--text-secondary); line-height: 1.8;' }, [
          m('code.code-inline', 'pprof -http=:8080 profile.pb.gz'),
          m('br'),
          'or open in Perfetto UI at ',
          m('code.code-inline', 'ui.perfetto.dev'),
        ]),
      ]),
    ])
  },
}
