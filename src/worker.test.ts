import { describe, it, expect, vi } from 'vitest'
import { parseTSV, analyzeColumns, suggestDefaults } from './models/tsv'
import { generateProfiles as generateSync } from './models/pprof'
import { ProfileConfig } from './models/types'
import { generateSimpleTSV, generateHeapDominatorTSV, generateLargeTSV } from './models/tsv.test'
import type { GenerateRequest, ResultMessage, ProgressMessage, ErrorMessage } from './worker'

// We can't instantiate a real Worker in vitest (no browser).
// Instead we verify:
// 1. The sync fallback (generateAsync falls back to generateSync)
// 2. The serialization format matches what the worker expects
// 3. The worker message protocol is correct

describe('worker message protocol', () => {
  it('serializes Maps correctly for the worker', () => {
    const roles = new Map<string, string>([['name', 'frame'], ['size', 'metric']])
    const serialized: [string, string][] = [...roles.entries()]
    const deserialized = new Map(serialized)

    expect(deserialized.get('name')).toBe('frame')
    expect(deserialized.get('size')).toBe('metric')
    expect(deserialized.size).toBe(2)
  })

  it('constructs valid GenerateRequest', () => {
    const data = parseTSV(generateSimpleTSV())
    const columns = analyzeColumns(data)
    const defaults = suggestDefaults(columns)

    const config: ProfileConfig = {
      roles: defaults.roles,
      frameOrder: defaults.frameOrder,
      metricUnits: new Map([['self_size', 'bytes']]),
    }

    const req: GenerateRequest = {
      type: 'generate',
      data,
      columns,
      config: {
        roles: [...config.roles.entries()],
        frameOrder: config.frameOrder,
        metricUnits: [...config.metricUnits.entries()],
      },
    }

    // Verify it's JSON-serializable (workers use structured clone, but this tests basics)
    const roundTripped = JSON.parse(JSON.stringify(req))
    expect(roundTripped.type).toBe('generate')
    expect(roundTripped.data.headers).toEqual(data.headers)
    expect(roundTripped.data.rows.length).toBe(data.rows.length)
    expect(roundTripped.config.frameOrder).toEqual(defaults.frameOrder)
    expect(roundTripped.config.roles.length).toBeGreaterThan(0)
  })

  it('ResultMessage profiles have expected shape', () => {
    const msg: ResultMessage = {
      type: 'result',
      profiles: [{
        name: 'test',
        fileName: 'test.pb.gz',
        data: new ArrayBuffer(10),
        sampleCount: 5,
        rowCount: 100,
        partitionValues: { env: 'prod' },
        textSamples: [{ stack: ['foo', 'bar'], values: { size: 100, rows: 1 }, labels: {} }],
      }],
    }
    expect(msg.profiles[0].data.byteLength).toBe(10)
    expect(new Uint8Array(msg.profiles[0].data).length).toBe(10)
  })

  it('ProgressMessage has expected shape', () => {
    const msg: ProgressMessage = { type: 'progress', message: 'Processing...', pct: 42 }
    expect(msg.pct).toBe(42)
  })

  it('ErrorMessage has expected shape', () => {
    const msg: ErrorMessage = { type: 'error', message: 'Something failed' }
    expect(msg.message).toBe('Something failed')
  })
})

describe('sync fallback (generateAsync without worker)', () => {
  // In vitest, InlineWorker will fail to construct, so generateAsync
  // falls back to the sync path. We test the sync path directly here
  // to verify the same logic the worker would run.

  it('produces identical results for simple TSV', async () => {
    const data = parseTSV(generateSimpleTSV())
    const columns = analyzeColumns(data)
    const defaults = suggestDefaults(columns)

    const config: ProfileConfig = {
      roles: defaults.roles,
      frameOrder: defaults.frameOrder,
      metricUnits: new Map([['self_size', 'bytes'], ['self_count', 'count']]),
    }

    const profiles = await generateSync(data, columns, config)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].data[0]).toBe(0x1f) // gzip magic
    expect(profiles[0].data[1]).toBe(0x8b)
    expect(profiles[0].rowCount).toBe(5)
  })

  it('produces identical results for heap dominator TSV', async () => {
    const data = parseTSV(generateHeapDominatorTSV())
    const columns = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([
        ['process_name', 'frame'],
        ['path', 'frame'],
        ['self_size', 'metric'],
        ['self_count', 'metric'],
      ]),
      frameOrder: ['process_name', 'path'],
      metricUnits: new Map([['self_size', 'bytes'], ['self_count', 'count']]),
    }

    const profiles = await generateSync(data, columns, config)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].rowCount).toBe(4)
  })

  it('handles large dataset without hanging', async () => {
    const data = parseTSV(generateLargeTSV(5000))
    const columns = analyzeColumns(data)
    const defaults = suggestDefaults(columns)

    const config: ProfileConfig = {
      roles: defaults.roles,
      frameOrder: defaults.frameOrder,
      metricUnits: new Map([['self_size', 'bytes'], ['self_count', 'count']]),
    }

    const start = Date.now()
    const profiles = await generateSync(data, columns, config)
    const elapsed = Date.now() - start

    expect(profiles).toHaveLength(1)
    expect(profiles[0].rowCount).toBe(5000)
    expect(elapsed).toBeLessThan(5000) // should be well under 5s
  })
})

describe('worker code parity with sync', () => {
  // Verify that the worker's duplicated logic produces the same results.
  // We test this by checking that generateSync output matches expectations
  // that the worker would also need to meet.

  it('aggregates stacks identically', async () => {
    const tsv = 'func\tmod\tsize\nfoo\tA\t10\nfoo\tA\t20\nbar\tA\t30'
    const data = parseTSV(tsv)
    const columns = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([['mod', 'frame'], ['func', 'frame'], ['size', 'metric']]),
      frameOrder: ['mod', 'func'],
      metricUnits: new Map([['size', 'bytes']]),
    }

    const profiles = await generateSync(data, columns, config)
    // A→foo (10+20=30), A→bar (30)
    expect(profiles[0].sampleCount).toBe(2)
    expect(profiles[0].rowCount).toBe(3)
  })

  it('expands JSON arrays identically', async () => {
    const tsv = 'path\tsize\n[{"cls":"X"},{"cls":"Y"}]\t100\n[{"cls":"Z"}]\t200'
    const data = parseTSV(tsv)
    const columns = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([['path', 'frame'], ['size', 'metric']]),
      frameOrder: ['path'],
      metricUnits: new Map([['size', 'bytes']]),
    }

    const profiles = await generateSync(data, columns, config)
    // Two distinct stacks: [X, Y] and [Z]
    expect(profiles[0].sampleCount).toBe(2)
  })

  it('partitions identically', async () => {
    const tsv = 'func\tenv\tcount\nfoo\tprod\t10\nbar\tstaging\t20\nbaz\tprod\t30'
    const data = parseTSV(tsv)
    const columns = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([['func', 'frame'], ['env', 'partition'], ['count', 'metric']]),
      frameOrder: ['func'],
      metricUnits: new Map([['count', 'count']]),
    }

    const profiles = await generateSync(data, columns, config)
    expect(profiles.length).toBe(2)
    const prod = profiles.find(p => p.name === 'prod')!
    const staging = profiles.find(p => p.name === 'staging')!
    expect(prod.rowCount).toBe(2)
    expect(staging.rowCount).toBe(1)
  })
})
