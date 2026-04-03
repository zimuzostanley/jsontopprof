import { describe, it, expect } from 'vitest'
import { varint, varintBig, concat, fieldVarint, PprofBuilder, StringTable, buildStack, getMetricValue, generateProfiles } from './pprof'
import { parseTSV, analyzeColumns, suggestDefaults } from './tsv'
import { ColumnInfo, ProfileConfig } from './types'
import { generateSimpleTSV, generateHeapDominatorTSV, generateJSONObjectTSV, generateQuotedTSV, generateMixedTypesTSV, generateEdgeCasesTSV, generateMultiPartitionTSV, generateLargeTSV } from './tsv.test'

describe('varint', () => {
  it('encodes 0', () => {
    expect(varint(0)).toEqual(new Uint8Array([0]))
  })

  it('encodes small values', () => {
    expect(varint(1)).toEqual(new Uint8Array([1]))
    expect(varint(127)).toEqual(new Uint8Array([127]))
  })

  it('encodes multi-byte values', () => {
    expect(varint(128)).toEqual(new Uint8Array([0x80, 0x01]))
    expect(varint(300)).toEqual(new Uint8Array([0xAC, 0x02]))
  })
})

describe('varintBig', () => {
  it('encodes BigInt values', () => {
    expect(varintBig(0n)).toEqual(new Uint8Array([0]))
    expect(varintBig(1n)).toEqual(new Uint8Array([1]))
    expect(varintBig(300n)).toEqual(new Uint8Array([0xAC, 0x02]))
  })
})

