import { generateProfiles } from './models/pprof'
import { deserializeConfig } from './models/configWire'
import type { SerializedConfig } from './models/configWire'
import type { ParsedData, ColumnInfo } from './models/types'

const ctx = globalThis as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent) => void) | null
}

export interface GenerateRequest {
  type: 'generate'
  data: ParsedData
  columns: ColumnInfo[]
  config: SerializedConfig
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
    textSamples: { stack: string[]; values: Record<string, number> }[]
  }[]
}

export interface ErrorMessage {
  type: 'error'
  message: string
}

function progress(message: string, pct: number): void {
  ctx.postMessage({ type: 'progress', message, pct } satisfies ProgressMessage)
}

async function handleGenerate(req: GenerateRequest): Promise<void> {
  progress('Building profiles\u2026', 10)
  const config = deserializeConfig(req.config)

  progress('Processing rows\u2026', 30)
  const profiles = await generateProfiles(req.data, req.columns, config)

  progress('Finalizing\u2026', 90)
  const results: ResultMessage['profiles'] = profiles.map(p => {
    const buf = p.data.buffer instanceof ArrayBuffer
      ? p.data.buffer
      : p.data.slice().buffer as ArrayBuffer
    return {
      name: p.name,
      fileName: p.fileName,
      data: buf,
      sampleCount: p.sampleCount,
      rowCount: p.rowCount,
      partitionValues: p.partitionValues,
      textSamples: p.textSamples,
    }
  })

  progress('Done', 100)
  const msg: ResultMessage = { type: 'result', profiles: results }
  ctx.postMessage(msg, results.map(r => r.data) as Transferable[])
}

ctx.onmessage = async (e: MessageEvent) => {
  try {
    if (e.data.type === 'generate') await handleGenerate(e.data)
  } catch (err: unknown) {
    const msg: ErrorMessage = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
    ctx.postMessage(msg)
  }
}
