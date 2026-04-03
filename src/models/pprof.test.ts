import { describe, it, expect } from 'vitest'
import {
  varint, varintBig, concat, fieldVarint,
  PprofBuilder, StringTable,
  buildStack, getMetricValue, resolveStringValue, resolveNumericValue,
  parsePartitionKey, buildLabels, generateProfiles,
} from './pprof'
import type { SampleLabel } from './pprof'
import { parseTSV, analyzeColumns, suggestDefaults } from './tsv'
import { ColumnInfo, ProfileConfig } from './types'
import {
  generateSimpleTSV, generateHeapDominatorTSV, generateJSONObjectTSV,
  generateQuotedTSV, generateMixedTypesTSV, generateEdgeCasesTSV,
  generateMultiPartitionTSV, generateLargeTSV,
} from './tsv.test'

// ── Protobuf encoding ──

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
    expect(concat(new Uint8Array([1, 2]), new Uint8Array([3, 4]))).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('handles empty', () => {
    expect(concat()).toEqual(new Uint8Array([]))
    expect(concat(new Uint8Array([1]))).toEqual(new Uint8Array([1]))
  })
})

describe('StringTable', () => {
  it('interns with index 0 as empty', () => {
    const st = new (StringTable as any)()
    expect(st.intern('')).toBe(0)
    expect(st.intern('hello')).toBe(1)
    expect(st.intern('hello')).toBe(1)
    expect(st.intern('world')).toBe(2)
  })
})

describe('PprofBuilder', () => {
  it('produces non-empty output', () => {
    const b = new (PprofBuilder as any)(['size', 'rows'], ['bytes', 'count'])
    b.addSample(['root', 'leaf'], [100, 1], [])
    expect(b.encode().length).toBeGreaterThan(0)
  })

  it('deduplicates functions and locations', () => {
    const b = new (PprofBuilder as any)(['count'], ['objects'])
    b.addSample(['a', 'b'], [10], [])
    b.addSample(['a', 'c'], [20], [])
    expect(b.encode().length).toBeGreaterThan(0)
  })

  it('clamps negative values to zero', () => {
    const b = new (PprofBuilder as any)(['val'], ['count'])
    b.addSample(['frame'], [-5], [])
    expect(b.encode().length).toBeGreaterThan(0)
  })

  it('encodes string labels', () => {
    const b = new (PprofBuilder as any)(['count'], ['objects'])
    b.addSample(['frame'], [10], [{ key: 'thread', value: 'main', isNumeric: false }])
    const data = b.encode()
    expect(data.length).toBeGreaterThan(0)
  })

  it('encodes numeric labels', () => {
    const b = new (PprofBuilder as any)(['count'], ['objects'])
    b.addSample(['frame'], [10], [{ key: 'pid', value: '1234', isNumeric: true }])
    const data = b.encode()
    expect(data.length).toBeGreaterThan(0)
  })

  it('encodes multiple labels per sample', () => {
    const b = new (PprofBuilder as any)(['count'], ['objects'])
    b.addSample(['frame'], [10], [
      { key: 'thread', value: 'main', isNumeric: false },
      { key: 'pid', value: '42', isNumeric: true },
    ])
    const data = b.encode()
    expect(data.length).toBeGreaterThan(0)
  })
})

// ── Column value resolution ──

describe('resolveStringValue', () => {
  it('resolves regular column', () => {
    const col: ColumnInfo = { name: 'x', source: 'x', sampleValues: [], isNumeric: false }
    expect(resolveStringValue({ x: 'hello' }, col)).toBe('hello')
  })

  it('resolves JSON sub-field', () => {
    const col: ColumnInfo = { name: 'meta.k', source: 'meta', jsonKey: 'k', sampleValues: [], isNumeric: false }
    expect(resolveStringValue({ meta: '{"k":"v"}' }, col)).toBe('v')
  })

  it('returns empty for bad JSON', () => {
    const col: ColumnInfo = { name: 'meta.k', source: 'meta', jsonKey: 'k', sampleValues: [], isNumeric: false }
    expect(resolveStringValue({ meta: 'not json' }, col)).toBe('')
  })

  it('returns empty for missing key in JSON', () => {
    const col: ColumnInfo = { name: 'meta.k', source: 'meta', jsonKey: 'k', sampleValues: [], isNumeric: false }
    expect(resolveStringValue({ meta: '{"other":1}' }, col)).toBe('')
  })
})

