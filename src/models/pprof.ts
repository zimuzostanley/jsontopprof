import { ParsedData, ColumnInfo, ProfileConfig, GeneratedProfile } from './types'

// --- Protobuf wire format helpers ---

function varint(value: number): Uint8Array {
  const out: number[] = []
  let v = value >>> 0 // ensure unsigned 32-bit
  // Handle values that need BigInt for encoding
  if (value > 0xFFFFFFFF) {
    return varintBig(BigInt(value))
  }
  do {
    let byte = v & 0x7F
    v >>>= 7
    if (v !== 0) byte |= 0x80
    out.push(byte)
  } while (v !== 0)
  return new Uint8Array(out)
}

function varintBig(value: bigint): Uint8Array {
  const out: number[] = []
  let v = value
  if (v < 0n) v = v + (1n << 64n) // two's complement for negative
  do {
    let byte = Number(v & 0x7Fn)
    v >>= 7n
    if (v !== 0n) byte |= 0x80
    out.push(byte)
  } while (v !== 0n)
  if (out.length === 0) out.push(0)
  return new Uint8Array(out)
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  let len = 0
  for (const a of arrays) len += a.length
  const result = new Uint8Array(len)
  let offset = 0
  for (const a of arrays) {
    result.set(a, offset)
    offset += a.length
  }
  return result
}

function fieldVarint(fieldNumber: number, value: number): Uint8Array {
  return concat(varint((fieldNumber << 3) | 0), varint(value))
}

function fieldBytes(fieldNumber: number, data: Uint8Array): Uint8Array {
  return concat(varint((fieldNumber << 3) | 2), varint(data.length), data)
}

function fieldMessage(fieldNumber: number, msgBytes: Uint8Array): Uint8Array {
  return fieldBytes(fieldNumber, msgBytes)
}

