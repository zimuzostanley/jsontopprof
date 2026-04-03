import { ParsedData, ColumnInfo, ProfileConfig, GeneratedProfile } from './types'

// Protobuf wire format: type 0 = varint, type 2 = length-delimited.
// Field numbers per google/pprof/profile.proto.

function varint(value: number): Uint8Array {
  if (value > 0xFFFFFFFF) return varintBig(BigInt(value))
  const out: number[] = []
  let v = value >>> 0
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
  let v = value < 0n ? value + (1n << 64n) : value
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

function fieldVarint(field: number, value: number): Uint8Array {
  return concat(varint((field << 3) | 0), varint(value))
}

function fieldBytes(field: number, data: Uint8Array): Uint8Array {
  return concat(varint((field << 3) | 2), varint(data.length), data)
}

function fieldMessage(field: number, msg: Uint8Array): Uint8Array {
  return fieldBytes(field, msg)
}

const encoder = new TextEncoder()


class StringTable {
  private strings: string[] = ['']
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
    return concat(...this.strings.map(s => fieldBytes(6, encoder.encode(s))))
  }
}

// profile.proto Label { key=1, str=2, num=3, num_unit=4 }

interface SampleLabel {
  key: string
  value: string
  isNumeric: boolean
}


class PprofBuilder {
  private strings = new StringTable()
  private functions = new Map<string, number>()
  private locations = new Map<number, number>()
  private nextFuncId = 1
  private nextLocId = 1
  private samples: Uint8Array[] = []
  private functionProtos: Uint8Array[] = []
  private locationProtos: Uint8Array[] = []

  constructor(
    private metricNames: string[],
    private metricUnits: string[],
  ) {}

  private getFunctionId(name: string): number {
    const existing = this.functions.get(name)
    if (existing !== undefined) return existing
    const fid = this.nextFuncId++
    this.functions.set(name, fid)
    const nameIdx = this.strings.intern(name)
    this.functionProtos.push(fieldMessage(5, concat(
      fieldVarint(1, fid),
      fieldVarint(2, nameIdx),
      fieldVarint(3, nameIdx),
    )))
    return fid
  }

  private getLocationId(funcId: number): number {
    const existing = this.locations.get(funcId)
    if (existing !== undefined) return existing
    const lid = this.nextLocId++
    this.locations.set(funcId, lid)
    this.locationProtos.push(fieldMessage(4, concat(
      fieldVarint(1, lid),
      fieldMessage(4, fieldVarint(1, funcId)),
    )))
    return lid
  }

  addSample(stack: string[], values: number[], labels: SampleLabel[]): void {
    const parts: Uint8Array[] = []
    // pprof expects leaf-first
    for (let i = stack.length - 1; i >= 0; i--) {
      const fid = this.getFunctionId(stack[i])
      parts.push(fieldVarint(1, this.getLocationId(fid)))
    }
    // Sample.value (field 2)
    for (const v of values) {
      parts.push(fieldVarint(2, Math.max(0, v)))
    }
    // Sample.label (field 3) — per profile.proto Label message
    for (const lbl of labels) {
      const keyIdx = this.strings.intern(lbl.key)
      let labelBytes: Uint8Array
      if (lbl.isNumeric) {
        const n = Number(lbl.value)
        const numVal = isNaN(n) ? 0 : Math.round(n)
        labelBytes = concat(
          fieldVarint(1, keyIdx),  // Label.key
          fieldVarint(3, numVal),  // Label.num
        )
      } else {
        const strIdx = this.strings.intern(lbl.value)
        labelBytes = concat(
          fieldVarint(1, keyIdx),  // Label.key
          fieldVarint(2, strIdx),  // Label.str
        )
      }
      parts.push(fieldMessage(3, labelBytes))
    }
    this.samples.push(fieldMessage(2, concat(...parts)))
  }

  encode(): Uint8Array {
    const parts: Uint8Array[] = []

    for (let i = 0; i < this.metricNames.length; i++) {
      const typeIdx = this.strings.intern(this.metricNames[i])
      const unitIdx = this.strings.intern(this.metricUnits[i])
      parts.push(fieldMessage(1, concat(fieldVarint(1, typeIdx), fieldVarint(2, unitIdx))))
    }

    for (const s of this.samples) parts.push(s)
    for (const l of this.locationProtos) parts.push(l)
    for (const f of this.functionProtos) parts.push(f)
    parts.push(this.strings.encode())

    if (this.metricNames.length > 0) {
      parts.push(fieldVarint(15, this.strings.intern(this.metricNames[0])))
    }

    return concat(...parts)
  }
}

// ── Column value resolution ──

function resolveStringValue(row: Record<string, string>, col: ColumnInfo): string {
  if (col.jsonKey !== undefined) {
    const raw = row[col.source] ?? ''
    try {
      const obj = JSON.parse(raw.trim())
      return String(obj[col.jsonKey] ?? '')
    } catch {
      return ''
    }
  }
  return row[col.name] ?? ''
}

function resolveNumericValue(row: Record<string, string>, col: ColumnInfo): number {
  const s = resolveStringValue(row, col) || '0'
  const n = Number(s)
  return isNaN(n) ? 0 : Math.max(0, Math.round(n))
}


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
      const raw = row[col.source] ?? ''
      try {
        const arr = JSON.parse(raw.trim())
        if (Array.isArray(arr)) {
          const labelKey = jsonArrayLabelKey.get(col.name)
          for (const elem of arr) {
            if (typeof elem === 'object' && elem !== null && labelKey) {
              stack.push(String(elem[labelKey] ?? '(unknown)'))
            } else {
              stack.push(String(elem ?? '(null)'))
            }
          }
        }
      } catch {
        stack.push(raw || '(parse error)')
      }
    } else {
      const val = resolveStringValue(row, col)
      stack.push(val || '(empty)')
    }
  }

  return stack.length > 0 ? stack : ['(no frames)']
}

