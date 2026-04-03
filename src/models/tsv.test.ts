import { describe, it, expect } from 'vitest'
import { parseTSV, parseDelimited, analyzeColumns, suggestDefaults } from './tsv'

describe('parseDelimited', () => {
  it('parses simple tab-separated values', () => {
    const result = parseDelimited('a\tb\tc\n1\t2\t3', '\t')
    expect(result).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })

  it('handles quoted fields', () => {
    const result = parseDelimited('"hello world"\t"foo"\n"bar"\t"baz"', '\t')
    expect(result).toEqual([['hello world', 'foo'], ['bar', 'baz']])
  })

  it('handles escaped quotes (double-double-quote)', () => {
    const result = parseDelimited('"say ""hello"""\tfoo', '\t')
    expect(result).toEqual([['say "hello"', 'foo']])
  })

  it('handles tabs within quoted fields', () => {
    const result = parseDelimited('"has\ttab"\tplain', '\t')
    expect(result).toEqual([['has\ttab', 'plain']])
  })

  it('handles newlines within quoted fields', () => {
    const result = parseDelimited('"line1\nline2"\tplain', '\t')
    expect(result).toEqual([['line1\nline2', 'plain']])
  })

  it('handles CRLF line endings', () => {
    const result = parseDelimited('a\tb\r\n1\t2\r\n', '\t')
    expect(result).toEqual([['a', 'b'], ['1', '2']])
  })

  it('handles empty fields', () => {
    const result = parseDelimited('a\t\tb\n\t2\t', '\t')
    expect(result).toEqual([['a', '', 'b'], ['', '2', '']])
  })

  it('handles empty input', () => {
    expect(parseDelimited('', '\t')).toEqual([])
  })

  it('handles JSON in quoted fields', () => {
    const result = parseDelimited('col\n"{"key": "val"}"', '\t')
    // The JSON is within quotes, but { is not a quote char so it just reads as text
    // Actually this would be: field starts with quote, reads until closing quote
    // Let me think... "{"key": "val"}" - starts with ", then reads {, then "
    // hits " and next char is k (not "), so ends quote. But field is just {
    // This is actually ambiguous. Let's test the robust case:
    const result2 = parseDelimited('col\n"{""key"": ""val""}"', '\t')
    expect(result2).toEqual([['col'], ['{"key": "val"}']])
  })

  it('handles unquoted JSON', () => {
    // When JSON is not quoted, it's just a regular field (no tabs/newlines inside)
    const result = parseDelimited('col\n{"key":"val"}', '\t')
    expect(result).toEqual([['col'], ['{"key":"val"}']])
  })

  it('handles complex JSON with arrays', () => {
    const json = '[{"class":"Foo","count":5},{"class":"Bar","count":3}]'
    const result = parseDelimited(`path\tsize\n${json}\t100`, '\t')
    expect(result).toEqual([['path', 'size'], [json, '100']])
  })

  it('handles quoted JSON with proper escaping', () => {
    const result = parseDelimited('col\n"[{""class"":""Foo""}]"', '\t')
    expect(result).toEqual([['col'], ['[{"class":"Foo"}]']])
  })
})

describe('parseTSV', () => {
  it('returns headers and rows', () => {
    const result = parseTSV('name\tsize\nfoo\t100\nbar\t200')
    expect(result.headers).toEqual(['name', 'size'])
    expect(result.rows).toEqual([
      { name: 'foo', size: '100' },
      { name: 'bar', size: '200' },
    ])
  })

  it('skips empty trailing lines', () => {
    const result = parseTSV('name\tsize\nfoo\t100\n')
    expect(result.rows).toHaveLength(1)
  })

  it('handles missing fields', () => {
    const result = parseTSV('a\tb\tc\n1\t2')
    expect(result.rows[0]).toEqual({ a: '1', b: '2', c: '' })
  })

  it('handles empty input', () => {
    const result = parseTSV('')
    expect(result.headers).toEqual([])
    expect(result.rows).toEqual([])
  })
})