function encodeString(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

// --- String table ---

class StringTable {
  private strings: string[] = [''] // index 0 = empty string
  private index = new Map<string, number>([['', 0]])

  intern(s: string): number {
    const existing = this.index.get(s)
    if (existing !== undefined) return existing
    const idx = this.strings.length
    this.strings.push(s)
    this.index.set(s, idx)
    return idx
  }

  encode(): Uint8Array {
    const parts: Uint8Array[] = []
    for (const s of this.strings) {
      parts.push(fieldBytes(6, encodeString(s))) // Profile.string_table = 6
    }
    return concat(...parts)
  }
}

// --- Pprof builder ---

class PprofBuilder {
  private strings = new StringTable()
  private functions = new Map<string, number>() // name -> function_id
  private locations = new Map<number, number>()  // function_id -> location_id
  private nextFuncId = 1
  private nextLocId = 1
  private samples: Uint8Array[] = []
  private functionProtos: Uint8Array[] = []
  private locationProtos: Uint8Array[] = []
  private metricNames: string[]
  private metricUnits: string[]

  constructor(metricNames: string[], metricUnits: string[]) {
    this.metricNames = metricNames
    this.metricUnits = metricUnits
  }

  private getFunctionId(name: string): number {
    const existing = this.functions.get(name)
    if (existing !== undefined) return existing
    const fid = this.nextFuncId++
    this.functions.set(name, fid)
    const nameIdx = this.strings.intern(name)
    const funcBytes = concat(
      fieldVarint(1, fid),      // Function.id
      fieldVarint(2, nameIdx),  // Function.name
      fieldVarint(3, nameIdx),  // Function.system_name
    )
    this.functionProtos.push(fieldMessage(5, funcBytes)) // Profile.function = 5
    return fid
  }

  private getLocationId(funcId: number): number {
    const existing = this.locations.get(funcId)
    if (existing !== undefined) return existing
    const lid = this.nextLocId++
    this.locations.set(funcId, lid)
    const lineBytes = fieldVarint(1, funcId) // Line.function_id
    const locBytes = concat(
      fieldVarint(1, lid),             // Location.id
      fieldMessage(4, lineBytes),      // Location.line
    )
    this.locationProtos.push(fieldMessage(4, locBytes)) // Profile.location = 4
    return lid
  }

  addSample(stack: string[], values: number[]): void {
    // pprof wants leaf-first location_ids
    const parts: Uint8Array[] = []
    for (let i = stack.length - 1; i >= 0; i--) {
      const fid = this.getFunctionId(stack[i])
      const lid = this.getLocationId(fid)
      parts.push(fieldVarint(1, lid)) // Sample.location_id
    }
    for (const v of values) {
      parts.push(fieldVarint(2, v))   // Sample.value
    }
    this.samples.push(fieldMessage(2, concat(...parts))) // Profile.sample = 2
  }

  encode(): Uint8Array {
    const parts: Uint8Array[] = []

    // Sample types (Profile.sample_type = 1)
    for (let i = 0; i < this.metricNames.length; i++) {
      const typeIdx = this.strings.intern(this.metricNames[i])
      const unitIdx = this.strings.intern(this.metricUnits[i])
      const vtBytes = concat(fieldVarint(1, typeIdx), fieldVarint(2, unitIdx))
      parts.push(fieldMessage(1, vtBytes))
    }

    // Samples
    for (const s of this.samples) parts.push(s)

    // Locations
    for (const l of this.locationProtos) parts.push(l)

    // Functions
    for (const f of this.functionProtos) parts.push(f)

    // String table
    parts.push(this.strings.encode())

    // Default sample type (Profile.default_sample_type = 15)
    if (this.metricNames.length > 0) {
      parts.push(fieldVarint(15, this.strings.intern(this.metricNames[0])))
    }

    return concat(...parts)
  }
}

// --- Profile generation ---

/**
 * Build a stack of frame names for a single row.
 */
function buildStack(
  row: Record<string, string>,
  frameOrder: string[],
  columns: ColumnInfo[],
  jsonArrayLabelKey: Map<string, string>,
): string[] {
  const stack: string[] = []

  for (const frameName of frameOrder) {
    const col = columns.find(c => c.name === frameName)
    if (!col) continue

    if (col.isJsonArray) {
      // Expand JSON array into multiple frames
      const raw = row[col.source] ?? ''
      try {
        const arr = JSON.parse(raw.trim())
        if (Array.isArray(arr)) {
          const labelKey = jsonArrayLabelKey.get(col.name)
          for (const elem of arr) {
            if (typeof elem === 'object' && elem !== null && labelKey) {
              stack.push(String(elem[labelKey] ?? ''))
            } else {
              stack.push(String(elem))
            }
          }
        }
      } catch {
        stack.push(raw || '(empty)')
      }
    } else if (col.jsonKey !== undefined) {
      // JSON sub-field
      const raw = row[col.source] ?? ''
      try {
        const obj = JSON.parse(raw.trim())
        stack.push(String(obj[col.jsonKey] ?? ''))
      } catch {
        stack.push(raw || '(empty)')
      }
    } else {
      // Regular column
      stack.push(row[col.name] || '(empty)')
    }
  }

  return stack.length > 0 ? stack : ['(no frames)']
}

/**
 * Extract numeric metric value from a row.
 */
function getMetricValue(
  row: Record<string, string>,
  metricName: string,
  columns: ColumnInfo[],
): number {
  const col = columns.find(c => c.name === metricName)
  if (!col) return 0

  let raw: string
  if (col.jsonKey !== undefined) {
    const src = row[col.source] ?? ''
    try {
      const obj = JSON.parse(src.trim())
      raw = String(obj[col.jsonKey] ?? '0')
    } catch {
      raw = '0'
    }
  } else {
    raw = row[col.name] ?? '0'
  }

  const n = Number(raw)
  return isNaN(n) ? 0 : Math.round(n)
}

/**
 * Get partition key for a row.
 */
function getPartitionKey(
  row: Record<string, string>,
  partitionColumns: string[],
  columns: ColumnInfo[],
): string {
  if (partitionColumns.length === 0) return ''
  const parts: string[] = []
  for (const name of partitionColumns) {
    const col = columns.find(c => c.name === name)
    if (!col) continue
    let val: string
    if (col.jsonKey !== undefined) {
      const src = row[col.source] ?? ''
      try {
        const obj = JSON.parse(src.trim())
        val = String(obj[col.jsonKey] ?? '')
      } catch {
        val = ''
      }
    } else {
      val = row[col.name] ?? ''
    }
    parts.push(`${name}=${val}`)
  }
  return parts.join('|')
}

/**
 * Compress data using the browser's CompressionStream API.
 */
async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return concat(...chunks)
}

