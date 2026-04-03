import m from 'mithril'
import { S } from '../state'
import type { GeneratedProfile, TextSample } from '../models/types'

let copyFeedback = ''
let copyTimer: number | null = null

function showCopyFeedback(msg: string): void {
  copyFeedback = msg
  if (copyTimer !== null) clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copyFeedback = ''
    copyTimer = null
    m.redraw()
  }, 1500)
}

function toggleMetric(name: string): void {
  if (S.textMetrics.has(name)) S.textMetrics.delete(name)
  else S.textMetrics.add(name)
}

function formatSample(s: TextSample, metrics: Set<string>): string {
  const stackStr = s.stack.join(';')

  const parts: string[] = []

  // Metrics in brackets
  if (metrics.size > 0) {
    const vals = [...metrics]
      .filter(name => name in s.values)
      .map(name => `${name}: ${s.values[name].toLocaleString()}`)
    if (vals.length > 0) parts.push(vals.join(', '))
  }

  // Labels in braces
  const labelKeys = Object.keys(s.labels)
  if (labelKeys.length > 0) {
    const lbls = labelKeys.map(k => `${k}=${s.labels[k]}`)
    parts.push(lbls.join(', '))
  }

  if (parts.length === 0) return stackStr
  return `${stackStr} [${parts.join(' | ')}]`
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

function hasLabels(): boolean {
  return S.profiles.some(p =>
    p.textSamples.some(s => Object.keys(s.labels).length > 0)
  )
}

export const TextView: m.Component = {
  onremove() {
    if (copyTimer !== null) { clearTimeout(copyTimer); copyTimer = null }
    copyFeedback = ''
  },

  view() {
    const profiles = S.profiles
    if (profiles.length === 0) return null

    const metricNames = getMetricNames()
    const metrics = S.textMetrics
    const allText = formatAll(profiles, metrics)
    const showLabels = hasLabels()

    return m('div', [
      // Metric toggles
      metricNames.length > 0 ? m('.card', [
        m('.card-title', 'Visible metrics'),
        m('.col-role', metricNames.map(name =>
          m('button.role-btn', {
            key: name,
            class: metrics.has(name) ? 'active' : '',
            onclick: () => toggleMetric(name),
          }, name)
        )),
        showLabels
          ? m('div', { style: 'margin-top: 6px; font-size: 0.72rem; color: var(--text-tertiary);' },
              'Labels shown automatically in {braces}')
          : null,
      ]) : null,

      // Copy all + feedback
      m('.actions.actions-flush', [
        copyFeedback ? m('.copy-feedback', copyFeedback) : null,
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
                  m('span.text-profile-meta',
                    ` \u2014 ${p.rowCount} rows, ${p.sampleCount} samples`),
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
