import m from 'mithril'
import { S } from '../state'
import type { GeneratedProfile, TextSample } from '../models/types'

let copyFeedback = ''
let copyTimer: ReturnType<typeof setTimeout> | null = null

function showCopyFeedback(msg: string): void {
  copyFeedback = msg
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copyFeedback = ''; m.redraw() }, 1500)
  m.redraw()
}

function toggleMetric(name: string): void {
  if (S.textMetrics.has(name)) S.textMetrics.delete(name)
  else S.textMetrics.add(name)
}

function formatSample(s: TextSample, metrics: Set<string>): string {
  const stackStr = s.stack.join(';')
  if (metrics.size === 0) return stackStr
  const vals = [...metrics]
    .filter(name => name in s.values)
    .map(name => `${name}: ${s.values[name].toLocaleString()}`)
    .join(', ')
  return vals ? `${stackStr} [${vals}]` : stackStr
}

function formatProfile(profile: GeneratedProfile, metrics: Set<string>): string {
  return profile.textSamples.map(s => formatSample(s, metrics)).join('\n')
}

function formatAll(profiles: GeneratedProfile[], metrics: Set<string>): string {
  if (profiles.length === 1) return formatProfile(profiles[0], metrics)
  return profiles.map(p =>
    `── ${p.name} (${p.rowCount} rows, ${p.sampleCount} samples) ──\n${formatProfile(p, metrics)}`
  ).join('\n\n')
}

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    showCopyFeedback(`Copied ${label}`)
  } catch {
    showCopyFeedback('Copy failed')
  }
}

function getMetricNames(): string[] {
  for (const p of S.profiles) {
    if (p.textSamples.length > 0) return Object.keys(p.textSamples[0].values)
  }
  return []
}

export const TextView: m.Component = {
  view() {
    const profiles = S.profiles
    if (profiles.length === 0) return null

    const metricNames = getMetricNames()
    const metrics = S.textMetrics
    const allText = formatAll(profiles, metrics)

    return m('div', [
      // Metric toggles
      m('.card', [
        m('.card-title', 'Show metrics'),
        m('.col-role', metricNames.map(name =>
          m('button.role-btn', {
            key: name,
            class: metrics.has(name) ? 'active' : '',
            onclick: () => toggleMetric(name),
          }, name)
        )),
      ]),

      // Copy all + feedback
      m('.actions.actions-flush', [
        copyFeedback
          ? m('.copy-feedback', copyFeedback)
          : null,
        m('.spacer'),
        m('button.btn.sm', {
          onclick: () => copyText(allText, profiles.length === 1 ? 'profile' : 'all profiles'),
        }, profiles.length === 1 ? 'Copy' : 'Copy all'),
      ]),

      // Per-profile text blocks
      profiles.map(p => {
        const text = formatProfile(p, metrics)
        return m('div', { key: p.fileName }, [
          profiles.length > 1
            ? m('.text-profile-header', [
                m('span', [
                  p.name,
                  m('span.text-profile-meta', ` \u2014 ${p.rowCount} rows, ${p.sampleCount} samples`),
                ]),
                m('button.btn.sm', {
                  onclick: () => copyText(text, p.name),
                }, 'Copy'),
              ])
            : null,
          m('pre.text-view-pre', text),
        ])
      }),
    ])
  },
}