/**
 * Generate pprof profiles from parsed data and configuration.
 */
export async function generateProfiles(
  data: ParsedData,
  columns: ColumnInfo[],
  config: ProfileConfig,
): Promise<GeneratedProfile[]> {
  const metricColumns = [...config.roles.entries()]
    .filter(([, role]) => role === 'metric')
    .map(([name]) => name)

  const partitionColumns = [...config.roles.entries()]
    .filter(([, role]) => role === 'partition')
    .map(([name]) => name)

  // Always include "rows" as the last metric
  const allMetricNames = [...metricColumns, 'rows']
  const allMetricUnits = [
    ...metricColumns.map(n => config.metricUnits.get(n) ?? 'count'),
    'count',
  ]

  // Group rows by partition key
  const partitions = new Map<string, Record<string, string>[]>()
  for (const row of data.rows) {
    const key = getPartitionKey(row, partitionColumns, columns)
    if (!partitions.has(key)) partitions.set(key, [])
    partitions.get(key)!.push(row)
  }

  const profiles: GeneratedProfile[] = []

  for (const [partKey, rows] of partitions) {
    const builder = new PprofBuilder(allMetricNames, allMetricUnits)

    // Aggregate by stack
    const stacks = new Map<string, { stack: string[]; values: number[] }>()

    for (const row of rows) {
      const stack = buildStack(row, config.frameOrder, columns, config.jsonArrayLabelKey)
      const stackKey = stack.join('\x00')

      const values = metricColumns.map(m => getMetricValue(row, m, columns))
      values.push(1) // rows metric

      const existing = stacks.get(stackKey)
      if (existing) {
        for (let i = 0; i < values.length; i++) {
          existing.values[i] += values[i]
        }
      } else {
        stacks.set(stackKey, { stack, values })
      }
    }

    for (const { stack, values } of stacks.values()) {
      builder.addSample(stack, values)
    }

    const rawData = builder.encode()
    const compressed = await gzipCompress(rawData)

    // Build nice name and filename
    let name: string
    let fileName: string
    if (partKey === '') {
      name = 'profile'
      fileName = 'profile.pb.gz'
    } else {
      const partValues: Record<string, string> = {}
      const parts = partKey.split('|').map(p => {
        const [k, ...rest] = p.split('=')
        const v = rest.join('=')
        partValues[k] = v
        return v
      })
      name = parts.join(' / ')
      const safeName = parts.map(p =>
        p.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)
      ).join('_')
      fileName = `profile_${safeName}.pb.gz`
    }

    profiles.push({
      name,
      fileName,
      data: compressed,
      sampleCount: stacks.size,
      rowCount: rows.length,
      partitionValues: partKey === '' ? {} : Object.fromEntries(
        partKey.split('|').map(p => {
          const [k, ...rest] = p.split('=')
          return [k, rest.join('=')]
        })
      ),
    })
  }

  // Sort by name
  profiles.sort((a, b) => a.name.localeCompare(b.name))
  return profiles
}

// Export for testing
export { varint, varintBig, fieldVarint, fieldBytes, fieldMessage, concat, PprofBuilder, StringTable, buildStack, getMetricValue }
