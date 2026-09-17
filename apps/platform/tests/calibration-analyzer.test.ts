import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CalibrationValidationError,
  analyzeCalibration,
  computeStatistics,
  parseDiagnosticSession,
  renderCalibrationMarkdown,
  validateManifest,
} from '../scripts/analyze-calibration.mjs'

const fixtureDirectory = fileURLToPath(new URL('./fixtures/calibration/', import.meta.url))

async function loadFixtureDataset() {
  const manifest = JSON.parse(await readFile(path.join(fixtureDirectory, 'manifest.json'), 'utf8'))
  const sessions = new Map<string, unknown>()
  for (const sample of manifest.samples) {
    const content = await readFile(path.join(fixtureDirectory, sample.session_file), 'utf8')
    sessions.set(sample.session_file, parseDiagnosticSession(content, '.json'))
  }
  return { manifest, sessions }
}

describe('calibration analyzer', () => {
  it('computes all required distribution statistics', () => {
    expect(computeStatistics([1, 2, 3, 4])).toEqual({
      count: 4,
      mean: 2.5,
      median: 2.5,
      std: 1.118,
      p5: 1.15,
      p25: 1.75,
      p50: 2.5,
      p75: 3.25,
      p95: 3.85,
    })
  })

  it('returns a valid empty-dataset report without inventing metrics', () => {
    const report = analyzeCalibration(
      { schema_version: 1, dataset_type: 'human-calibration', samples: [] },
      new Map(),
    )
    expect(report).toMatchObject({
      reportLabel: 'Engineering Calibration Metrics',
      sampleCount: 0,
      participantCount: 0,
      thresholdProposal: { status: 'WAITING_FOR_HUMAN_DATA', autoApplied: false, recommendations: [] },
    })
    expect(report.perParticipant).toEqual({})
    expect(report.perScenario).toEqual({})
    expect(report.thresholdContext.productionThresholdsChanged).toBe(false)
  })

  it('aggregates multiple participants by participant, exercise, and scenario', async () => {
    const { manifest, sessions } = await loadFixtureDataset()
    const report = analyzeCalibration(manifest, sessions, { allowTestFixtures: true })

    expect(report.sampleCount).toBe(4)
    expect(report.participantCount).toBe(2)
    expect(report.perParticipant.P01.exercises.lateral_raise.sampleCount).toBe(2)
    expect(report.perParticipant.P02.exercises.step_jack.sampleCount).toBe(2)
    expect(report.perScenario['lateral_raise:CORRECT'].statistics.shoulderPeakLeft.mean).toBe(91)
    expect(report.perScenario['step_jack:CORRECT'].statistics.openRatio.median).toBe(1.78)
    expect(report.samples.find((sample: { scenario: string; exercise_id: string }) => sample.scenario === 'CORRECT' && sample.exercise_id === 'step_jack').sideSequence).toBe('left')
  })

  it('computes engineering confusion-matrix metrics from ground-truth scenarios', async () => {
    const { manifest, sessions } = await loadFixtureDataset()
    const report = analyzeCalibration(manifest, sessions, { allowTestFixtures: true })

    expect(report.ruleMetrics['lateral_raise:right_arm_low']).toMatchObject({ TP: 1, FP: 0, TN: 1, FN: 0, precision: 1, recall: 1 })
    expect(report.ruleMetrics['lateral_raise:asymmetry']).toMatchObject({ TP: 0, FP: 1, TN: 1, FN: 0, falsePositiveRate: 0.5 })
    expect(report.ruleMetrics['step_jack:step_too_small']).toMatchObject({ TP: 1, FP: 0, TN: 1, FN: 0, falseNegativeRate: 0 })
  })

  it('parses Diagnostics CSV including quoted error fields', () => {
    const csv = [
      'timestamp,exerciseId,phase,activeErrors,torsoLean,openRatio,armAngle,currentSide',
      '0,"step_jack","CENTER","",2,1.0,10,""',
      '500,"step_jack","RIGHT_OPEN","STEP_TOO_SMALL|ARM_TOO_LOW",3,1.4,110,"right"',
    ].join('\n')
    const session = parseDiagnosticSession(csv, '.csv') as { frames: Array<Record<string, unknown>> }
    expect(session.frames).toHaveLength(2)
    expect(session.frames[1]).toMatchObject({ timestamp: 500, activeErrors: 'STEP_TOO_SMALL|ARM_TOO_LOW', openRatio: 1.4 })
  })

  it('rejects an invalid session instead of silently dropping it', async () => {
    const { manifest, sessions } = await loadFixtureDataset()
    sessions.set(manifest.samples[0].session_file, {
      frames: [{ timestamp: 0, exerciseId: 'step_jack', torsoLean: 0 }],
    })
    expect(() => analyzeCalibration(manifest, sessions, { allowTestFixtures: true })).toThrow(CalibrationValidationError)
  })

  it('renders the required report label and keeps threshold activation gated', () => {
    const report = analyzeCalibration(
      { schema_version: 1, dataset_type: 'human-calibration', samples: [] },
      new Map(),
    )
    const markdown = renderCalibrationMarkdown(report)
    expect(markdown).toContain('Engineering Calibration Metrics')
    expect(markdown).toContain('engineering-v1')
    expect(markdown).toContain('calibration-v1')
    expect(markdown).toContain('生产阈值已修改：否')
  })
})

describe('calibration manifest validation', () => {
  it('accepts the empty production manifest', () => {
    expect(validateManifest({ schema_version: 1, dataset_type: 'human-calibration', samples: [] })).toEqual({ valid: true, errors: [] })
  })

  it('rejects non-anonymous participants, cross-exercise scenarios, identity data, and unsafe files', () => {
    const result = validateManifest({
      schema_version: 1,
      dataset_type: 'human-calibration',
      samples: [{
        participant_id: 'Alice',
        participant_name: 'Alice',
        exercise_id: 'lateral_raise',
        scenario: 'STEP_TOO_SMALL',
        device: '',
        resolution: 'HD',
        lighting: 'indoor',
        camera_position: 'front',
        clothing_type: 'fitted',
        session_file: '../outside.json',
      }],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toContain('participant_id must match')
    expect(result.errors.join('\n')).toContain('forbidden identity data')
    expect(result.errors.join('\n')).toContain('is not valid for lateral_raise')
    expect(result.errors.join('\n')).toContain('safe relative path')
  })

  it('does not allow synthetic fixtures through the production path', async () => {
    const manifest = JSON.parse(await readFile(path.join(fixtureDirectory, 'manifest.json'), 'utf8'))
    expect(validateManifest(manifest).valid).toBe(false)
    expect(validateManifest(manifest, { allowTestFixtures: true }).valid).toBe(true)
  })
})
