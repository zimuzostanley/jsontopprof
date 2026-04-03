// Web Worker for profile generation.
// Runs buildStack/aggregation/protobuf encoding off the main thread.

// Worker global scope — typed minimally to avoid adding webworker lib
// which conflicts with DOM lib used by the rest of the app.
const ctx = globalThis as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent) => void) | null
}

import { ParsedData, ColumnInfo, ProfileConfig } from './models/types'

// ── Re-implement the core generation logic here (workers can't share module scope) ──

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
      fieldVarint(1, fid), fieldVarint(2, nameIdx), fieldVarint(3, nameIdx),
    )))
    return fid
  }

  private getLocationId(funcId: number): number {
    const existing = this.locations.get(funcId)
    if (existing !== undefined) return existing
    const lid = this.nextLocId++
    this.locations.set(funcId, lid)
    this.locationProtos.push(fieldMessage(4, concat(
      fieldVarint(1, lid), fieldMessage(4, fieldVarint(1, funcId)),
    )))
    return lid
  }

  addSample(stack: string[], values: number[]): void {
    const parts: Uint8Array[] = []
    for (let i = stack.length - 1; i >= 0; i--) {
      const fid = this.getFunctionId(stack[i])
      parts.push(fieldVarint(1, this.getLocationId(fid)))
    }
    for (const v of values) parts.push(fieldVarint(2, Math.max(0, v)))
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
    } catch { return '' }
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

// ── Message types ──

export interface GenerateRequest {
  type: 'generate'
  data: ParsedData
  columns: ColumnInfo[]
  config: {
    roles: [string, string][]        // serialized Map
    frameOrder: string[]
    jsonArrayLabelKey: [string, string][]  // serialized Map
    metricUnits: [string, string][]        // serialized Map
  }
}

export interface ProgressMessage {
  type: 'progress'
  message: string
  pct: number
}

export interface ResultMessage {
  type: 'result'
  profiles: {
    name: string
    fileName: string
    data: ArrayBuffer
    sampleCount: number
    rowCount: number
    partitionValues: Record<string, string>
  }[]
}

export interface ErrorMessage {
  type: 'error'
  message: string
}

// ── Worker handler ──

function progress(message: string, pct: number): void {
  const msg: ProgressMessage = { type: 'progress', message, pct }
  ctx.postMessage(msg)
}

async function handleGenerate(req: GenerateRequest): Promise<void> {
  const { data, columns } = req
  const roles = new Map(req.config.roles)
  const frameOrder = req.config.frameOrder
  const jsonArrayLabelKey = new Map(req.config.jsonArrayLabelKey)
  const metricUnits = new Map(req.config.metricUnits)

  if (frameOrder.length === 0) {
    throw new Error('At least one frame column must be selected')
  }

  const metricColumns = [...roles.entries()]
    .filter(([, role]) => role === 'metric')
    .map(([name]) => name)

  const partitionColumns = [...roles.entries()]
    .filter(([, role]) => role === 'partition')
    .map(([name]) => name)

  const allMetricNames = [...metricColumns, 'rows']
  const allMetricUnits = [
    ...metricColumns.map(n => metricUnits.get(n) ?? 'count'),
    'count',
  ]

  progress('Grouping rows\u2026', 0)

  // Group by partition
  const partitions = new Map<string, Record<string, string>[]>()
  for (const row of data.rows) {
    const key = getPartitionKey(row, partitionColumns, columns)
    let bucket = partitions.get(key)
    if (!bucket) { bucket = []; partitions.set(key, bucket) }
    bucket.push(row)
  }

  const totalPartitions = partitions.size
  let partIdx = 0
  const results: ResultMessage['profiles'] = []

  for (const [partKey, rows] of partitions) {
    const pctBase = (partIdx / totalPartitions) * 100
    const pctRange = 100 / totalPartitions

    progress(
      totalPartitions > 1
        ? `Building profile ${partIdx + 1}/${totalPartitions}\u2026`
        : `Building profile\u2026`,
      pctBase,
    )

    const builder = new PprofBuilder(allMetricNames, allMetricUnits)
    const stacks = new Map<string, { stack: string[]; values: number[] }>()

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const stack = buildStack(row, frameOrder, columns, jsonArrayLabelKey)
      const stackKey = stack.join('\x00')
      const values = metricColumns.map(name => {
        const col = columns.find(c => c.name === name)
        return col ? resolveNumericValue(row, col) : 0
      })
      values.push(1)

      const existing = stacks.get(stackKey)
      if (existing) {
        for (let j = 0; j < values.length; j++) existing.values[j] += values[j]
      } else {
        stacks.set(stackKey, { stack, values })
      }

      // Progress every 5000 rows
      if (i > 0 && i % 5000 === 0) {
        progress(
          `Processing rows ${i.toLocaleString()}/${rows.length.toLocaleString()}\u2026`,
          pctBase + (i / rows.length) * pctRange * 0.7,
        )
      }
    }

    progress(
      totalPartitions > 1
        ? `Encoding profile ${partIdx + 1}/${totalPartitions}\u2026`
        : 'Encoding profile\u2026',
      pctBase + pctRange * 0.7,
    )

    for (const { stack, values } of stacks.values()) {
      builder.addSample(stack, values)
    }

    const rawData = builder.encode()

    progress(
      totalPartitions > 1
        ? `Compressing profile ${partIdx + 1}/${totalPartitions}\u2026`
        : 'Compressing\u2026',
      pctBase + pctRange * 0.85,
    )

    // Gzip in worker
    // Cast: TS types Uint8Array.buffer as ArrayBufferLike but Blob needs ArrayBuffer.
    // Safe in browser context (never SharedArrayBuffer).
    const blob = new Blob([rawData as unknown as ArrayBuffer])
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'))
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    const compressed = concat(...chunks)

    const partValues = parsePartitionKey(partKey)
    const displayParts = Object.values(partValues)

    let name: string
    let fileName: string
    if (partKey === '') {
      name = 'profile'
      fileName = 'profile.pb.gz'
    } else {
      name = displayParts.join(' / ')
      const safeName = displayParts
        .map(p => p.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40))
        .join('_')
      fileName = `profile_${safeName}.pb.gz`
    }

    // Transfer the underlying ArrayBuffer (zero-copy to main thread)
    const transferBuf = compressed.buffer instanceof ArrayBuffer
      ? compressed.buffer
      : compressed.slice().buffer as ArrayBuffer
    results.push({
      name,
      fileName,
      data: transferBuf,
      sampleCount: stacks.size,
      rowCount: rows.length,
      partitionValues: partValues,
    })

    partIdx++
  }

  results.sort((a, b) => a.name.localeCompare(b.name))

  const msg: ResultMessage = { type: 'result', profiles: results }
  const transfers = results.map(r => r.data)
  ctx.postMessage(msg, transfers as Transferable[])
}

ctx.onmessage = async (e: MessageEvent) => {
  try {
    if (e.data.type === 'generate') {
      await handleGenerate(e.data)
    }
  } catch (err: unknown) {
    const msg: ErrorMessage = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
    ctx.postMessage(msg)
  }
}
