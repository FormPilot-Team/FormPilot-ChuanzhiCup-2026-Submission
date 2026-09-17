import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ENGINEERING_METRICS_LABEL = 'Engineering Calibration Metrics'

export const SCENARIOS = Object.freeze({
  lateral_raise: Object.freeze([
    'CORRECT', 'RIGHT_ARM_LOW', 'LEFT_ARM_LOW', 'ELBOW_BENT', 'ASYMMETRY', 'TORSO_LEAN', 'TOO_FAST',
  ]),
  step_jack: Object.freeze([
    'CORRECT', 'STEP_TOO_SMALL', 'ARM_TOO_LOW', 'ARM_LEG_UNSYNCED', 'WRONG_SIDE_SEQUENCE',
    'BODY_SWAY', 'TOO_FAST', 'INCOMPLETE_RETURN',
  ]),
})

const REQUIRED_SAMPLE_FIELDS = Object.freeze([
  'participant_id', 'exercise_id', 'scenario', 'device', 'resolution', 'lighting',
  'camera_position', 'clothing_type', 'session_file',
])

const FORBIDDEN_IDENTITY_FIELDS = new Set([
  'name', 'participant_name', 'full_name', 'email', 'phone', 'address',
])

const RULE_DEFINITIONS = Object.freeze([
  { exerciseId: 'lateral_raise', ruleId: 'right_arm_low', scenarios: ['RIGHT_ARM_LOW'], codes: ['ARM_TOO_LOW_R'] },
  { exerciseId: 'lateral_raise', ruleId: 'left_arm_low', scenarios: ['LEFT_ARM_LOW'], codes: ['ARM_TOO_LOW_L'] },
  { exerciseId: 'lateral_raise', ruleId: 'elbow_bent', scenarios: ['ELBOW_BENT'], codes: ['ELBOW_TOO_BENT_L', 'ELBOW_TOO_BENT_R'] },
  { exerciseId: 'lateral_raise', ruleId: 'asymmetry', scenarios: ['ASYMMETRY'], codes: ['ASYMMETRY'] },
  { exerciseId: 'lateral_raise', ruleId: 'torso_lean', scenarios: ['TORSO_LEAN'], codes: ['TORSO_LEAN'] },
  { exerciseId: 'lateral_raise', ruleId: 'too_fast', scenarios: ['TOO_FAST'], codes: ['TOO_FAST'] },
  { exerciseId: 'step_jack', ruleId: 'step_too_small', scenarios: ['STEP_TOO_SMALL'], codes: ['STEP_TOO_SMALL'] },
  { exerciseId: 'step_jack', ruleId: 'arm_too_low', scenarios: ['ARM_TOO_LOW'], codes: ['ARM_TOO_LOW'] },
  { exerciseId: 'step_jack', ruleId: 'arm_leg_unsynced', scenarios: ['ARM_LEG_UNSYNCED'], codes: ['ARM_LEG_UNSYNCED'] },
  { exerciseId: 'step_jack', ruleId: 'wrong_side_sequence', scenarios: ['WRONG_SIDE_SEQUENCE'], codes: ['WRONG_SIDE_SEQUENCE'] },
  { exerciseId: 'step_jack', ruleId: 'body_sway', scenarios: ['BODY_SWAY'], codes: ['BODY_SWAY'] },
  { exerciseId: 'step_jack', ruleId: 'too_fast', scenarios: ['TOO_FAST'], codes: ['TOO_FAST'] },
  { exerciseId: 'step_jack', ruleId: 'incomplete_return', scenarios: ['INCOMPLETE_RETURN'], codes: ['INCOMPLETE_RETURN'] },
])

const NUMERIC_FRAME_FIELDS = new Set([
  'timestamp', 'poseConfidence', 'repIndex', 'currentScore', 'leftShoulderAngle', 'rightShoulderAngle',
  'leftElbowAngle', 'rightElbowAngle', 'symmetryDiff', 'torsoLean', 'openRatio', 'leftStepOffset',
  'rightStepOffset', 'armAngle', 'armLegSyncGapMs',
])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function finiteNumbers(values) {
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value))
}

