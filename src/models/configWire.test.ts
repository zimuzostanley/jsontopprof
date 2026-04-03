import { describe, it, expect } from 'vitest'
import { serializeConfig, deserializeConfig } from './configWire'
import type { ProfileConfig, ColumnRole } from './types'

function makeConfig(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  return {
    roles: new Map<string, ColumnRole>([
      ['func', 'frame'],
      ['module', 'frame'],
      ['size', 'metric'],
      ['thread', 'label'],
      ['env', 'partition'],
      ['unused', 'none'],
    ]),
    frameOrder: ['module', 'func'],
    jsonArrayLabelKey: new Map([['path', 'class']]),
    metricUnits: new Map([['size', 'bytes']]),
    ...overrides,
  }
}

describe('serializeConfig / deserializeConfig round-trip', () => {
  it('preserves all 5 roles', () => {
    const config = makeConfig()
    const serialized = serializeConfig(config)
    const restored = deserializeConfig(serialized)

    expect(restored.roles.get('func')).toBe('frame')
    expect(restored.roles.get('module')).toBe('frame')
    expect(restored.roles.get('size')).toBe('metric')
    expect(restored.roles.get('thread')).toBe('label')
    expect(restored.roles.get('env')).toBe('partition')
    expect(restored.roles.get('unused')).toBe('none')
    expect(restored.roles.size).toBe(6)
  })

  it('preserves frame order', () => {
    const config = makeConfig()
    const restored = deserializeConfig(serializeConfig(config))
    expect(restored.frameOrder).toEqual(['module', 'func'])
  })

  it('preserves jsonArrayLabelKey', () => {
    const config = makeConfig()
    const restored = deserializeConfig(serializeConfig(config))
    expect(restored.jsonArrayLabelKey.get('path')).toBe('class')
  })

  it('preserves metricUnits', () => {
    const config = makeConfig()
    const restored = deserializeConfig(serializeConfig(config))
    expect(restored.metricUnits.get('size')).toBe('bytes')
  })

  it('handles empty maps', () => {
    const config = makeConfig({
      roles: new Map([['x', 'frame']]),
      frameOrder: ['x'],
      jsonArrayLabelKey: new Map(),
      metricUnits: new Map(),
    })
    const restored = deserializeConfig(serializeConfig(config))
    expect(restored.jsonArrayLabelKey.size).toBe(0)
    expect(restored.metricUnits.size).toBe(0)
  })

  it('handles special characters in values', () => {
    const config = makeConfig({
      metricUnits: new Map([['col with spaces', 'µs/op']]),
      roles: new Map([['col with spaces', 'metric']]),
      frameOrder: [],
    })
    const restored = deserializeConfig(serializeConfig(config))
    expect(restored.metricUnits.get('col with spaces')).toBe('µs/op')
  })

  it('is JSON-serializable (localStorage compatible)', () => {
    const config = makeConfig()
    const serialized = serializeConfig(config)
    const json = JSON.stringify(serialized)
    const parsed = JSON.parse(json)
    const restored = deserializeConfig(parsed)
    expect(restored.roles.get('func')).toBe('frame')
    expect(restored.frameOrder).toEqual(['module', 'func'])
  })
})
