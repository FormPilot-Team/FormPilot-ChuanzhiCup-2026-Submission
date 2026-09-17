/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SummaryStatistics {
  count: number
  mean: number | null
  median: number | null
  std: number | null
  p5: number | null
  p25: number | null
  p50: number | null
  p75: number | null
  p95: number | null
}

export interface ManifestValidationResult { valid: boolean; errors: string[] }
export class CalibrationValidationError extends Error { errors: string[] }
export const ENGINEERING_METRICS_LABEL: 'Engineering Calibration Metrics'
export const SCENARIOS: Readonly<Record<'lateral_raise' | 'step_jack', readonly string[]>>
export function computeStatistics(values: unknown[]): SummaryStatistics
export function validateManifest(input: unknown, options?: { allowTestFixtures?: boolean }): ManifestValidationResult
export function parseDiagnosticSession(content: string, extension?: string): Record<string, unknown>
export function computeClassificationMetrics(analyses: Array<Record<string, any>>): Record<string, Record<string, any>>
export function analyzeCalibration(manifest: any, sessionsByFile: Map<string, any> | Record<string, any>, options?: { allowTestFixtures?: boolean }): any
export function renderCalibrationMarkdown(report: any): string
export function runCli(argv?: string[]): Promise<any>