function maxOrUndefined(values) {
  const valid = finiteNumbers(values)
  return valid.length ? Math.max(...valid) : undefined
}

function minOrUndefined(values) {
  const valid = finiteNumbers(values)
  return valid.length ? Math.min(...valid) : undefined
}

function medianOrUndefined(values) {
  const valid = finiteNumbers(values).sort((a, b) => a - b)
  if (!valid.length) return undefined
  const middle = Math.floor(valid.length / 2)
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null
  if (sorted.length === 1) return sorted[0]
  const position = (sorted.length - 1) * ratio
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function round(value) {
  return value === null ? null : Number(value.toFixed(4))
}

export function computeStatistics(values) {
  const sorted = finiteNumbers(values).sort((a, b) => a - b)
  if (!sorted.length) {
    return { count: 0, mean: null, median: null, std: null, p5: null, p25: null, p50: null, p75: null, p95: null }
  }
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  const variance = sorted.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / sorted.length
  return {
    count: sorted.length,
    mean: round(mean),
    median: round(percentile(sorted, 0.5)),
    std: round(Math.sqrt(variance)),
    p5: round(percentile(sorted, 0.05)),
    p25: round(percentile(sorted, 0.25)),
    p50: round(percentile(sorted, 0.5)),
    p75: round(percentile(sorted, 0.75)),
    p95: round(percentile(sorted, 0.95)),
  }
}

export class CalibrationValidationError extends Error {
  constructor(errors) {
    super(`Calibration validation failed:\n${errors.map((entry) => `- ${entry}`).join('\n')}`)
    this.name = 'CalibrationValidationError'
    this.errors = errors
  }
}

export function validateManifest(input, options = {}) {
  const errors = []
  if (!isRecord(input)) return { valid: false, errors: ['manifest must be an object'] }
  if (input.schema_version !== 1) errors.push('schema_version must be 1')
  const allowedDatasetTypes = options.allowTestFixtures
    ? ['human-calibration', 'synthetic-test-fixture']
    : ['human-calibration']
  if (!allowedDatasetTypes.includes(input.dataset_type)) {
    errors.push(`dataset_type must be ${allowedDatasetTypes.map((value) => JSON.stringify(value)).join(' or ')}`)
  }
  if (!Array.isArray(input.samples)) {
    errors.push('samples must be an array')
    return { valid: false, errors }
  }

  const seenSessionFiles = new Set()
  input.samples.forEach((sample, index) => {
    const prefix = `samples[${index}]`
    if (!isRecord(sample)) {
      errors.push(`${prefix} must be an object`)
      return
    }
    for (const field of REQUIRED_SAMPLE_FIELDS) {
      if (!(field in sample)) errors.push(`${prefix}.${field} is required`)
    }
    for (const field of Object.keys(sample)) {
      if (FORBIDDEN_IDENTITY_FIELDS.has(field.toLowerCase())) errors.push(`${prefix}.${field} is forbidden identity data`)
      if (!REQUIRED_SAMPLE_FIELDS.includes(field)) errors.push(`${prefix}.${field} is not allowed`)
    }
    if (typeof sample.participant_id !== 'string' || !/^P\d{2,}$/.test(sample.participant_id)) {
      errors.push(`${prefix}.participant_id must match P01, P02, ...`)
    }
    if (!(sample.exercise_id in SCENARIOS)) {
      errors.push(`${prefix}.exercise_id must be lateral_raise or step_jack`)
    } else if (!SCENARIOS[sample.exercise_id].includes(sample.scenario)) {
      errors.push(`${prefix}.scenario ${JSON.stringify(sample.scenario)} is not valid for ${sample.exercise_id}`)
    }
    for (const field of ['device', 'lighting', 'camera_position', 'clothing_type']) {
      if (!nonEmptyString(sample[field])) errors.push(`${prefix}.${field} must be a non-empty string`)
    }
    if (typeof sample.resolution !== 'string' || !/^\d+\s*[x×]\s*\d+$/.test(sample.resolution)) {
      errors.push(`${prefix}.resolution must look like 1280x720 or 1280×720`)
    }
    if (!nonEmptyString(sample.session_file)) {
      errors.push(`${prefix}.session_file must be a non-empty string`)
    } else {
      const normalized = sample.session_file.replaceAll('\\', '/')
      if (!normalized.startsWith('raw/') || !/\.(json|csv)$/i.test(normalized)) {
        errors.push(`${prefix}.session_file must reference a JSON or CSV file under raw/`)
      }
      if (normalized.split('/').includes('..') || path.isAbsolute(sample.session_file)) {
        errors.push(`${prefix}.session_file must be a safe relative path`)
      }
      if (seenSessionFiles.has(normalized)) errors.push(`${prefix}.session_file duplicates ${normalized}`)
      seenSessionFiles.add(normalized)
    }
  })
  return { valid: errors.length === 0, errors }
}

function parseCsvRows(content) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"'
        index += 1
      } else quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && content[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((entry) => entry.length > 0)) rows.push(row)
      row = []
      cell = ''
    } else cell += character
  }
  row.push(cell)
  if (row.some((entry) => entry.length > 0)) rows.push(row)
  return rows
}

