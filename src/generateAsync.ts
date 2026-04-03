import InlineWorker from './worker?worker&inline'
import { ParsedData, ColumnInfo, ProfileConfig, GeneratedProfile } from './models/types'
import { generateProfiles as generateSync } from './models/pprof'
import { serializeConfig } from './models/configWire'
import type { GenerateRequest, ProgressMessage, ResultMessage, ErrorMessage } from './worker'

let _worker: Worker | null = null
let _workerFailed = false

function getWorker(): Worker | null {
  if (_workerFailed) return null
  if (_worker) return _worker
  try {
    _worker = new InlineWorker()
    return _worker
  } catch {
    _workerFailed = true
    return null
  }
}

export interface GenerateProgress {
  message: string
  pct: number
}

export async function generateProfilesAsync(
  data: ParsedData,
  columns: ColumnInfo[],
  config: ProfileConfig,
  onProgress?: (p: GenerateProgress) => void,
): Promise<GeneratedProfile[]> {
  const worker = getWorker()

  if (!worker) {
    onProgress?.({ message: 'Building profiles\u2026', pct: 50 })
    return generateSync(data, columns, config)
  }

  return new Promise<GeneratedProfile[]>((resolve, reject) => {
    const req: GenerateRequest = {
      type: 'generate',
      data,
      columns,
      config: serializeConfig(config),
    }

    worker.onmessage = (e: MessageEvent<ProgressMessage | ResultMessage | ErrorMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        onProgress?.({ message: msg.message, pct: msg.pct })
      } else if (msg.type === 'result') {
        resolve(msg.profiles.map(p => ({
          name: p.name,
          fileName: p.fileName,
          data: new Uint8Array(p.data),
          sampleCount: p.sampleCount,
          rowCount: p.rowCount,
          partitionValues: p.partitionValues,
          textSamples: p.textSamples,
        })))
      } else if (msg.type === 'error') {
        reject(new Error(msg.message))
      }
    }

    worker.onerror = (e: ErrorEvent) => {
      reject(new Error(e.message || 'Worker error'))
    }

    worker.postMessage(req)
  })
}
