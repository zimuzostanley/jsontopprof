import type { ProfileConfig, ColumnRole } from './types'

/** Serialized config format for structured clone (worker messages, localStorage). */
export interface SerializedConfig {
  roles: [string, string][]
  frameOrder: string[]
  jsonArrayLabelKey: [string, string][]
  metricUnits: [string, string][]
}

export function serializeConfig(config: ProfileConfig): SerializedConfig {
  return {
    roles: [...config.roles.entries()],
    frameOrder: config.frameOrder,
    jsonArrayLabelKey: [...config.jsonArrayLabelKey.entries()],
    metricUnits: [...config.metricUnits.entries()],
  }
}

export function deserializeConfig(s: SerializedConfig): ProfileConfig {
  return {
    roles: new Map(s.roles as [string, ColumnRole][]),
    frameOrder: s.frameOrder,
    jsonArrayLabelKey: new Map(s.jsonArrayLabelKey),
    metricUnits: new Map(s.metricUnits),
  }
}