describe('analyzeColumns', () => {
  it('detects numeric columns', () => {
    const data = parseTSV('name\tsize\tcount\nfoo\t100\t5\nbar\t200\t10')
    const cols = analyzeColumns(data)
    const nameCol = cols.find(c => c.name === 'name')
    const sizeCol = cols.find(c => c.name === 'size')
    expect(nameCol?.isNumeric).toBe(false)
    expect(sizeCol?.isNumeric).toBe(true)
  })

  it('detects JSON object columns and expands sub-fields', () => {
    const data = parseTSV('name\tmeta\nfoo\t{"region":"us","team":"backend"}\nbar\t{"region":"eu","team":"frontend"}')
    const cols = analyzeColumns(data)
    expect(cols.find(c => c.name === 'meta.region')).toBeDefined()
    expect(cols.find(c => c.name === 'meta.team')).toBeDefined()
    expect(cols.find(c => c.name === 'meta.region')?.jsonKey).toBe('region')
    expect(cols.find(c => c.name === 'meta.region')?.source).toBe('meta')
  })

  it('detects JSON array columns', () => {
    const data = parseTSV('path\tsize\n[{"class":"Foo"},{"class":"Bar"}]\t100')
    const cols = analyzeColumns(data)
    const pathCol = cols.find(c => c.name === 'path')
    expect(pathCol?.isJsonArray).toBe(true)
    expect(pathCol?.jsonArrayKeys).toContain('class')
  })

  it('detects JSON array of primitives', () => {
    const data = parseTSV('tags\tcount\n["a","b","c"]\t5')
    const cols = analyzeColumns(data)
    const tagsCol = cols.find(c => c.name === 'tags')
    expect(tagsCol?.isJsonArray).toBe(true)
    expect(tagsCol?.jsonArrayKeys).toBeUndefined()
  })
})

describe('suggestDefaults', () => {
  it('selects first string column as frame, numeric as metrics', () => {
    const data = parseTSV('name\tsize\tcount\nfoo\t100\t5')
    const cols = analyzeColumns(data)
    const { roles, frameOrder } = suggestDefaults(cols)
    expect(roles.get('name')).toBe('frame')
    expect(roles.get('size')).toBe('metric')
    expect(roles.get('count')).toBe('metric')
    expect(frameOrder).toEqual(['name'])
  })

  it('selects JSON array as frame when it comes first', () => {
    const data = parseTSV('path\tsize\n[{"class":"Foo"}]\t100')
    const cols = analyzeColumns(data)
    const { roles, frameOrder } = suggestDefaults(cols)
    expect(roles.get('path')).toBe('frame')
    expect(frameOrder).toContain('path')
  })
})

describe('parseDelimited edge cases', () => {
  it('handles mid-field quotes gracefully', () => {
    const result = parseDelimited('a\tb\nfoo"bar\tbaz', '\t')
    expect(result).toEqual([['a', 'b'], ['foo"bar', 'baz']])
  })

  it('handles single-column TSV', () => {
    const result = parseDelimited('name\nfoo\nbar', '\t')
    expect(result).toEqual([['name'], ['foo'], ['bar']])
  })

  it('handles unicode content', () => {
    const result = parseDelimited('name\t\u5024\n\u3053\u3093\u306b\u3061\u306f\t42', '\t')
    expect(result[1][0]).toBe('\u3053\u3093\u306b\u3061\u306f')
    expect(result[0][1]).toBe('\u5024')
  })

  it('handles very long fields', () => {
    const longVal = 'x'.repeat(10000)
    const result = parseDelimited(`col\n${longVal}`, '\t')
    expect(result[1][0].length).toBe(10000)
  })

  it('handles consecutive delimiters', () => {
    const result = parseDelimited('a\t\t\tb', '\t')
    expect(result).toEqual([['a', '', '', 'b']])
  })

  it('handles only headers no data', () => {
    const result = parseTSV('a\tb\tc\n')
    expect(result.headers).toEqual(['a', 'b', 'c'])
    expect(result.rows).toHaveLength(0)
  })

  it('handles extra columns in data rows', () => {
    const result = parseTSV('a\tb\n1\t2\t3\t4')
    expect(result.rows[0]).toEqual({ a: '1', b: '2' })
  })

  it('handles JSON with properly escaped quotes', () => {
    const result = parseDelimited('col\n"{""key"": ""value""}"\n', '\t')
    expect(result[1][0]).toBe('{"key": "value"}')
  })

  it('handles backslash-escaped quotes (Perfetto style)', () => {
    // Perfetto TSV uses \" inside quoted fields
    const result = parseDelimited(
      'path\n"[{\\"class\\":\\"Foo\\",\\"count\\":1}]"',
      '\t',
    )
    expect(result[1][0]).toBe('[{"class":"Foo","count":1}]')
    // Verify it parses as valid JSON
    const parsed = JSON.parse(result[1][0])
    expect(parsed[0].class).toBe('Foo')
    expect(parsed[0].count).toBe(1)
  })

  it('handles real Perfetto heap dominator format', () => {
    // Simulates the actual format: outer quoted field with \" escaped JSON inside
    const pathJson = '[{\\"class\\":\\"android.app.ActivityThread\\",\\"heap_type\\":\\"HEAP_TYPE_APP\\"},{\\"class\\":\\"android.view.View\\",\\"heap_type\\":\\"HEAP_TYPE_NATIVE\\"}]'
    const row = `process_name\tself_size\tpath\n"system_server"\t8192\t"${pathJson}"`
    const result = parseTSV(row)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].process_name).toBe('system_server')
    expect(result.rows[0].self_size).toBe('8192')
    // path should be valid JSON after unescaping
    const path = JSON.parse(result.rows[0].path)
    expect(path).toHaveLength(2)
    expect(path[0].class).toBe('android.app.ActivityThread')
    expect(path[1].heap_type).toBe('HEAP_TYPE_NATIVE')
  })
})