export function parseDiagnosticSession(content, extension = '.json') {
  if (extension.toLowerCase() === '.json') {
    const parsed = JSON.parse(content)
    if (!isRecord(parsed) || !Array.isArray(parsed.frames)) throw new CalibrationValidationError(['diagnostics JSON must contain a frames array'])
    if (parsed.schemaVersion !== 1) throw new CalibrationValidationError(['diagnostics JSON schemaVersion must be 1'])
    if (parsed.privacy !== 'derived-pose-metrics-only-no-video') {
      throw new CalibrationValidationError(['diagnostics JSON must declare derived-pose-metrics-only-no-video privacy'])
    }
    return parsed
  }
  if (extension.toLowerCase() !== '.csv') throw new CalibrationValidationError([`unsupported session extension: ${extension}`])
  const rows = parseCsvRows(content)
  if (rows.length < 2) throw new CalibrationValidationError(['diagnostics CSV must contain a header and at least one data row'])
  const headers = rows[0]
  for (const required of ['timestamp', 'exerciseId', 'phase', 'activeErrors', 'torsoLean']) {
    if (!headers.includes(required)) throw new CalibrationValidationError([`diagnostics CSV is missing ${required}`])
  }
  const frames = rows.slice(1).map((values, rowIndex) => Object.fromEntries(headers.map((header, index) => {
    const value = values[index] ?? ''
    if (!NUMERIC_FRAME_FIELDS.has(header)) return [header, value || undefined]
    if (value === '') return [header, undefined]
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
      throw new CalibrationValidationError([`diagnostics CSV row ${rowIndex + 2} field ${header} must be finite`])
    }
    return [header, numericValue]
  })))
  return {
    schemaVersion: 1,
    privacy: 'derived-pose-metrics-only-no-video',
    generatedAt: '',
    frames,
    repetitions: [],
    performance: null,
    sourceFormat: 'csv',
  }
}

function splitErrors(value) {
  if (Array.isArray(value)) return value.filter(nonEmptyString)
  if (!nonEmptyString(value)) return []
  return value.split('|').map((entry) => entry.trim()).filter(Boolean)
}

function deriveDurations(frames, exerciseId) {
  const durations = []
  let startedAt
  for (const frame of frames) {
    const transition = frame.phaseTransition ?? ''
    const starts = exerciseId === 'lateral_raise'
      ? transition.endsWith('->RAISING')
      : transition.endsWith('->LEFT_OPENING') || transition.endsWith('->RIGHT_OPENING')
    const completes = exerciseId === 'lateral_raise'
      ? transition.endsWith('->COMPLETE')
      : transition.endsWith('->CENTER')
    if (starts && Number.isFinite(frame.timestamp)) startedAt = frame.timestamp
    if (completes && startedAt !== undefined && Number.isFinite(frame.timestamp)) {
      durations.push(frame.timestamp - startedAt)
      startedAt = undefined
    }
  }
  return durations
}