describe('resolveNumericValue', () => {
  it('resolves numbers', () => {
    const col: ColumnInfo = { name: 'x', source: 'x', sampleValues: [], isNumeric: true }
    expect(resolveNumericValue({ x: '42' }, col)).toBe(42)
  })

  it('rounds floats', () => {
    const col: ColumnInfo = { name: 'x', source: 'x', sampleValues: [], isNumeric: true }
    expect(resolveNumericValue({ x: '3.7' }, col)).toBe(4)
  })

  it('clamps negative to 0', () => {
    const col: ColumnInfo = { name: 'x', source: 'x', sampleValues: [], isNumeric: true }
    expect(resolveNumericValue({ x: '-10' }, col)).toBe(0)
  })

  it('returns 0 for non-numeric', () => {
    const col: ColumnInfo = { name: 'x', source: 'x', sampleValues: [], isNumeric: false }
    expect(resolveNumericValue({ x: 'abc' }, col)).toBe(0)
  })
})

// ── Stack building ──

describe('buildStack', () => {
  it('builds from regular columns', () => {
    const cols: ColumnInfo[] = [
      { name: 'module', source: 'module', sampleValues: [], isNumeric: false },
      { name: 'func', source: 'func', sampleValues: [], isNumeric: false },
    ]
    expect(buildStack({ module: 'libc', func: 'malloc' }, ['module', 'func'], cols, new Map()))
      .toEqual(['libc', 'malloc'])
  })

  it('builds from JSON sub-fields', () => {
    const cols: ColumnInfo[] = [
      { name: 'meta.region', source: 'meta', jsonKey: 'region', sampleValues: [], isNumeric: false },
      { name: 'func', source: 'func', sampleValues: [], isNumeric: false },
    ]
    expect(buildStack({ meta: '{"region":"us"}', func: 'foo' }, ['meta.region', 'func'], cols, new Map()))
      .toEqual(['us', 'foo'])
  })

  it('expands JSON arrays', () => {
    const cols: ColumnInfo[] = [
      { name: 'path', source: 'path', isJsonArray: true, jsonArrayKeys: ['class'], sampleValues: [], isNumeric: false },
    ]
    expect(buildStack({ path: '[{"class":"Foo"},{"class":"Bar"}]' }, ['path'], cols, new Map([['path', 'class']])))
      .toEqual(['Foo', 'Bar'])
  })

  it('handles primitive JSON arrays', () => {
    const cols: ColumnInfo[] = [
      { name: 'tags', source: 'tags', isJsonArray: true, sampleValues: [], isNumeric: false },
    ]
    expect(buildStack({ tags: '["a","b","c"]' }, ['tags'], cols, new Map()))
      .toEqual(['a', 'b', 'c'])
  })

  it('handles null elements in JSON array', () => {
    const cols: ColumnInfo[] = [
      { name: 'arr', source: 'arr', isJsonArray: true, sampleValues: [], isNumeric: false },
    ]
    expect(buildStack({ arr: '[null, "x"]' }, ['arr'], cols, new Map()))
      .toEqual(['(null)', 'x'])
  })

  it('shows (empty) for empty string values', () => {
    const cols: ColumnInfo[] = [
      { name: 'func', source: 'func', sampleValues: [], isNumeric: false },
    ]
    expect(buildStack({ func: '' }, ['func'], cols, new Map())).toEqual(['(empty)'])
  })

  it('shows (no frames) when no frame columns', () => {
    expect(buildStack({}, [], [], new Map())).toEqual(['(no frames)'])
  })

  it('handles malformed JSON gracefully', () => {
    const cols: ColumnInfo[] = [
      { name: 'path', source: 'path', isJsonArray: true, sampleValues: [], isNumeric: false },
    ]
    // Non-JSON is used as literal frame value
    expect(buildStack({ path: 'not-json' }, ['path'], cols, new Map()))
      .toEqual(['not-json'])
    // Truly broken JSON (starts with [ but invalid) falls back to raw
    expect(buildStack({ path: '[broken' }, ['path'], cols, new Map()))
      .toEqual(['[broken'])
    // Empty string gets placeholder
    expect(buildStack({ path: '' }, ['path'], cols, new Map()))
      .toEqual(['(parse error)'])
  })

  it('handles missing JSON sub-field key', () => {
    const cols: ColumnInfo[] = [
      { name: 'meta.missing', source: 'meta', jsonKey: 'missing', sampleValues: [], isNumeric: false },
    ]
    expect(buildStack({ meta: '{"other":1}' }, ['meta.missing'], cols, new Map()))
      .toEqual(['(empty)'])
  })
})

