// Web Worker for profile generation.
// Imports shared modules — Vite inlines everything into the worker blob.

import { generateProfiles } from './models/pprof'
import type { ParsedData, ColumnInfo, ProfileConfig, ColumnRole } from './models/types'

// Worker global scope — typed minimally to avoid webworker lib
// conflicting with DOM lib used by the rest of the app.
const ctx = globalThis as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent) => void) | null
}

// ── Message types ──

export interface GenerateRequest {
  type: 'generate'
  data: ParsedData
  columns: ColumnInfo[]
  config: {
    roles: [string, string][]
    frameOrder: string[]
    jsonArrayLabelKey: [string, string][]
    metricUnits: [string, string][]
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

// ── Handler ──

async function handleGenerate(req: GenerateRequest): Promise<void> {
  ctx.postMessage({ type: 'progress', message: 'Building profiles\u2026', pct: 10 } satisfies ProgressMessage)

  const config: ProfileConfig = {
    roles: new Map(req.config.roles as [string, ColumnRole][]),
    frameOrder: req.config.frameOrder,
    jsonArrayLabelKey: new Map(req.config.jsonArrayLabelKey),
    metricUnits: new Map(req.config.metricUnits),
  }

  ctx.postMessage({ type: 'progress', message: 'Processing rows\u2026', pct: 30 } satisfies ProgressMessage)

  const profiles = await generateProfiles(req.data, req.columns, config)

  ctx.postMessage({ type: 'progress', message: 'Finalizing\u2026', pct: 90 } satisfies ProgressMessage)

  // Convert Uint8Array to transferable ArrayBuffers
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
    }
  })

  const msg: ResultMessage = { type: 'result', profiles: results }
  ctx.postMessage(msg, results.map(r => r.data) as Transferable[])
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
