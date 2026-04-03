// Integration tests covering feature combinations and edge cases
// that individual unit tests don't cover.

import { describe, it, expect } from 'vitest'
import { parseTSV, analyzeColumns, suggestDefaults } from './models/tsv'
import { generateProfiles } from './models/pprof'
import { serializeConfig, deserializeConfig } from './models/configWire'
import type { ProfileConfig, ColumnRole } from './models/types'

describe('all 5 roles combined', () => {
  const TSV = [
    'module\tfunc\tthread\tenv\tsize\tcount\tnotes',
    'libc\tmalloc\tmain\tprod\t4096\t100\tallocation',
    'libc\tfree\tworker\tprod\t0\t50\tdeallocation',
    'app\trender\tmain\tstaging\t2048\t200\tui work',
    'app\tparse\tworker\tstaging\t1024\t75\tparsing',
    'libc\tmalloc\tworker\tprod\t512\t30\tallocation',
  ].join('\n')

  function fullConfig(): ProfileConfig {
    return {
      roles: new Map<string, ColumnRole>([
        ['module', 'frame'],
        ['func', 'frame'],
        ['thread', 'label'],
        ['env', 'partition'],
        ['size', 'metric'],
        ['count', 'metric'],
        ['notes', 'none'],
      ]),
      frameOrder: ['module', 'func'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes'], ['count', 'objects']]),
    }
  }

  it('generates partitioned profiles with labels and multiple metrics', async () => {
    const data = parseTSV(TSV)
    const cols = analyzeColumns(data)
    const profiles = await generateProfiles(data, cols, fullConfig())

    // 2 partitions: prod (3 rows), staging (2 rows)
    expect(profiles.length).toBe(2)

    const prod = profiles.find(p => p.name === 'prod')!
    const staging = profiles.find(p => p.name === 'staging')!

    expect(prod.rowCount).toBe(3)
    expect(staging.rowCount).toBe(2)

    // With labels, each row is its own sample (no aggregation)
    expect(prod.sampleCount).toBe(3)
    expect(staging.sampleCount).toBe(2)

    // Valid gzip
    expect(prod.data[0]).toBe(0x1f)
    expect(staging.data[0]).toBe(0x1f)
  })

  it('filenames contain partition value and timestamp', async () => {
    const data = parseTSV(TSV)
    const cols = analyzeColumns(data)
    const profiles = await generateProfiles(data, cols, fullConfig())

    for (const p of profiles) {
      expect(p.fileName).toMatch(/^profile_(prod|staging)_\d{8}_\d{6}\.pb\.gz$/)
    }
  })

  it('config round-trips through serialization', () => {
    const config = fullConfig()
    const restored = deserializeConfig(serializeConfig(config))

    expect(restored.roles.size).toBe(7)
    expect(restored.roles.get('module')).toBe('frame')
    expect(restored.roles.get('thread')).toBe('label')
    expect(restored.roles.get('env')).toBe('partition')
    expect(restored.roles.get('notes')).toBe('none')
    expect(restored.frameOrder).toEqual(['module', 'func'])
    expect(restored.metricUnits.get('size')).toBe('bytes')
    expect(restored.metricUnits.get('count')).toBe('objects')
  })

  it('config survives JSON round-trip (localStorage path)', () => {
    const config = fullConfig()
    const json = JSON.stringify(serializeConfig(config))
    const restored = deserializeConfig(JSON.parse(json))

    expect(restored.roles.get('func')).toBe('frame')
    expect(restored.roles.get('thread')).toBe('label')
    expect(restored.metricUnits.get('size')).toBe('bytes')
  })
})

describe('suggestDefaults covers all column types', () => {
  it('never auto-assigns label or partition', () => {
    const data = parseTSV('a\tb\tc\n1\t2\t3')
    const cols = analyzeColumns(data)
    const { roles } = suggestDefaults(cols)

    for (const [, role] of roles) {
      expect(role).not.toBe('label')
      expect(role).not.toBe('partition')
    }
  })

  it('assigns frame to first string, metric to numbers', () => {
    const data = parseTSV('name\tcount\tsize\nfoo\t10\t200')
    const cols = analyzeColumns(data)
    const { roles, frameOrder } = suggestDefaults(cols)

    expect(roles.get('name')).toBe('frame')
    expect(roles.get('count')).toBe('metric')
    expect(roles.get('size')).toBe('metric')
    expect(frameOrder).toEqual(['name'])
  })
})

describe('labels without metrics', () => {
  it('generates profiles with only labels and rows metric', async () => {
    const data = parseTSV('func\tthread\nfoo\tmain\nbar\tworker')
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['func', 'frame'], ['thread', 'label']]),
      frameOrder: ['func'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map(),
    })

    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBe(2)
    expect(profiles[0].rowCount).toBe(2)
  })
})