describe('analyzeColumns edge cases', () => {
  it('handles mixed JSON and non-JSON in same column', () => {
    const data = parseTSV('val\n{"a":1}\nnot_json\n{"b":2}')
    const cols = analyzeColumns(data)
    // Should treat as regular column since not all rows are JSON
    const col = cols.find(c => c.name === 'val')
    expect(col?.isJsonArray).toBeFalsy()
  })

  it('handles empty JSON objects', () => {
    const data = parseTSV('meta\n{}\n{}')
    const cols = analyzeColumns(data)
    // Should detect as JSON object but no sub-fields
    expect(cols.length).toBeGreaterThan(0)
  })

  it('handles columns with all empty values', () => {
    const data = parseTSV('name\tblank\nfoo\t\nbar\t')
    const cols = analyzeColumns(data)
    const blank = cols.find(c => c.name === 'blank')
    expect(blank?.isNumeric).toBe(false)
  })

  it('detects float columns as numeric', () => {
    const data = parseTSV('val\n1.5\n2.7\n3.14')
    const cols = analyzeColumns(data)
    expect(cols[0].isNumeric).toBe(true)
  })

  it('detects negative numbers as numeric', () => {
    const data = parseTSV('val\n-10\n20\n-30')
    const cols = analyzeColumns(data)
    expect(cols[0].isNumeric).toBe(true)
  })
})

// === Test data generators ===

/** Generate a simple TSV for testing */
export function generateSimpleTSV(): string {
  const rows = [
    'function_name\tmodule\tself_size\tself_count',
    'malloc\tlibc\t4096\t100',
    'free\tlibc\t0\t50',
    'render\tui\t2048\t200',
    'parse\tparser\t1024\t75',
    'render\tui\t512\t30',
  ]
  return rows.join('\n')
}

/** Generate a TSV with JSON object columns */
export function generateJSONObjectTSV(): string {
  const rows = [
    'name\tsize\tmetadata',
    'foo\t100\t{"region":"us-east","team":"backend","env":"prod"}',
    'bar\t200\t{"region":"eu-west","team":"frontend","env":"staging"}',
    'baz\t150\t{"region":"us-east","team":"frontend","env":"prod"}',
    'qux\t300\t{"region":"ap-south","team":"backend","env":"prod"}',
  ]
  return rows.join('\n')
}