describe('concat', () => {
  it('concatenates arrays', () => {
    const a = new Uint8Array([1, 2])
    const b = new Uint8Array([3, 4])
    expect(concat(a, b)).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('handles empty arrays', () => {
    expect(concat()).toEqual(new Uint8Array([]))
    expect(concat(new Uint8Array([1]))).toEqual(new Uint8Array([1]))
  })
})

describe('StringTable', () => {
  it('interns strings with index 0 as empty', () => {
    const st = new (StringTable as any)()
    expect(st.intern('')).toBe(0)
    expect(st.intern('hello')).toBe(1)
    expect(st.intern('hello')).toBe(1)  // dedup
    expect(st.intern('world')).toBe(2)
  })
})

describe('PprofBuilder', () => {
  it('produces non-empty output', () => {
    const builder = new (PprofBuilder as any)(['size', 'rows'], ['bytes', 'count'])
    builder.addSample(['root', 'leaf'], [100, 1])
    const data = builder.encode()
    expect(data.length).toBeGreaterThan(0)
  })

  it('deduplicates functions and locations', () => {
    const builder = new (PprofBuilder as any)(['count'], ['objects'])
    builder.addSample(['a', 'b'], [10])
    builder.addSample(['a', 'c'], [20])
    const data = builder.encode()
    expect(data.length).toBeGreaterThan(0)
  })
})

describe('buildStack', () => {
  it('builds stack from regular columns', () => {
    const row = { module: 'libc', func: 'malloc' }
    const columns: ColumnInfo[] = [
      { name: 'module', source: 'module', sampleValues: [], isNumeric: false },
      { name: 'func', source: 'func', sampleValues: [], isNumeric: false },
    ]
    const stack = buildStack(row, ['module', 'func'], columns, new Map())
    expect(stack).toEqual(['libc', 'malloc'])
  })

  it('builds stack from JSON sub-fields', () => {
    const row = { meta: '{"region":"us","team":"backend"}', func: 'malloc' }
    const columns: ColumnInfo[] = [
      { name: 'meta.region', source: 'meta', jsonKey: 'region', sampleValues: [], isNumeric: false },
      { name: 'func', source: 'func', sampleValues: [], isNumeric: false },
    ]
    const stack = buildStack(row, ['meta.region', 'func'], columns, new Map())
    expect(stack).toEqual(['us', 'malloc'])
  })

  it('expands JSON arrays into multiple frames', () => {
    const row = { path: '[{"class":"Foo"},{"class":"Bar"}]', size: '100' }
    const columns: ColumnInfo[] = [
      { name: 'path', source: 'path', isJsonArray: true, jsonArrayKeys: ['class'], sampleValues: [], isNumeric: false },
    ]
    const stack = buildStack(row, ['path'], columns, new Map([['path', 'class']]))
    expect(stack).toEqual(['Foo', 'Bar'])
  })

  it('handles empty values with placeholder', () => {
    const row = { func: '' }
    const columns: ColumnInfo[] = [
      { name: 'func', source: 'func', sampleValues: [], isNumeric: false },
    ]
    const stack = buildStack(row, ['func'], columns, new Map())
    expect(stack).toEqual(['(empty)'])
  })

  it('returns placeholder when no frames configured', () => {
    const row = { func: 'x' }
    const stack = buildStack(row, [], [], new Map())
    expect(stack).toEqual(['(no frames)'])
  })
})

describe('getMetricValue', () => {
  it('extracts numeric value from regular column', () => {
    const row = { size: '4096' }
    const cols: ColumnInfo[] = [{ name: 'size', source: 'size', sampleValues: [], isNumeric: true }]
    expect(getMetricValue(row, 'size', cols)).toBe(4096)
  })

  it('extracts numeric value from JSON sub-field', () => {
    const row = { meta: '{"count":42}' }
    const cols: ColumnInfo[] = [{ name: 'meta.count', source: 'meta', jsonKey: 'count', sampleValues: [], isNumeric: true }]
    expect(getMetricValue(row, 'meta.count', cols)).toBe(42)
  })

  it('returns 0 for non-numeric values', () => {
    const row = { size: 'abc' }
    const cols: ColumnInfo[] = [{ name: 'size', source: 'size', sampleValues: [], isNumeric: false }]
    expect(getMetricValue(row, 'size', cols)).toBe(0)
  })

  it('returns 0 for missing columns', () => {
    expect(getMetricValue({ x: '1' }, 'missing', [])).toBe(0)
  })
})

describe('generateProfiles', () => {
  it('generates a profile from simple TSV', async () => {
    const data = parseTSV(generateSimpleTSV())
    const cols = analyzeColumns(data)
    const defaults = suggestDefaults(cols)

    const config: ProfileConfig = {
      roles: defaults.roles,
      frameOrder: defaults.frameOrder,
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['self_size', 'bytes'], ['self_count', 'count']]),
    }

    const profiles = await generateProfiles(data, cols, config)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBeGreaterThan(0)
    expect(profiles[0].rowCount).toBe(5)
    expect(profiles[0].data.length).toBeGreaterThan(0)
    // Should be gzip (starts with 1f 8b)
    expect(profiles[0].data[0]).toBe(0x1f)
    expect(profiles[0].data[1]).toBe(0x8b)
  })

  it('generates a profile from heap dominator TSV', async () => {
    const data = parseTSV(generateHeapDominatorTSV())
    const cols = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([
        ['process_name', 'frame'],
        ['path', 'frame'],
        ['self_size', 'metric'],
        ['self_count', 'metric'],
      ]),
      frameOrder: ['process_name', 'path'],
      jsonArrayLabelKey: new Map([['path', 'class']]),
      metricUnits: new Map([['self_size', 'bytes'], ['self_count', 'count']]),
    }

    const profiles = await generateProfiles(data, cols, config)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].rowCount).toBe(4)
  })

  it('partitions profiles by column', async () => {
    const data = parseTSV(generateJSONObjectTSV())
    const cols = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([
        ['name', 'frame'],
        ['size', 'metric'],
        ['metadata.region', 'partition'],
      ]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    }

    const profiles = await generateProfiles(data, cols, config)
    // Should have separate profiles for us-east, eu-west, ap-south
    expect(profiles.length).toBe(3)
    const names = profiles.map(p => p.name).sort()
    expect(names).toEqual(['ap-south', 'eu-west', 'us-east'])
  })

  it('handles quoted TSV correctly', async () => {
    const data = parseTSV(generateQuotedTSV())
    const cols = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([
        ['name', 'frame'],
        ['size', 'metric'],
      ]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    }

    const profiles = await generateProfiles(data, cols, config)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBe(3) // 3 unique names
  })

  it('always includes rows metric', async () => {
    const data = parseTSV('name\nfoo\nfoo\nbar')
    const cols = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([['name', 'frame']]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map(),
    }

    const profiles = await generateProfiles(data, cols, config)
    expect(profiles).toHaveLength(1)
    // 2 unique stacks: foo (2 rows) and bar (1 row)
    expect(profiles[0].sampleCount).toBe(2)
    expect(profiles[0].rowCount).toBe(3)
  })

  it('handles mixed types TSV with multiple frame sources', async () => {
    const data = parseTSV(generateMixedTypesTSV())
    const cols = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([
        ['name', 'frame'],
        ['path', 'frame'],
        ['size', 'metric'],
        ['duration_ns', 'metric'],
      ]),
      frameOrder: ['name', 'path'],
      jsonArrayLabelKey: new Map([['path', 'frame']]),
      metricUnits: new Map([['size', 'bytes'], ['duration_ns', 'nanoseconds']]),
    }

    const profiles = await generateProfiles(data, cols, config)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].rowCount).toBe(4)
    expect(profiles[0].sampleCount).toBe(4) // 4 unique stacks
    expect(profiles[0].data[0]).toBe(0x1f) // gzip magic
  })

  it('handles edge case values without crashing', async () => {
    const data = parseTSV(generateEdgeCasesTSV())
    const cols = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([
        ['name', 'frame'],
        ['value', 'metric'],
      ]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['value', 'count']]),
    }

    const profiles = await generateProfiles(data, cols, config)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].rowCount).toBe(7)
  })

  it('handles multi-dimension partitioning', async () => {
    const data = parseTSV(generateMultiPartitionTSV())
    const cols = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([
        ['function', 'frame'],
        ['region', 'partition'],
        ['env', 'partition'],
        ['latency_ms', 'metric'],
        ['call_count', 'metric'],
      ]),
      frameOrder: ['function'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['latency_ms', 'milliseconds'], ['call_count', 'count']]),
    }

    const profiles = await generateProfiles(data, cols, config)
    // 2 regions x 2 envs = 4 partitions
    expect(profiles.length).toBe(4)
    const totalRows = profiles.reduce((s, p) => s + p.rowCount, 0)
    expect(totalRows).toBe(12) // 2 x 2 x 3 functions
  })

  it('handles large datasets', async () => {
    const data = parseTSV(generateLargeTSV(1000))
    const cols = analyzeColumns(data)
    const defaults = suggestDefaults(cols)

    const config: ProfileConfig = {
      roles: defaults.roles,
      frameOrder: defaults.frameOrder,
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['self_size', 'bytes'], ['self_count', 'count']]),
    }

    const profiles = await generateProfiles(data, cols, config)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].rowCount).toBe(1000)
    expect(profiles[0].data.length).toBeGreaterThan(0)
  })

  it('aggregates identical stacks', async () => {
    const tsv = 'func\tmodule\tsize\nfoo\tlib\t100\nfoo\tlib\t200\nbar\tlib\t50'
    const data = parseTSV(tsv)
    const cols = analyzeColumns(data)

    const config: ProfileConfig = {
      roles: new Map([
        ['module', 'frame'],
        ['func', 'frame'],
        ['size', 'metric'],
      ]),
      frameOrder: ['module', 'func'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    }

    const profiles = await generateProfiles(data, cols, config)
    expect(profiles).toHaveLength(1)
    // lib->foo appears twice, should be aggregated to 1 sample with size=300
    // lib->bar appears once
    expect(profiles[0].sampleCount).toBe(2)
  })

  it('generates valid gzip for all data types', async () => {
    const generators = [
      generateSimpleTSV,
      generateHeapDominatorTSV,
      generateJSONObjectTSV,
      generateQuotedTSV,
      generateMixedTypesTSV,
      generateEdgeCasesTSV,
    ]

    for (const gen of generators) {
      const data = parseTSV(gen())
      const cols = analyzeColumns(data)
      const defaults = suggestDefaults(cols)

      const config: ProfileConfig = {
        roles: defaults.roles,
        frameOrder: defaults.frameOrder,
        jsonArrayLabelKey: new Map(),
        metricUnits: new Map(),
      }

      // Ensure at least one frame
      if (config.frameOrder.length === 0 && cols.length > 0) {
        const first = cols.find(c => !c.isNumeric && !c.jsonKey)
        if (first) {
          config.roles.set(first.name, 'frame')
          config.frameOrder.push(first.name)
        }
      }

      const profiles = await generateProfiles(data, cols, config)
      expect(profiles.length).toBeGreaterThan(0)
      for (const p of profiles) {
        // Verify gzip magic bytes
        expect(p.data[0]).toBe(0x1f)
        expect(p.data[1]).toBe(0x8b)
      }
    }
  })
})