function getMetricValue(
  row: Record<string, string>,
  metricName: string,
  columns: ColumnInfo[],
): number {
  const col = columns.find(c => c.name === metricName)
  if (!col) return 0
  return resolveNumericValue(row, col)
}

function buildLabels(
  row: Record<string, string>,
  labelColumns: ColumnInfo[],
): SampleLabel[] {
  return labelColumns.map(col => {
    const value = resolveStringValue(row, col)
    return { key: col.name, value, isNumeric: col.isNumeric }
  })
}

function getPartitionKey(
  row: Record<string, string>,
  partitionColumns: string[],
  columns: ColumnInfo[],
): string {
  if (partitionColumns.length === 0) return ''
  return partitionColumns.map(name => {
    const col = columns.find(c => c.name === name)
    const val = col ? resolveStringValue(row, col) : ''
    return `${name}=${val}`
  }).join('|')
}

function parsePartitionKey(partKey: string): Record<string, string> {
  if (partKey === '') return {}
  const result: Record<string, string> = {}
  for (const part of partKey.split('|')) {
    const eq = part.indexOf('=')
    if (eq >= 0) result[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return result
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}


async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as ArrayBuffer]).stream()
    .pipeThrough(new CompressionStream('gzip'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return concat(...chunks)
}


export async function generateProfiles(
  data: ParsedData,
  columns: ColumnInfo[],
  config: ProfileConfig,
): Promise<GeneratedProfile[]> {
  if (config.frameOrder.length === 0) {
    throw new Error('At least one frame column must be selected')
  }

  const metricColumns = [...config.roles.entries()]
    .filter(([, role]) => role === 'metric')
    .map(([name]) => name)

  const labelColumnNames = [...config.roles.entries()]
    .filter(([, role]) => role === 'label')
    .map(([name]) => name)

  const labelColumnInfos = labelColumnNames
    .map(name => columns.find(c => c.name === name))
    .filter((c): c is ColumnInfo => c !== undefined)

  const partitionColumns = [...config.roles.entries()]
    .filter(([, role]) => role === 'partition')
    .map(([name]) => name)

  const allMetricNames = [...metricColumns, 'rows']
  const allMetricUnits = [
    ...metricColumns.map(n => config.metricUnits.get(n) ?? 'count'),
    'count',
  ]

  // Group rows by partition
  const partitions = new Map<string, Record<string, string>[]>()
  for (const row of data.rows) {
    const key = getPartitionKey(row, partitionColumns, columns)
    let bucket = partitions.get(key)
    if (!bucket) { bucket = []; partitions.set(key, bucket) }
    bucket.push(row)
  }

  const ts = timestamp()
  const profiles: GeneratedProfile[] = []

  for (const [partKey, rows] of partitions) {
    const builder = new PprofBuilder(allMetricNames, allMetricUnits)

    // When labels are present, each unique (stack + labels) combination
    // is a separate sample. Without labels, aggregate by stack only.
    const hasLabels = labelColumnInfos.length > 0

    if (hasLabels) {
      // With labels: each row becomes its own sample (labels vary per row)
      for (const row of rows) {
        const stack = buildStack(row, config.frameOrder, columns, config.jsonArrayLabelKey)
        const values = metricColumns.map(name => getMetricValue(row, name, columns))
        values.push(1)
        const labels = buildLabels(row, labelColumnInfos)
        builder.addSample(stack, values, labels)
      }
    } else {
      // Without labels: aggregate by stack
      const stacks = new Map<string, { stack: string[]; values: number[] }>()
      for (const row of rows) {
        const stack = buildStack(row, config.frameOrder, columns, config.jsonArrayLabelKey)
        const stackKey = stack.join('\x00')
        const values = metricColumns.map(name => getMetricValue(row, name, columns))
        values.push(1)

        const existing = stacks.get(stackKey)
        if (existing) {
          for (let i = 0; i < values.length; i++) existing.values[i] += values[i]
        } else {
          stacks.set(stackKey, { stack, values })
        }
      }
      for (const { stack, values } of stacks.values()) {
        builder.addSample(stack, values, [])
      }
    }

    const compressed = await gzipCompress(builder.encode())
    const partValues = parsePartitionKey(partKey)
    const displayParts = Object.values(partValues)

    let name: string
    let fileName: string
    if (partKey === '') {
      name = 'profile'
      fileName = `profile_${ts}.pb.gz`
    } else {
      name = displayParts.join(' / ')
      const safeName = displayParts
        .map(p => p.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40))
        .join('_')
      fileName = `profile_${safeName}_${ts}.pb.gz`
    }

    profiles.push({
      name,
      fileName,
      data: compressed,
      sampleCount: hasLabels ? rows.length : new Set(
        rows.map(row => buildStack(row, config.frameOrder, columns, config.jsonArrayLabelKey).join('\x00'))
      ).size,
      rowCount: rows.length,
      partitionValues: partValues,
    })
  }

  profiles.sort((a, b) => a.name.localeCompare(b.name))
  return profiles
}

// Exported for testing
export {
  varint, varintBig, fieldVarint, fieldBytes, fieldMessage, concat,
  PprofBuilder, StringTable,
  buildStack, getMetricValue, resolveStringValue, resolveNumericValue,
  parsePartitionKey, buildLabels, timestamp,
}
export type { SampleLabel }