/** Generate a TSV with JSON array columns (heap dominator style) */
export function generateHeapDominatorTSV(): string {
  const rows = [
    'process_name\tpath\tself_size\tself_count',
    `system_server\t[{"class":"android.app.ActivityThread","heap_type":"HEAP_TYPE_JAVA"},{"class":"android.view.View","heap_type":"HEAP_TYPE_JAVA"}]\t8192\t10`,
    `com.example.app\t[{"class":"com.example.MainActivity","heap_type":"HEAP_TYPE_JAVA"},{"class":"android.widget.TextView","heap_type":"HEAP_TYPE_JAVA"}]\t4096\t5`,
    `system_server\t[{"class":"android.app.ActivityThread","heap_type":"HEAP_TYPE_JAVA"},{"class":"android.graphics.Bitmap","heap_type":"HEAP_TYPE_NATIVE"}]\t16384\t2`,
    `com.example.app\t[{"class":"com.example.DataModel","heap_type":"HEAP_TYPE_JAVA"}]\t1024\t20`,
  ]
  return rows.join('\n')
}

/** Generate a TSV with quoted fields */
export function generateQuotedTSV(): string {
  const rows = [
    'name\tsize\tdescription',
    '"Widget A"\t100\t"A simple widget"',
    '"Widget ""B"""\t200\t"Has ""quotes"" inside"',
    '"Widget\tC"\t300\t"Has a tab"',
  ]
  return rows.join('\n')
}

/** Generate a large TSV for stress testing */
export function generateLargeTSV(rowCount: number): string {
  const functions = ['malloc', 'free', 'realloc', 'calloc', 'mmap', 'munmap', 'brk', 'sbrk']
  const modules = ['libc', 'libm', 'libpthread', 'kernel', 'app']
  const lines = ['function_name\tmodule\tself_size\tself_count']
  for (let i = 0; i < rowCount; i++) {
    const fn = functions[i % functions.length]
    const mod = modules[i % modules.length]
    const size = Math.floor(Math.random() * 10000)
    const count = Math.floor(Math.random() * 100)
    lines.push(`${fn}\t${mod}\t${size}\t${count}`)
  }
  return lines.join('\n')
}

/** Generate a TSV with mixed column types for comprehensive testing */
export function generateMixedTypesTSV(): string {
  const rows = [
    'id\tname\tsize\tduration_ns\ttags\tmetadata\tpath',
    '1\tmalloc\t4096\t1500000\t["memory","alloc"]\t{"region":"us","priority":1}\t[{"frame":"libc::malloc","depth":0},{"frame":"app::init","depth":1}]',
    '2\tfree\t0\t500000\t["memory","free"]\t{"region":"eu","priority":2}\t[{"frame":"libc::free","depth":0}]',
    '3\trealloc\t2048\t2000000\t["memory","alloc"]\t{"region":"us","priority":1}\t[{"frame":"libc::realloc","depth":0},{"frame":"app::resize","depth":1}]',
    '4\tmmap\t65536\t10000000\t["memory","vm"]\t{"region":"ap","priority":3}\t[{"frame":"kernel::mmap","depth":0},{"frame":"libc::mmap","depth":1},{"frame":"app::load","depth":2}]',
  ]
  return rows.join('\n')
}

/** Generate a TSV with edge case values */
export function generateEdgeCasesTSV(): string {
  const rows = [
    'name\tvalue\tnotes',
    'empty_value\t0\t',
    'negative\t-100\tnegative value',
    'float\t3.14159\tfloating point',
    'large\t999999999\tvery large',
    '"quoted name"\t42\t"has ""inner"" quotes"',
    'unicode_\u00e9\t1\taccented chars',
    'spaces in name\t2\tspaces are fine',
  ]
  return rows.join('\n')
}

/** Generate a TSV with multiple partition dimensions */
export function generateMultiPartitionTSV(): string {
  const regions = ['us-east', 'eu-west']
  const envs = ['prod', 'staging']
  const funcs = ['handle_request', 'process_data', 'send_response']
  const lines = ['function\tregion\tenv\tlatency_ms\tcall_count']
  for (const region of regions) {
    for (const env of envs) {
      for (const func of funcs) {
        const latency = Math.floor(Math.random() * 500) + 10
        const calls = Math.floor(Math.random() * 1000) + 1
        lines.push(`${func}\t${region}\t${env}\t${latency}\t${calls}`)
      }
    }
  }
  return lines.join('\n')
}