describe('getMetricValue', () => {
  it('extracts from regular column', () => {
    const cols: ColumnInfo[] = [{ name: 'size', source: 'size', sampleValues: [], isNumeric: true }]
    expect(getMetricValue({ size: '4096' }, 'size', cols)).toBe(4096)
  })

  it('extracts from JSON sub-field', () => {
    const cols: ColumnInfo[] = [{ name: 'meta.count', source: 'meta', jsonKey: 'count', sampleValues: [], isNumeric: true }]
    expect(getMetricValue({ meta: '{"count":42}' }, 'meta.count', cols)).toBe(42)
  })

  it('returns 0 for missing column', () => {
    expect(getMetricValue({ x: '1' }, 'missing', [])).toBe(0)
  })

  it('returns 0 for NaN', () => {
    const cols: ColumnInfo[] = [{ name: 'x', source: 'x', sampleValues: [], isNumeric: false }]
    expect(getMetricValue({ x: 'abc' }, 'x', cols)).toBe(0)
  })

  it('clamps negative to 0', () => {
    const cols: ColumnInfo[] = [{ name: 'x', source: 'x', sampleValues: [], isNumeric: true }]
    expect(getMetricValue({ x: '-100' }, 'x', cols)).toBe(0)
  })
})

// ── Partition key parsing ──

describe('parsePartitionKey', () => {
  it('parses single key', () => {
    expect(parsePartitionKey('region=us')).toEqual({ region: 'us' })
  })

  it('parses multiple keys', () => {
    expect(parsePartitionKey('region=us|env=prod')).toEqual({ region: 'us', env: 'prod' })
  })

  it('handles values with =', () => {
    expect(parsePartitionKey('expr=a=b')).toEqual({ expr: 'a=b' })
  })

  it('returns empty for empty key', () => {
    expect(parsePartitionKey('')).toEqual({})
  })
})

// ── Profile generation ──