function analyzeSample(sample, session) {
  if (!isRecord(session) || !Array.isArray(session.frames)) {
    throw new CalibrationValidationError([`${sample.session_file}: session must contain a frames array`])
  }
  if (!session.frames.length) throw new CalibrationValidationError([`${sample.session_file}: session has no diagnostic frames`])
  const frames = session.frames.filter((frame) => frame.exerciseId === sample.exercise_id)
  if (!frames.length) throw new CalibrationValidationError([`${sample.session_file}: no frames match ${sample.exercise_id}`])
  const invalidNumbers = frames.flatMap((frame, index) => [...NUMERIC_FRAME_FIELDS].flatMap((field) => {
    if (frame[field] === undefined && field !== 'timestamp' && field !== 'torsoLean') return []
    return Number.isFinite(frame[field]) ? [] : [`${sample.session_file}: frames[${index}].${field} must be finite`]
  }))
  if (invalidNumbers.length) throw new CalibrationValidationError(invalidNumbers)

  const repetitions = Array.isArray(session.repetitions)
    ? session.repetitions.filter((rep) => rep.exerciseId === sample.exercise_id)
    : []
  const detectedErrors = [...new Set(frames.flatMap((frame) => splitErrors(frame.activeErrors)))].sort()
  const derivedDurations = deriveDurations(frames, sample.exercise_id)

  if (sample.exercise_id === 'lateral_raise') {
    const repDurations = finiteNumbers(repetitions.map((rep) => rep.duration))
    return {
      ...sample,
      metrics: {
        shoulderPeakLeft: maxOrUndefined(repetitions.length ? repetitions.map((rep) => rep.peakShoulderLeft) : frames.map((frame) => frame.leftShoulderAngle)),
        shoulderPeakRight: maxOrUndefined(repetitions.length ? repetitions.map((rep) => rep.peakShoulderRight) : frames.map((frame) => frame.rightShoulderAngle)),
        elbowMinimumLeft: minOrUndefined(repetitions.length ? repetitions.map((rep) => rep.minimumElbowLeft) : frames.map((frame) => frame.leftElbowAngle)),
        elbowMinimumRight: minOrUndefined(repetitions.length ? repetitions.map((rep) => rep.minimumElbowRight) : frames.map((frame) => frame.rightElbowAngle)),
        symmetryDifference: maxOrUndefined(repetitions.length ? repetitions.map((rep) => rep.maxSymmetryDiff) : frames.map((frame) => frame.symmetryDiff)),
        torsoLean: maxOrUndefined(repetitions.length ? repetitions.map((rep) => rep.maxTorsoLean) : frames.map((frame) => frame.torsoLean)),
        repDurationMs: medianOrUndefined(repDurations.length ? repDurations : derivedDurations),
      },
      detectedErrors,
    }
  }

  const repDurations = finiteNumbers(repetitions.map((rep) => rep.duration))
  const repSides = repetitions.map((rep) => rep.side).filter((side) => side === 'left' || side === 'right')
  const frameSides = frames.map((frame) => frame.currentSide).filter((side, index, values) =>
    (side === 'left' || side === 'right') && side !== values[index - 1])
  return {
    ...sample,
    metrics: {
      openRatio: maxOrUndefined(repetitions.length ? repetitions.map((rep) => rep.peakOpenRatio) : frames.map((frame) => frame.openRatio)),
      armPeakAngle: maxOrUndefined(frames.map((frame) => frame.armAngle)),
      armLegSyncGapMs: medianOrUndefined(repetitions.length ? repetitions.map((rep) => rep.syncGapMs) : frames.map((frame) => frame.armLegSyncGapMs)),
      torsoLean: maxOrUndefined(repetitions.length ? repetitions.map((rep) => rep.maxTorsoLean) : frames.map((frame) => frame.torsoLean)),
      cycleDurationMs: medianOrUndefined(repDurations.length ? repDurations : derivedDurations),
    },
    sideSequence: (repSides.length ? repSides : frameSides).join('>'),
    detectedErrors,
  }
}

