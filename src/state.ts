import m from 'mithril'
import { ColumnRole, ProfileConfig, GeneratedProfile, AppStep } from './models/types'
import { parseTSV, analyzeColumns, suggestDefaults } from './models/tsv'
import { generateProfiles } from './models/pprof'

import type { ColumnInfo, ParsedData } from './models/types'

export interface State {
  theme: 'light' | 'dark'
  step: AppStep
  rawText: string
  fileName: string
  parseError: string
  data: ParsedData | null
  columns: ColumnInfo[]
  roles: Map<string, ColumnRole>
  frameOrder: string[]
  jsonArrayLabelKey: Map<string, string>
  metricUnits: Map<string, string>
  profiles: GeneratedProfile[]
  generating: boolean
  generateError: string
}

function loadTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('pprof-theme')
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* localStorage may be unavailable */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const S: State = {
  theme: loadTheme(),
  step: 'import',
  rawText: '',
  fileName: '',
  parseError: '',
  data: null,
  columns: [],
  roles: new Map(),
  frameOrder: [],
  jsonArrayLabelKey: new Map(),
  metricUnits: new Map(),
  profiles: [],
  generating: false,
  generateError: '',
}

export function applyTheme(theme: 'light' | 'dark'): void {
  S.theme = theme
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem('pprof-theme', theme) } catch { /* ignore */ }
}

export function toggleTheme(): void {
  applyTheme(S.theme === 'light' ? 'dark' : 'light')
}

/** Infer a reasonable unit from a column name. */
function inferUnit(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('size') || lower.includes('byte')) return 'bytes'
  if (lower.includes('time') || lower.includes('dur')) return 'nanoseconds'
  return 'count'
}

export function loadData(text: string, fileName: string): void {
  S.rawText = text
  S.fileName = fileName
  S.parseError = ''
  S.profiles = []
  S.generateError = ''

  try {
    const data = parseTSV(text)
    if (data.headers.length === 0) {
      S.parseError = 'No headers found. Check that the input is tab-separated.'
      return
    }
    if (data.rows.length === 0) {
      S.parseError = 'No data rows found.'
      return
    }
    S.data = data
    S.columns = analyzeColumns(data)

    const defaults = suggestDefaults(S.columns)
    S.roles = defaults.roles
    S.frameOrder = defaults.frameOrder
    S.jsonArrayLabelKey = new Map()
    S.metricUnits = new Map()

    for (const col of S.columns) {
      if (defaults.roles.get(col.name) === 'metric') {
        S.metricUnits.set(col.name, inferUnit(col.name))
      }
      if (col.isJsonArray && col.jsonArrayKeys && col.jsonArrayKeys.length > 0) {
        S.jsonArrayLabelKey.set(col.name, col.jsonArrayKeys[0])
      }
    }

    S.step = 'configure'
  } catch (e: unknown) {
    S.parseError = errorMessage(e) || 'Failed to parse input'
  }

  m.redraw()
}

export function setRole(columnName: string, role: ColumnRole): void {
  const prev = S.roles.get(columnName)
  S.roles.set(columnName, role)

  if (role === 'frame' && prev !== 'frame') {
    S.frameOrder.push(columnName)
  } else if (role !== 'frame' && prev === 'frame') {
    S.frameOrder = S.frameOrder.filter(n => n !== columnName)
  }

  if (role === 'metric' && !S.metricUnits.has(columnName)) {
    S.metricUnits.set(columnName, 'count')
  }
}

export function moveFrame(name: string, direction: -1 | 1): void {
  const idx = S.frameOrder.indexOf(name)
  if (idx < 0) return
  const target = idx + direction
  if (target < 0 || target >= S.frameOrder.length) return
  const other = S.frameOrder[target]
  S.frameOrder[target] = name
  S.frameOrder[idx] = other
}

export async function generate(): Promise<void> {
  if (!S.data || S.generating) return
  S.generating = true
  S.generateError = ''
  S.profiles = []
  m.redraw()

  try {
    const config: ProfileConfig = {
      roles: S.roles,
      frameOrder: S.frameOrder,
      jsonArrayLabelKey: S.jsonArrayLabelKey,
      metricUnits: S.metricUnits,
    }
    S.profiles = await generateProfiles(S.data, S.columns, config)
    S.step = 'results'
  } catch (e: unknown) {
    S.generateError = errorMessage(e) || 'Failed to generate profiles'
  } finally {
    S.generating = false
    m.redraw()
  }
}

export function reset(): void {
  S.step = 'import'
  S.rawText = ''
  S.fileName = ''
  S.parseError = ''
  S.data = null
  S.columns = []
  S.roles = new Map()
  S.frameOrder = []
  S.jsonArrayLabelKey = new Map()
  S.metricUnits = new Map()
  S.profiles = []
  S.generating = false
  S.generateError = ''
}

export function downloadProfile(profile: GeneratedProfile): void {
  const blob = new Blob([profile.data as BlobPart], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = profile.fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadAll(): void {
  for (const p of S.profiles) downloadProfile(p)
}