describe('partition with labels from JSON sub-fields', () => {
  it('handles JSON sub-field as label + partition', async () => {
    const data = parseTSV([
      'func\tmeta',
      'foo\t{"env":"prod","owner":"alice"}',
      'bar\t{"env":"staging","owner":"bob"}',
      'baz\t{"env":"prod","owner":"carol"}',
    ].join('\n'))
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map<string, ColumnRole>([
        ['func', 'frame'],
        ['meta.env', 'partition'],
        ['meta.owner', 'label'],
      ]),
      frameOrder: ['func'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map(),
    })

    expect(profiles.length).toBe(2)
    const prod = profiles.find(p => p.name === 'prod')!
    expect(prod.rowCount).toBe(2)
    expect(prod.sampleCount).toBe(2) // labels prevent aggregation
  })
})

describe('frame order matters', () => {
  it('different frame order produces different stacks', async () => {
    const data = parseTSV('a\tb\tsize\nx\ty\t100')
    const cols = analyzeColumns(data)

    const profileAB = await generateProfiles(data, cols, {
      roles: new Map([['a', 'frame'], ['b', 'frame'], ['size', 'metric']]),
      frameOrder: ['a', 'b'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    })

    const profileBA = await generateProfiles(data, cols, {
      roles: new Map([['a', 'frame'], ['b', 'frame'], ['size', 'metric']]),
      frameOrder: ['b', 'a'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    })

    // Both produce 1 profile with 1 sample, but internal stack order differs
    expect(profileAB[0].sampleCount).toBe(1)
    expect(profileBA[0].sampleCount).toBe(1)
    // Data should differ because pprof encodes stack order
    expect(profileAB[0].data).not.toEqual(profileBA[0].data)
  })
})

describe('JSON array as frame stack with outer columns', () => {
  // Simulates Perfetto heap dominator format:
  // outer columns (process_name, self_size, self_count) + JSON array (path)
  // The JSON array defines the stack frames, outer columns are root frame / metrics.
  function perfettoStyleTSV(): string {
    return [
      'process_name\tself_size\tself_count\tpath',
      'system_server\t8192\t10\t"[{\\"class\\":\\"android.app.ActivityThread\\",\\"heap_type\\":\\"HEAP_TYPE_APP\\"},{\\"class\\":\\"android.view.View\\",\\"heap_type\\":\\"HEAP_TYPE_NATIVE\\"}]"',
      'com.example\t4096\t5\t"[{\\"class\\":\\"com.example.MainActivity\\",\\"heap_type\\":\\"HEAP_TYPE_APP\\"}]"',
      'system_server\t16384\t2\t"[{\\"class\\":\\"android.graphics.Bitmap\\",\\"heap_type\\":\\"HEAP_TYPE_NATIVE\\"}]"',
    ].join('\n')
  }

  it('parses backslash-escaped JSON array column', () => {
    const data = parseTSV(perfettoStyleTSV())
    expect(data.rows).toHaveLength(3)
    // path should parse as JSON after TSV unescaping
    const path = JSON.parse(data.rows[0].path)
    expect(path).toHaveLength(2)
    expect(path[0].class).toBe('android.app.ActivityThread')
  })

  it('detects JSON array column with object keys', () => {
    const data = parseTSV(perfettoStyleTSV())
    const cols = analyzeColumns(data)
    const pathCol = cols.find(c => c.name === 'path')
    expect(pathCol?.isJsonArray).toBe(true)
    expect(pathCol?.jsonArrayKeys).toContain('class')
    expect(pathCol?.jsonArrayKeys).toContain('heap_type')
  })

  it('generates profile with outer column as root frame + JSON array as stack', async () => {
    const data = parseTSV(perfettoStyleTSV())
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map<string, ColumnRole>([
        ['process_name', 'frame'],
        ['path', 'frame'],
        ['self_size', 'metric'],
        ['self_count', 'metric'],
      ]),
      frameOrder: ['process_name', 'path'],
      jsonArrayLabelKey: new Map([['path', 'class']]),
      metricUnits: new Map([['self_size', 'bytes'], ['self_count', 'objects']]),
    })

    expect(profiles).toHaveLength(1)
    expect(profiles[0].rowCount).toBe(3)
    // 3 unique stacks (all different leaf frames)
    expect(profiles[0].sampleCount).toBe(3)
    expect(profiles[0].data[0]).toBe(0x1f) // gzip

    // Text samples should show the full stack
    const ts = profiles[0].textSamples
    expect(ts.length).toBe(3)
    // First sample stack: system_server -> ActivityThread -> View
    const first = ts.find(s => s.stack.includes('android.view.View'))!
    expect(first.stack[0]).toBe('system_server')
    expect(first.stack[1]).toBe('android.app.ActivityThread')
    expect(first.stack[2]).toBe('android.view.View')
    expect(first.values.self_size).toBe(8192)
  })

  it('partitions by outer column while using JSON array for frames', async () => {
    const data = parseTSV(perfettoStyleTSV())
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map<string, ColumnRole>([
        ['process_name', 'partition'],
        ['path', 'frame'],
        ['self_size', 'metric'],
        ['self_count', 'metric'],
      ]),
      frameOrder: ['path'],
      jsonArrayLabelKey: new Map([['path', 'class']]),
      metricUnits: new Map([['self_size', 'bytes'], ['self_count', 'objects']]),
    })

    // 2 processes = 2 partitions
    expect(profiles.length).toBe(2)
    const server = profiles.find(p => p.name === 'system_server')!
    const app = profiles.find(p => p.name === 'com.example')!
    expect(server.rowCount).toBe(2)
    expect(app.rowCount).toBe(1)
  })

  it('uses outer column as label while JSON array provides frames', async () => {
    const data = parseTSV(perfettoStyleTSV())
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map<string, ColumnRole>([
        ['process_name', 'label'],
        ['path', 'frame'],
        ['self_size', 'metric'],
      ]),
      frameOrder: ['path'],
      jsonArrayLabelKey: new Map([['path', 'class']]),
      metricUnits: new Map([['self_size', 'bytes']]),
    })

    expect(profiles).toHaveLength(1)
    // With labels, each row is own sample
    expect(profiles[0].sampleCount).toBe(3)
    // Text samples should have process_name as label
    const ts = profiles[0].textSamples
    expect(ts[0].labels.process_name).toBeDefined()
  })
})

describe('empty and degenerate inputs', () => {
  it('single column, single row', async () => {
    const data = parseTSV('x\nval')
    const cols = analyzeColumns(data)
    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['x', 'frame']]),
      frameOrder: ['x'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map(),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBe(1)
  })

  it('all columns as none except one frame', async () => {
    const data = parseTSV('a\tb\tc\nd\te\tf')
    const cols = analyzeColumns(data)
    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['a', 'frame'], ['b', 'none'], ['c', 'none']]),
      frameOrder: ['a'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map(),
    })
    expect(profiles).toHaveLength(1)
  })

  it('many partitions from high-cardinality column', async () => {
    const lines = ['id\tname']
    for (let i = 0; i < 50; i++) lines.push(`${i}\titem_${i}`)
    const data = parseTSV(lines.join('\n'))
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['name', 'frame'], ['id', 'partition']]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map(),
    })
    expect(profiles.length).toBe(50)
  })
})