function aggregateSamples(samples) {
  const metricKeys = [...new Set(samples.flatMap((sample) => Object.keys(sample.metrics)))].sort()
  return {
    sampleCount: samples.length,
    statistics: Object.fromEntries(metricKeys.map((key) => [key, computeStatistics(samples.map((sample) => sample.metrics[key]))])),
  }
}

function groupAnalyses(analyses) {
  const participantBuckets = new Map()
  const scenarioBuckets = new Map()
  for (const analysis of analyses) {
    if (!participantBuckets.has(analysis.participant_id)) participantBuckets.set(analysis.participant_id, new Map())
    const participantExercises = participantBuckets.get(analysis.participant_id)
    if (!participantExercises.has(analysis.exercise_id)) participantExercises.set(analysis.exercise_id, [])
    participantExercises.get(analysis.exercise_id).push(analysis)

    const scenarioKey = `${analysis.exercise_id}:${analysis.scenario}`
    if (!scenarioBuckets.has(scenarioKey)) scenarioBuckets.set(scenarioKey, [])
    scenarioBuckets.get(scenarioKey).push(analysis)
  }
  return {
    perParticipant: Object.fromEntries([...participantBuckets.entries()].sort().map(([participantId, exerciseMap]) => [
      participantId,
      { exercises: Object.fromEntries([...exerciseMap.entries()].map(([exerciseId, samples]) => [exerciseId, aggregateSamples(samples)])) },
    ])),
    perScenario: Object.fromEntries([...scenarioBuckets.entries()].sort().map(([key, samples]) => [key, aggregateSamples(samples)])),
  }
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : round(numerator / denominator)
}

export function computeClassificationMetrics(analyses) {
  return Object.fromEntries(RULE_DEFINITIONS.map((rule) => {
    const relevant = analyses.filter((sample) => sample.exercise_id === rule.exerciseId)
    let TP = 0
    let FP = 0
    let TN = 0
    let FN = 0
    for (const sample of relevant) {
      const actualPositive = rule.scenarios.includes(sample.scenario)
      const predictedPositive = rule.codes.some((code) => sample.detectedErrors.includes(code))
      if (actualPositive && predictedPositive) TP += 1
      else if (!actualPositive && predictedPositive) FP += 1
      else if (!actualPositive && !predictedPositive) TN += 1
      else FN += 1
    }
    return [`${rule.exerciseId}:${rule.ruleId}`, {
      exerciseId: rule.exerciseId,
      ruleId: rule.ruleId,
      groundTruthScenarios: rule.scenarios,
      detectedErrorCodes: rule.codes,
      TP, FP, TN, FN,
      precision: ratio(TP, TP + FP),
      recall: ratio(TP, TP + FN),
      falsePositiveRate: ratio(FP, FP + TN),
      falseNegativeRate: ratio(FN, FN + TP),
    }]
  }))
}

export function analyzeCalibration(manifest, sessionsByFile, options = {}) {
  const validation = validateManifest(manifest, options)
  if (!validation.valid) throw new CalibrationValidationError(validation.errors)
  const getSession = sessionsByFile instanceof Map
    ? (sessionFile) => sessionsByFile.get(sessionFile)
    : (sessionFile) => sessionsByFile[sessionFile]
  const analyses = manifest.samples.map((sample) => {
    const session = getSession(sample.session_file)
    if (!session) throw new CalibrationValidationError([`${sample.session_file}: session data was not provided`])
    return analyzeSample(sample, session)
  })
  const grouped = groupAnalyses(analyses)
  const participants = [...new Set(analyses.map((sample) => sample.participant_id))].sort()
  return {
    reportLabel: ENGINEERING_METRICS_LABEL,
    generatedAt: new Date().toISOString(),
    manifestSchemaVersion: manifest.schema_version,
    datasetType: manifest.dataset_type,
    sampleCount: analyses.length,
    participantCount: participants.length,
    participants,
    scenarios: [...new Set(analyses.map((sample) => `${sample.exercise_id}:${sample.scenario}`))].sort(),
    devices: [...new Set(analyses.map((sample) => `${sample.device} (${sample.resolution})`))].sort(),
    thresholdContext: {
      specVersion: 'exercise-rules-v1.0',
      activeThresholdVersion: 'engineering-v1',
      proposedThresholdVersion: 'calibration-v1',
      productionThresholdsChanged: false,
    },
    samples: analyses,
    ...grouped,
    ruleMetrics: computeClassificationMetrics(analyses),
    thresholdProposal: {
      status: analyses.length ? 'REVIEW_REQUIRED' : 'WAITING_FOR_HUMAN_DATA',
      autoApplied: false,
      recommendations: [],
    },
  }
}

