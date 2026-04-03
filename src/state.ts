import m from 'mithril'
import { ParsedData, ColumnInfo, ColumnRole, ProfileConfig, GeneratedProfile, AppStep } from './models/types'
import { parseTSV, analyzeColumns, suggestDefaults } from './models/tsv'
import { generateProfiles } from './models/pprof'

export interface State {
  // Theme
  theme: 'light' | 'dark'

  // Current step
  step: AppStep

  // Import
  rawText: string
  fileName: string
  parseError: string

  // Parsed data
  data: ParsedData | null
  columns: ColumnInfo[]

  // Configuration
  roles: Map<string, ColumnRole>
  frameOrder: string[]
  jsonArrayLabelKey: Map<string, string>
  metricUnits: Map<string, string>

  // Results
  profiles: GeneratedProfile[]
  generating: boolean
  generateError: string
}

function loadTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('pprof-theme')
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
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

    // Apply smart defaults
    const defaults = suggestDefaults(S.columns)
    S.roles = defaults.roles
    S.frameOrder = defaults.frameOrder
    S.jsonArrayLabelKey = new Map()
    S.metricUnits = new Map()

    // Default units for detected metrics
    for (const col of S.columns) {
      if (defaults.roles.get(col.name) === 'metric') {
        const nameLower = col.name.toLowerCase()
        if (nameLower.includes('size') || nameLower.includes('byte')) {
          S.metricUnits.set(col.name, 'bytes')
        } else if (nameLower.includes('time') || nameLower.includes('dur')) {
          S.metricUnits.set(col.name, 'nanoseconds')
        } else {
          S.metricUnits.set(col.name, 'count')
        }
      }
    }

    // Default label key for JSON arrays
    for (const col of S.columns) {
      if (col.isJsonArray && col.jsonArrayKeys && col.jsonArrayKeys.length > 0) {
        S.jsonArrayLabelKey.set(col.name, col.jsonArrayKeys[0])
      }
    }

    S.step = 'configure'
  } catch (e: any) {
    S.parseError = e.message || 'Failed to parse input'
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

  // Set default metric unit
  if (role === 'metric' && !S.metricUnits.has(columnName)) {
    S.metricUnits.set(columnName, 'count')
  }
}

export function moveFrame(name: string, direction: -1 | 1): void {
  const idx = S.frameOrder.indexOf(name)
  if (idx < 0) return
  const newIdx = idx + direction
  if (newIdx < 0 || newIdx >= S.frameOrder.length) return
  S.frameOrder[idx] = S.frameOrder[newIdx]
  S.frameOrder[newIdx] = name
}

export async function generate(): Promise<void> {
  if (!S.data) return
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
  } catch (e: any) {
    S.generateError = e.message || 'Failed to generate profiles'
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
  for (const p of S.profiles) {
    downloadProfile(p)
  }
}
