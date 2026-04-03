/** Parsed TSV data */
export interface ParsedData {
  headers: string[]
  rows: Record<string, string>[]
}

/** Information about a discovered column */
export interface ColumnInfo {
  /** Display name (e.g., "metadata.region" for JSON sub-field) */
  name: string
  /** Original TSV column name */
  source: string
  /** Key within JSON object, if this is a JSON sub-field */
  jsonKey?: string
  /** True if this column contains JSON arrays */
  isJsonArray?: boolean
  /** For JSON array-of-objects columns, available keys */
  jsonArrayKeys?: string[]
  /** Sample values for preview */
  sampleValues: string[]
  /** Whether all non-empty values are numeric */
  isNumeric: boolean
}

/** Role assigned to a column */
export type ColumnRole = 'none' | 'frame' | 'metric' | 'partition'

/** Configuration for generating profiles */
export interface ProfileConfig {
  /** Column roles: column name -> role */
  roles: Map<string, ColumnRole>
  /** Ordered list of frame column names (last = leaf) */
  frameOrder: string[]
  /** For JSON array columns used as frames, which object key to use as label */
  jsonArrayLabelKey: Map<string, string>
  /** Unit labels for metric columns */
  metricUnits: Map<string, string>
}

/** A generated pprof profile */
export interface GeneratedProfile {
  /** Display name */
  name: string
  /** Suggested file name */
  fileName: string
  /** Compressed pprof protobuf data */
  data: Uint8Array
  /** Number of samples */
  sampleCount: number
  /** Number of input rows */
  rowCount: number
  /** Partition key-value pairs (empty if not partitioned) */
  partitionValues: Record<string, string>
}

/** Application view state */
export type AppStep = 'import' | 'configure' | 'results'