function metricValue(value) {
  return value === null ? '—' : String(value)
}

export function renderCalibrationMarkdown(report) {
  const ruleRows = Object.values(report.ruleMetrics).map((metric) =>
    `| ${metric.exerciseId} | ${metric.ruleId} | ${metric.TP} | ${metric.FP} | ${metric.TN} | ${metric.FN} | ${metricValue(metric.precision)} | ${metricValue(metric.recall)} | ${metricValue(metric.falsePositiveRate)} | ${metricValue(metric.falseNegativeRate)} |`)
  const scenarioText = report.scenarios.length ? report.scenarios.map((entry) => `\`${entry}\``).join('、') : '尚无真人样本'
  const deviceText = report.devices.length ? report.devices.join('、') : '尚无设备记录'
  const participantRows = Object.entries(report.perParticipant).flatMap(([participantId, participant]) =>
    Object.entries(participant.exercises).flatMap(([exerciseId, aggregate]) =>
      Object.entries(aggregate.statistics).map(([metric, stats]) =>
        `| ${participantId} | ${exerciseId} | ${metric} | ${stats.count} | ${metricValue(stats.mean)} | ${metricValue(stats.median)} | ${metricValue(stats.std)} | ${metricValue(stats.p5)} | ${metricValue(stats.p25)} | ${metricValue(stats.p50)} | ${metricValue(stats.p75)} | ${metricValue(stats.p95)} |`)))
  const scenarioRows = Object.entries(report.perScenario).flatMap(([scenario, aggregate]) =>
    Object.entries(aggregate.statistics).map(([metric, stats]) =>
      `| ${scenario} | ${metric} | ${stats.count} | ${metricValue(stats.mean)} | ${metricValue(stats.median)} | ${metricValue(stats.std)} | ${metricValue(stats.p5)} | ${metricValue(stats.p25)} | ${metricValue(stats.p50)} | ${metricValue(stats.p75)} | ${metricValue(stats.p95)} |`))
  const statusText = report.sampleCount
    ? '已生成分布与规则表现；阈值建议需人工审核后单独形成 threshold proposal。'
    : '等待真人 Diagnostics 导出；本报告不包含任何合成样本或自动生成的阈值建议。'
  return `# ${ENGINEERING_METRICS_LABEL}

> Phase 2.2 Human Calibration  
> 状态：${report.thresholdProposal.status}  
> 生产阈值已修改：否

## 测试规模

- 样本数：${report.sampleCount}
- 匿名参与者数：${report.participantCount}
- 参与者 ID：${report.participants.length ? report.participants.join('、') : '无'}

## 人群范围

数据规范只收集匿名 ID 和工程拍摄条件，不收集姓名或直接身份信息。当前样本范围：${report.sampleCount ? '见 manifest 中的匿名样本' : '尚无真人数据'}。

## 场景

${scenarioText}

## 设备

${deviceText}

## 按参与者统计

| Participant | Exercise | Metric | N | Mean | Median | Std | P5 | P25 | P50 | P75 | P95 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${participantRows.length ? participantRows.join('\n') : '| 无数据 | — | — | 0 | — | — | — | — | — | — | — | — |'}

## 按场景统计

| Exercise:Scenario | Metric | N | Mean | Median | Std | P5 | P25 | P50 | P75 | P95 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${scenarioRows.length ? scenarioRows.join('\n') : '| 无数据 | — | 0 | — | — | — | — | — | — | — | — |'}

## 每条规则表现

| Exercise | Rule | TP | FP | TN | FN | Precision | Recall | False Positive Rate | False Negative Rate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${ruleRows.join('\n')}

## 当前误报

${report.sampleCount ? '见上表 FP 与 False Positive Rate；细项见 `calibration_data/reports/engineering-calibration-metrics.json`。' : '无真人数据，无法计算。'}

## 当前漏报

${report.sampleCount ? '见上表 FN 与 False Negative Rate；细项见 `calibration_data/reports/engineering-calibration-metrics.json`。' : '无真人数据，无法计算。'}

## 建议阈值

${statusText}

## 未修改阈值

Lateral Raise 与 Step Jack 的现有数值全部保持 \`engineering-v1\`。\`calibration-v1\` 仅作为未来 proposal 版本标识，未激活、未写入生产规则。

## 为什么修改

当前没有修改。未收到真人数据前，不使用 synthetic pose 调整 V1 阈值。未来如提议修改，必须记录对应场景分布、误报/漏报变化和人工审批结果。

## 已知限制

- 当前样本数为 ${report.sampleCount}，无法做人群外推。
- Ground truth 由样本 scenario 提供，质量取决于采集流程与标注一致性。
- JSON repetition 汇总比 CSV 逐帧推导的周期数据更完整；CSV 分析依赖 phase transition。
- 结果仅用于当前工程规则、指定设备和已采集场景的校准判断。
`
}

