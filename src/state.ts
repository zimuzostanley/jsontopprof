import m from 'mithril'
import { ColumnRole, ProfileConfig, GeneratedProfile, AppStep } from './models/types'
import { parseTSV, analyzeColumns } from './models/tsv'
import { serializeConfig, deserializeConfig } from './models/configWire'
import { generateProfilesAsync, GenerateProgress } from './generateAsync'
import type { SerializedConfig } from './models/configWire'
import type { ColumnInfo, ParsedData } from './models/types'

// Config persistence: saves column role assignments keyed by sorted header list.

const CONFIG_STORAGE_KEY = 'pprof-configs'
const MAX_SAVED_CONFIGS = 20

interface SavedConfig extends SerializedConfig {
  timestamp: number
}

function configKey(headers: string[]): string {
  return headers.slice().sort().join('\t')
}

function loadSavedConfigs(): Record<string, SavedConfig> {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveConfig(headers: string[], state: State): void {
  try {
    const configs = loadSavedConfigs()
    configs[configKey(headers)] = {
      ...serializeConfig({
        roles: state.roles,
        frameOrder: state.frameOrder,
        metricUnits: state.metricUnits,
      }),
      timestamp: Date.now(),
    }
    // Prune oldest if over limit
    const keys = Object.keys(configs)
    if (keys.length > MAX_SAVED_CONFIGS) {
      keys.sort((a, b) => configs[a].timestamp - configs[b].timestamp)
      for (let i = 0; i < keys.length - MAX_SAVED_CONFIGS; i++) {
        delete configs[keys[i]]
      }
    }
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configs))
  } catch { /* localStorage may be full or unavailable */ }
}

function restoreConfig(headers: string[], columns: ColumnInfo[]): SavedConfig | null {
  const configs = loadSavedConfigs()
  const saved = configs[configKey(headers)]
  if (!saved) return null

  // Validate saved config against current columns
  const colNames = new Set(columns.map(c => c.name))
  const validRoles = saved.roles.filter(([name]) => colNames.has(name))
  if (validRoles.length === 0) return null

  return { ...saved, roles: validRoles }
}

// ── State ──

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
  metricUnits: Map<string, string>
  profiles: GeneratedProfile[]
  generating: boolean
  generateError: string
  resultsView: 'pprofs' | 'text'
  textMetrics: Set<string>
  progress: GenerateProgress | null
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

  metricUnits: new Map(),
  profiles: [],
  generating: false,
  generateError: '',
  progress: null,
  resultsView: 'pprofs',
  textMetrics: new Set(),
}

export function applyTheme(theme: 'light' | 'dark'): void {
  S.theme = theme
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem('pprof-theme', theme) } catch { /* ignore */ }
}

export function toggleTheme(): void {
  applyTheme(S.theme === 'light' ? 'dark' : 'light')
}

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
  S.progress = null

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

    // Try to restore a previous config for this schema
    const saved = restoreConfig(data.headers, S.columns)
    if (saved) {
      const restored = deserializeConfig(saved)
      S.roles = restored.roles
      const colNames = new Set(S.columns.map(c => c.name))
      S.frameOrder = restored.frameOrder.filter(n => colNames.has(n))
      S.metricUnits = new Map(
        [...restored.metricUnits].filter(([n]) => colNames.has(n))
      )
      for (const col of S.columns) {
        if (!S.roles.has(col.name)) S.roles.set(col.name, 'none')
      }
    } else {
      // Start clean — all columns as 'none', user picks roles
      S.roles = new Map(S.columns.map(c => [c.name, 'none' as ColumnRole]))
      S.frameOrder = []
      S.metricUnits = new Map()
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
    S.metricUnits.set(columnName, inferUnit(columnName))
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
  S.progress = { message: 'Starting\u2026', pct: 0 }
  m.redraw()

  try {
    const config: ProfileConfig = {
      roles: S.roles,
      frameOrder: S.frameOrder,
      metricUnits: S.metricUnits,
    }
    S.profiles = await generateProfilesAsync(S.data, S.columns, config, (p) => {
      S.progress = p
      m.redraw()
    })
    S.step = 'results'
    S.resultsView = 'pprofs'

    // Init text metrics from first profile's sample keys
    if (S.profiles.length > 0 && S.profiles[0].textSamples.length > 0) {
      S.textMetrics = new Set(Object.keys(S.profiles[0].textSamples[0].values))
    }

    // Persist config for this schema
    if (S.data) {
      saveConfig(S.data.headers, S)
    }
  } catch (e: unknown) {
    S.generateError = errorMessage(e) || 'Failed to generate profiles'
  } finally {
    S.generating = false
    S.progress = null
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
  S.metricUnits = new Map()
  S.profiles = []
  S.generating = false
  S.generateError = ''
  S.progress = null
  S.resultsView = 'pprofs'
  S.textMetrics = new Set()
}

export function downloadProfile(profile: GeneratedProfile): void {
  const blob = new Blob([profile.data as unknown as ArrayBuffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = profile.fileName
  a.click()
  URL.revokeObjectURL(url)
}