describe('generateProfiles', () => {
  it('rejects zero frame columns', async () => {
    const data = parseTSV('name\nfoo')
    const cols = analyzeColumns(data)
    const config: ProfileConfig = {
      roles: new Map([['name', 'none']]),
      frameOrder: [],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map(),
    }
    await expect(generateProfiles(data, cols, config)).rejects.toThrow('At least one frame')
  })

  it('generates from simple TSV', async () => {
    const data = parseTSV(generateSimpleTSV())
    const cols = analyzeColumns(data)
    const defaults = suggestDefaults(cols)

    const profiles = await generateProfiles(data, cols, {
      roles: defaults.roles,
      frameOrder: defaults.frameOrder,
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['self_size', 'bytes'], ['self_count', 'count']]),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBeGreaterThan(0)
    expect(profiles[0].rowCount).toBe(5)
    expect(profiles[0].data[0]).toBe(0x1f)
    expect(profiles[0].data[1]).toBe(0x8b)
  })

  it('generates from heap dominator TSV', async () => {
    const data = parseTSV(generateHeapDominatorTSV())
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([
        ['process_name', 'frame'],
        ['path', 'frame'],
        ['self_size', 'metric'],
        ['self_count', 'metric'],
      ]),
      frameOrder: ['process_name', 'path'],
      jsonArrayLabelKey: new Map([['path', 'class']]),
      metricUnits: new Map([['self_size', 'bytes'], ['self_count', 'count']]),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].rowCount).toBe(4)
  })

  it('partitions by column', async () => {
    const data = parseTSV(generateJSONObjectTSV())
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([
        ['name', 'frame'],
        ['size', 'metric'],
        ['metadata.region', 'partition'],
      ]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    })
    expect(profiles.length).toBe(3)
    expect(profiles.map(p => p.name).sort()).toEqual(['ap-south', 'eu-west', 'us-east'])
  })

  it('handles quoted TSV', async () => {
    const data = parseTSV(generateQuotedTSV())
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['name', 'frame'], ['size', 'metric']]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBe(3)
  })

  it('always includes rows metric', async () => {
    const data = parseTSV('name\nfoo\nfoo\nbar')
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['name', 'frame']]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map(),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBe(2)
    expect(profiles[0].rowCount).toBe(3)
  })

  it('handles mixed types with multiple frame sources', async () => {
    const data = parseTSV(generateMixedTypesTSV())
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([
        ['name', 'frame'],
        ['path', 'frame'],
        ['size', 'metric'],
        ['duration_ns', 'metric'],
      ]),
      frameOrder: ['name', 'path'],
      jsonArrayLabelKey: new Map([['path', 'frame']]),
      metricUnits: new Map([['size', 'bytes'], ['duration_ns', 'nanoseconds']]),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].rowCount).toBe(4)
    expect(profiles[0].data[0]).toBe(0x1f)
  })

  it('handles edge case values', async () => {
    const data = parseTSV(generateEdgeCasesTSV())
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['name', 'frame'], ['value', 'metric']]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['value', 'count']]),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].rowCount).toBe(7)
  })

  it('handles multi-dimension partitioning', async () => {
    const data = parseTSV(generateMultiPartitionTSV())
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
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
    })
    expect(profiles.length).toBe(4)
    expect(profiles.reduce((s, p) => s + p.rowCount, 0)).toBe(12)
  })

  it('handles large datasets', async () => {
    const data = parseTSV(generateLargeTSV(1000))
    const cols = analyzeColumns(data)
    const defaults = suggestDefaults(cols)

    const profiles = await generateProfiles(data, cols, {
      roles: defaults.roles,
      frameOrder: defaults.frameOrder,
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['self_size', 'bytes'], ['self_count', 'count']]),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].rowCount).toBe(1000)
  })

  it('aggregates identical stacks', async () => {
    const data = parseTSV('func\tmodule\tsize\nfoo\tlib\t100\nfoo\tlib\t200\nbar\tlib\t50')
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['module', 'frame'], ['func', 'frame'], ['size', 'metric']]),
      frameOrder: ['module', 'func'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBe(2) // lib→foo (300) and lib→bar (50)
  })

  it('produces valid gzip for all test data generators', async () => {
    const generators = [
      generateSimpleTSV, generateHeapDominatorTSV, generateJSONObjectTSV,
      generateQuotedTSV, generateMixedTypesTSV, generateEdgeCasesTSV,
    ]

    for (const gen of generators) {
      const data = parseTSV(gen())
      const cols = analyzeColumns(data)
      const defaults = suggestDefaults(cols)

      // Ensure at least one frame
      if (defaults.frameOrder.length === 0 && cols.length > 0) {
        const first = cols.find(c => !c.isNumeric && !c.jsonKey)
        if (first) {
          defaults.roles.set(first.name, 'frame')
          defaults.frameOrder.push(first.name)
        }
      }

      const profiles = await generateProfiles(data, cols, {
        roles: defaults.roles,
        frameOrder: defaults.frameOrder,
        jsonArrayLabelKey: new Map(),
        metricUnits: new Map(),
      })
      expect(profiles.length).toBeGreaterThan(0)
      for (const p of profiles) {
        expect(p.data[0]).toBe(0x1f)
        expect(p.data[1]).toBe(0x8b)
      }
    }
  })

  it('generates partition filenames with timestamps', async () => {
    const data = parseTSV('name\tenv\nfoo\tprod\nbar\tstaging')
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['name', 'frame'], ['env', 'partition']]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map(),
    })
    expect(profiles.length).toBe(2)
    // Filenames should contain partition value and timestamp
    for (const p of profiles) {
      expect(p.fileName).toMatch(/^profile_(prod|staging)_\d{8}_\d{6}\.pb\.gz$/)
    }
  })

  it('handles single row', async () => {
    const data = parseTSV('name\tsize\nfoo\t42')
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['name', 'frame'], ['size', 'metric']]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBe(1)
    expect(profiles[0].rowCount).toBe(1)
  })

  it('handles rows with empty metric values', async () => {
    const data = parseTSV('name\tsize\nfoo\t\nbar\t100')
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['name', 'frame'], ['size', 'metric']]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBe(2)
  })

  it('attaches string labels to samples', async () => {
    const data = parseTSV('func\tthread\tsize\nfoo\tmain\t100\nbar\tworker\t200\nfoo\tworker\t50')
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['func', 'frame'], ['thread', 'label'], ['size', 'metric']]),
      frameOrder: ['func'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    })
    expect(profiles).toHaveLength(1)
    // With labels, each row is its own sample (no aggregation across labels)
    expect(profiles[0].sampleCount).toBe(3)
    expect(profiles[0].rowCount).toBe(3)
  })

  it('attaches numeric labels', async () => {
    const data = parseTSV('func\tpid\tsize\nfoo\t1234\t100\nbar\t5678\t200')
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['func', 'frame'], ['pid', 'label'], ['size', 'metric']]),
      frameOrder: ['func'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBe(2)
  })

  it('supports multiple labels simultaneously', async () => {
    const data = parseTSV('func\tthread\tpid\tsize\nfoo\tmain\t100\t1024')
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['func', 'frame'], ['thread', 'label'], ['pid', 'label'], ['size', 'metric']]),
      frameOrder: ['func'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes']]),
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBe(1)
  })

  it('supports labels + partitions + multiple frames + multiple metrics', async () => {
    const tsv = [
      'module\tfunc\tthread\tenv\tsize\tcount',
      'libc\tmalloc\tmain\tprod\t100\t10',
      'libc\tfree\tworker\tprod\t0\t5',
      'app\trender\tmain\tstaging\t200\t20',
      'app\tparse\tworker\tstaging\t50\t8',
    ].join('\n')
    const data = parseTSV(tsv)
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([
        ['module', 'frame'],
        ['func', 'frame'],
        ['thread', 'label'],
        ['env', 'partition'],
        ['size', 'metric'],
        ['count', 'metric'],
      ]),
      frameOrder: ['module', 'func'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map([['size', 'bytes'], ['count', 'count']]),
    })
    // 2 envs = 2 profiles
    expect(profiles.length).toBe(2)
    const prod = profiles.find(p => p.name === 'prod')!
    const staging = profiles.find(p => p.name === 'staging')!
    expect(prod.rowCount).toBe(2)
    expect(staging.rowCount).toBe(2)
    // With labels, no aggregation: each row is a sample
    expect(prod.sampleCount).toBe(2)
    expect(staging.sampleCount).toBe(2)
  })

  it('includes timestamps in filenames', async () => {
    const data = parseTSV('name\nfoo')
    const cols = analyzeColumns(data)

    const profiles = await generateProfiles(data, cols, {
      roles: new Map([['name', 'frame']]),
      frameOrder: ['name'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map(),
    })
    expect(profiles[0].fileName).toMatch(/^profile_\d{8}_\d{6}\.pb\.gz$/)
  })
})

