import { ParsedData, ColumnInfo } from './types'

/**
 * Parse TSV text into headers and rows.
 * Handles RFC 4180-style quoting (double-quote delimited fields,
 * "" for escaped quotes) with tab as delimiter.
 */
export function parseTSV(text: string): ParsedData {
  const records = parseDelimited(text, '\t')
  if (records.length === 0) return { headers: [], rows: [] }

  const headers = records[0]
  const rows: Record<string, string>[] = []
  for (let i = 1; i < records.length; i++) {
    const fields = records[i]
    // Skip empty trailing lines
    if (fields.length === 1 && fields[0] === '') continue
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = fields[j] ?? ''
    }
    rows.push(row)
  }
  return { headers, rows }
}

/**
 * State-machine parser for delimited text with quote handling.
 * Supports: quoted fields, escaped quotes (""), newlines within quotes.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const records: string[][] = []
  let fields: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '\\' && i + 1 < text.length && text[i + 1] === '"') {
        // Backslash-escaped quote (\")
        field += '"'
        i += 2
      } else if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          // RFC 4180 escaped quote ("")
          field += '"'
          i += 2
        } else {
          // End of quoted field
          inQuotes = false
          i++
        }
      } else {
        field += ch
        i++
      }
    } else {
      if (ch === '"' && field === '') {
        // Start of quoted field
        inQuotes = true
        i++
      } else if (ch === '"') {
        // Quote in middle of unquoted field — treat as literal
        field += ch
        i++
      } else if (ch === delimiter) {
        fields.push(field)
        field = ''
        i++
      } else if (ch === '\n') {
        fields.push(field)
        records.push(fields)
        fields = []
        field = ''
        i++
      } else if (ch === '\r') {
        // Handle \r\n
        fields.push(field)
        records.push(fields)
        fields = []
        field = ''
        i++
        if (i < text.length && text[i] === '\n') i++
      } else {
        field += ch
        i++
      }
    }
  }

  // Flush last field/record
  if (field !== '' || fields.length > 0) {
    fields.push(field)
    records.push(fields)
  }

  return records
}

/**
 * Analyze parsed data to discover column types, JSON sub-fields, etc.
 */
const ANALYSIS_SAMPLE_SIZE = 20

export function analyzeColumns(data: ParsedData): ColumnInfo[] {
  const columns: ColumnInfo[] = []
  const sampleSize = Math.min(data.rows.length, ANALYSIS_SAMPLE_SIZE)

  for (const header of data.headers) {
    const samples = data.rows.slice(0, sampleSize).map(r => r[header] ?? '')
    const nonEmpty = samples.filter(s => s !== '')

    // Try to detect JSON
    const jsonResults = nonEmpty.map(tryParseJSON)
    const jsonTypes = new Set(jsonResults.map(r => r.type))

    if (jsonTypes.has('object') && !jsonTypes.has('other')) {
      // JSON object column — expand sub-fields
      const allKeys = new Set<string>()
      const keySamples = new Map<string, string[]>()
      const keyNumeric = new Map<string, boolean>()

      for (const r of jsonResults) {
        if (r.type === 'object' && r.value) {
          for (const [k, v] of Object.entries(r.value as Record<string, unknown>)) {
            allKeys.add(k)
            const vs = String(v ?? '')
            if (!keySamples.has(k)) keySamples.set(k, [])
            keySamples.get(k)!.push(vs)
            if (keyNumeric.get(k) !== false) {
              keyNumeric.set(k, isNumericString(vs))
            }
          }
        }
      }

      // Add the parent column as non-assignable info
      columns.push({
        name: header,
        source: header,
        sampleValues: nonEmpty.slice(0, 3),
        isNumeric: false,
      })

      for (const key of allKeys) {
        columns.push({
          name: `${header}.${key}`,
          source: header,
          jsonKey: key,
          sampleValues: (keySamples.get(key) ?? []).slice(0, 3),
          isNumeric: keyNumeric.get(key) ?? false,
        })
      }
    } else if (jsonTypes.has('array') && !jsonTypes.has('other')) {
      // JSON array column — potential stack column
      const firstArr = jsonResults.find(r => r.type === 'array')
      let arrayKeys: string[] | undefined
      if (firstArr?.value && Array.isArray(firstArr.value) && firstArr.value.length > 0) {
        const first = firstArr.value[0]
        if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
          arrayKeys = Object.keys(first)
        }
      }

      columns.push({
        name: header,
        source: header,
        isJsonArray: true,
        jsonArrayKeys: arrayKeys,
        sampleValues: nonEmpty.slice(0, 2).map(s =>
          s.length > 60 ? s.slice(0, 57) + '...' : s
        ),
        isNumeric: false,
      })
    } else {
      // Regular column
      const allNumeric = nonEmpty.length > 0 && nonEmpty.every(isNumericString)
      columns.push({
        name: header,
        source: header,
        sampleValues: nonEmpty.slice(0, 3),
        isNumeric: allNumeric,
      })
    }
  }

  return columns
}

interface JSONParseResult {
  type: 'object' | 'array' | 'other'
  value?: unknown
}

function tryParseJSON(s: string): JSONParseResult {
  const trimmed = s.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { type: 'other' }
  }
  try {
    const v = JSON.parse(trimmed)
    if (Array.isArray(v)) return { type: 'array', value: v }
    if (typeof v === 'object' && v !== null) return { type: 'object', value: v }
    return { type: 'other' }
  } catch {
    return { type: 'other' }
  }
}

function isNumericString(s: string): boolean {
  if (s === '') return false
  return !isNaN(Number(s)) && isFinite(Number(s))
}

/**
 * Suggest default roles for columns based on type analysis.
 */
export function suggestDefaults(columns: ColumnInfo[]): {
  roles: Map<string, ColumnRole>
  frameOrder: string[]
} {
  const roles = new Map<string, ColumnRole>()
  const frameOrder: string[] = []

  // Skip JSON sub-fields for initial frame selection
  const topLevel = columns.filter(c => c.jsonKey === undefined)

  // Pick first non-numeric top-level column as the default frame
  let foundFrame = false
  for (const col of topLevel) {
    if (!foundFrame && !col.isNumeric) {
      roles.set(col.name, 'frame')
      frameOrder.push(col.name)
      foundFrame = true
    } else if (col.isNumeric) {
      roles.set(col.name, 'metric')
    } else {
      roles.set(col.name, 'none')
    }
  }

  // Default all unset (JSON sub-fields, etc.) to none
  for (const col of columns) {
    if (!roles.has(col.name)) {
      roles.set(col.name, 'none')
    }
  }

  return { roles, frameOrder }
}

type ColumnRole = import('./types').ColumnRole
