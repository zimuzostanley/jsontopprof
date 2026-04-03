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

type TextFormat = 'tree' | 'flat'

function formatAnnotation(s: TextSample, metrics: Set<string>): string {
  const parts: string[] = []
  if (metrics.size > 0) {
    const vals = [...metrics]
      .filter(name => name in s.values)
      .map(name => `${name}: ${s.values[name].toLocaleString()}`)
    if (vals.length > 0) parts.push(vals.join(', '))
  }
  const labelKeys = Object.keys(s.labels)
  if (labelKeys.length > 0) {
    parts.push(labelKeys.map(k => `${k}=${s.labels[k]}`).join(', '))
  }
  return parts.length > 0 ? ` [${parts.join(' | ')}]` : ''
}

function formatSampleTree(s: TextSample, metrics: Set<string>): string {
  const annotation = formatAnnotation(s, metrics)
  const lines: string[] = []
  for (let i = 0; i < s.stack.length; i++) {
    // Per-frame values from frameValues, or sample-level on leaf
    const frameVals = s.frameValues?.[i]
    if (frameVals && Object.keys(frameVals).length > 0) {
      const parts = [...metrics]
        .filter(m => m in frameVals)
        .map(m => `${m}: ${frameVals[m].toLocaleString()}`)
      const fAnnotation = parts.length > 0 ? ` [${parts.join(', ')}]` : ''
      lines.push('  '.repeat(i) + s.stack[i] + fAnnotation)
    } else {
      const isLeaf = i === s.stack.length - 1
      lines.push('  '.repeat(i) + s.stack[i] + (isLeaf ? annotation : ''))
    }
  }
  return lines.join('\n')
}

function formatSampleFlat(s: TextSample, metrics: Set<string>): string {
  return s.stack.join(';') + formatAnnotation(s, metrics)
}

function formatProfile(
  profile: GeneratedProfile,
  metrics: Set<string>,
  fmt: TextFormat,
): string {
  const formatter = fmt === 'tree' ? formatSampleTree : formatSampleFlat
  const separator = fmt === 'tree' ? '\n\n' : '\n'
  return profile.textSamples.map(s => formatter(s, metrics)).join(separator)
}

function formatAll(
  profiles: GeneratedProfile[],
  metrics: Set<string>,
  fmt: TextFormat,
): string {
  if (profiles.length === 1) return formatProfile(profiles[0], metrics, fmt)
  return profiles.map(p =>
    `── ${p.name} (${p.rowCount} rows, ${p.sampleCount} samples) ──\n${formatProfile(p, metrics, fmt)}`
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
  const names = new Set<string>()
  for (const p of S.profiles) {
    for (const s of p.textSamples) {
      for (const k of Object.keys(s.values)) names.add(k)
      if (s.frameValues) {
        for (const fv of s.frameValues) {
          for (const k of Object.keys(fv)) names.add(k)
        }
      }
      if (names.size > 0) return [...names]
    }
  }
  return [...names]
}

function hasLabels(): boolean {
  return S.profiles.some(p =>
    p.textSamples.some(s => Object.keys(s.labels).length > 0)
  )
}

let textFormat: TextFormat = 'tree'

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
    const allText = formatAll(profiles, metrics, textFormat)
    const showLabels = hasLabels()

    return m('div', [
      // Controls card
      m('.card', [
        m('.card-title-row', [
          m('.card-title', 'Visible metrics'),
          m('.view-toggle', [
            m('button', {
              class: textFormat === 'tree' ? 'active' : '',
              onclick: () => { textFormat = 'tree' },
              title: 'Indented stack view',
            }, 'Tree'),
            m('button', {
              class: textFormat === 'flat' ? 'active' : '',
              onclick: () => { textFormat = 'flat' },
              title: 'Semicolon-separated (flamegraph format)',
            }, 'Flat'),
          ]),
        ]),
        metricNames.length > 0
          ? m('.metric-toggles', metricNames.map(name =>
              m('button.role-btn', {
                key: name,
                class: metrics.has(name) ? 'active' : '',
                onclick: () => toggleMetric(name),
              }, name)
            ))
          : null,
        showLabels
          ? m('.empty-hint', { style: 'margin-top: 6px;' },
              'Labels shown automatically in brackets')
          : null,
      ]),

      // Copy bar
      m('.actions.actions-flush', [
        copyFeedback ? m('.copy-feedback', copyFeedback) : null,
        m('.spacer'),
        m('button.btn.sm', {
          onclick: () => copyText(allText, profiles.length === 1 ? 'profile' : 'all profiles'),
        }, profiles.length === 1 ? 'Copy' : 'Copy all'),
      ]),

      // Per-profile text blocks
      profiles.map(p => {
        const text = formatProfile(p, metrics, textFormat)
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