// ── buildLabels ──

describe('buildLabels', () => {
  it('builds string labels', () => {
    const cols: ColumnInfo[] = [
      { name: 'thread', source: 'thread', sampleValues: [], isNumeric: false },
    ]
    const labels = buildLabels({ thread: 'main' }, cols)
    expect(labels).toEqual([{ key: 'thread', value: 'main', isNumeric: false }])
  })

  it('builds numeric labels', () => {
    const cols: ColumnInfo[] = [
      { name: 'pid', source: 'pid', sampleValues: [], isNumeric: true },
    ]
    const labels = buildLabels({ pid: '1234' }, cols)
    expect(labels).toEqual([{ key: 'pid', value: '1234', isNumeric: true }])
  })

  it('builds multiple labels', () => {
    const cols: ColumnInfo[] = [
      { name: 'thread', source: 'thread', sampleValues: [], isNumeric: false },
      { name: 'pid', source: 'pid', sampleValues: [], isNumeric: true },
    ]
    const labels = buildLabels({ thread: 'main', pid: '42' }, cols)
    expect(labels).toHaveLength(2)
    expect(labels[0].key).toBe('thread')
    expect(labels[1].key).toBe('pid')
  })

  it('builds labels from JSON sub-fields', () => {
    const cols: ColumnInfo[] = [
      { name: 'meta.team', source: 'meta', jsonKey: 'team', sampleValues: [], isNumeric: false },
    ]
    const labels = buildLabels({ meta: '{"team":"backend"}' }, cols)
    expect(labels).toEqual([{ key: 'meta.team', value: 'backend', isNumeric: false }])
  })
})