function parseArguments(argv) {
  const options = {
    manifest: 'calibration_data/manifest.json',
    processed: 'calibration_data/processed/calibration-samples.json',
    report: 'calibration_data/reports/engineering-calibration-metrics.json',
    markdown: 'docs/calibration-results.md',
    allowTestFixtures: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--allow-test-fixtures') options.allowTestFixtures = true
    else if (argument === '--manifest') options.manifest = argv[++index]
    else if (argument === '--processed') options.processed = argv[++index]
    else if (argument === '--report') options.report = argv[++index]
    else if (argument === '--markdown') options.markdown = argv[++index]
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

async function loadDataset(manifestPath, allowTestFixtures) {
  const manifestContent = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(manifestContent)
  const validation = validateManifest(manifest, { allowTestFixtures })
  if (!validation.valid) throw new CalibrationValidationError(validation.errors)
  const manifestDirectory = path.dirname(path.resolve(manifestPath))
  const rawDirectory = path.resolve(manifestDirectory, 'raw')
  const sessions = new Map()
  for (const sample of manifest.samples) {
    const sessionPath = path.resolve(manifestDirectory, sample.session_file)
    const relativeToRaw = path.relative(rawDirectory, sessionPath)
    if (relativeToRaw.startsWith('..') || path.isAbsolute(relativeToRaw)) {
      throw new CalibrationValidationError([`${sample.session_file}: resolved path escapes raw/`])
    }
    const content = await readFile(sessionPath, 'utf8')
    sessions.set(sample.session_file, parseDiagnosticSession(content, path.extname(sessionPath)))
  }
  return { manifest, sessions }
}

async function writeOutput(filePath, content) {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  const { manifest, sessions } = await loadDataset(options.manifest, options.allowTestFixtures)
  const report = analyzeCalibration(manifest, sessions, { allowTestFixtures: options.allowTestFixtures })
  await writeOutput(options.processed, `${JSON.stringify({ reportLabel: report.reportLabel, generatedAt: report.generatedAt, samples: report.samples }, null, 2)}\n`)
  await writeOutput(options.report, `${JSON.stringify(report, null, 2)}\n`)
  await writeOutput(options.markdown, renderCalibrationMarkdown(report))
  process.stdout.write(`${ENGINEERING_METRICS_LABEL}: ${report.sampleCount} samples, ${report.participantCount} participants. Thresholds changed: no.\n`)
  return report
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
