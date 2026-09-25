import type { PoseFrame, PoseLandmark } from '../features/pose/types'
import type { ExerciseId } from '../features/exercises/types'

const point = (x: number, y: number, visibility = 0.98): PoseLandmark => ({
  x,
  y,
  z: 0,
  visibility,
  presence: visibility,
})

export function createDemoPoseFrame(timestamp: number): PoseFrame {
  const cycle = timestamp % 4000
  let angle = 8
  if (cycle < 1200) angle = 8 + (cycle / 1200) * 82
  else if (cycle < 1900) angle = 90
  else if (cycle < 3200) angle = 90 - ((cycle - 1900) / 1300) * 82
  const rightAngle = cycle >= 1000 && cycle < 2200 ? Math.min(angle, 68) : angle
  const landmarks = Array.from({ length: 33 }, () => point(0.5, 0.5, 0.9))

  const leftShoulder = point(0.4, 0.34)
  const rightShoulder = point(0.6, 0.34)
  const leftHip = point(0.44, 0.58)
  const rightHip = point(0.56, 0.58)
  const limb = (shoulder: PoseLandmark, degrees: number, direction: -1 | 1) => {
    const radians = (degrees * Math.PI) / 180
    const elbow = point(shoulder.x + direction * Math.sin(radians) * 0.16, shoulder.y + Math.cos(radians) * 0.16)
    const wrist = point(elbow.x + direction * Math.sin(radians) * 0.16, elbow.y + Math.cos(radians) * 0.16)
    return { elbow, wrist }
  }
  const left = limb(leftShoulder, angle, -1)
  const right = limb(rightShoulder, rightAngle, 1)
  Object.assign(landmarks, {
    0: point(0.5, 0.17),
    11: leftShoulder,
    12: rightShoulder,
    13: left.elbow,
    14: right.elbow,
    15: left.wrist,
    16: right.wrist,
    23: leftHip,
    24: rightHip,
    25: point(0.45, 0.76),
    26: point(0.55, 0.76),
    27: point(0.45, 0.94),
    28: point(0.55, 0.94),
  })
  return { timestamp, landmarks, confidence: 0.98 }
}

export function createExerciseDemoPoseFrame(exerciseId: ExerciseId, timestamp: number, coachFixture?: string): PoseFrame {
  const frame = exerciseId === 'shoulder_rotation' ? createArmDemoPoseFrame(timestamp, 165, 2400)
    : exerciseId === 'overhead_raise' ? createOverheadRaiseDemoPoseFrame(timestamp)
      : exerciseId === 'step_jack' ? createStepJackDemoPoseFrame(timestamp)
        : exerciseId === 'squat' ? createSquatDemoPoseFrame(timestamp, coachFixture === 'squat-depth' ? 0.28 : 0.38)
          : exerciseId === 'knee_raise' ? createKneeRaiseDemoPoseFrame(timestamp)
            : createDemoPoseFrame(timestamp)
  if (coachFixture !== 'upper-body-crop') return frame
  const landmarks = frame.landmarks.map((landmark, index) => index >= 25 && index <= 28 ? { ...landmark, y: 1.1 } : landmark)
  return { ...frame, landmarks }
}

export function createGestureDemoPoseFrame(timestamp: number, gesture: 'start' | 'pause' | 'none', baseFrame?: PoseFrame): PoseFrame {
  const base = baseFrame ?? createArmDemoPoseFrame(0, 165, 2400)
  if (gesture === 'none') return { ...base, timestamp }
  const landmarks = [...base.landmarks]
  const leftShoulder = landmarks[11]
  const rightShoulder = landmarks[12]
  const leftHip = landmarks[23]
  const rightHip = landmarks[24]
  const centerX = (leftShoulder.x + rightShoulder.x) / 2
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2
  const hipY = (leftHip.y + rightHip.y) / 2
  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x)
  const torsoLength = Math.abs(hipY - shoulderY)
  const leftSide = Math.sign(leftShoulder.x - centerX) || -1
  const rightSide = Math.sign(rightShoulder.x - centerX) || 1
  const elbowY = shoulderY + torsoLength * 0.38
  const wristY = shoulderY + torsoLength * 0.52
  if (gesture === 'start') {
    Object.assign(landmarks, {
      13: point(leftShoulder.x + leftSide * shoulderWidth * 0.3, elbowY),
      14: point(rightShoulder.x + rightSide * shoulderWidth * 0.3, elbowY),
      15: point(centerX + leftSide * shoulderWidth * 0.05, wristY),
      16: point(centerX + rightSide * shoulderWidth * 0.05, wristY),
    })
  } else {
    Object.assign(landmarks, {
      13: point(leftShoulder.x + leftSide * shoulderWidth * 0.35, elbowY),
      14: point(rightShoulder.x + rightSide * shoulderWidth * 0.35, elbowY),
      15: point(centerX - leftSide * shoulderWidth * 0.45, wristY),
      16: point(centerX - rightSide * shoulderWidth * 0.45, wristY),
    })
  }
  return { ...base, timestamp, landmarks }
}

function createOverheadRaiseDemoPoseFrame(timestamp: number): PoseFrame {
  const cycle = timestamp % 5000
  let motionTimestamp = 0
  if (cycle >= 1000 && cycle < 1800) motionTimestamp = (cycle - 1000) / 800 * 1800
  else if (cycle >= 1800 && cycle < 2600) motionTimestamp = 1800
  else if (cycle >= 2600 && cycle < 3400) motionTimestamp = 1800 + (cycle - 2600) / 800 * 1800
  const frame = createArmDemoPoseFrame(motionTimestamp, 168, 3600)
  return { ...frame, timestamp }
}

function createArmDemoPoseFrame(timestamp: number, peakAngle: number, cycleMs: number): PoseFrame {
  const frame = createDemoPoseFrame(timestamp)
  const landmarks = [...frame.landmarks]
  const cycle = timestamp % cycleMs
  const progress = cycle < cycleMs / 2 ? cycle / (cycleMs / 2) : 1 - (cycle - cycleMs / 2) / (cycleMs / 2)
  const angle = 8 + Math.max(0, progress) * (peakAngle - 8)
  const shoulder = (index: number) => frame.landmarks[index]
  const limb = (origin: PoseLandmark, degrees: number, direction: -1 | 1) => {
    const radians = degrees * Math.PI / 180
    const elbow = point(origin.x + direction * Math.sin(radians) * .16, origin.y + Math.cos(radians) * .16)
    return { elbow, wrist: point(elbow.x + direction * Math.sin(radians) * .16, elbow.y + Math.cos(radians) * .16) }
  }
  const left = limb(shoulder(11), angle, -1); const right = limb(shoulder(12), angle, 1)
  landmarks[13] = left.elbow; landmarks[15] = left.wrist; landmarks[14] = right.elbow; landmarks[16] = right.wrist
  return { ...frame, landmarks }
}

export function createKneeRaiseDemoPoseFrame(timestamp: number): PoseFrame {
  const cycle = timestamp % 4200
  let progress = 0
  let side: 'left' | 'right' | undefined
  if (cycle >= 800 && cycle < 1300) { side = 'left'; progress = (cycle - 800) / 500 }
  else if (cycle >= 1300 && cycle < 1550) { side = 'left'; progress = 1 }
  else if (cycle >= 1550 && cycle < 2050) { side = 'left'; progress = 1 - (cycle - 1550) / 500 }
  else if (cycle >= 2550 && cycle < 3050) { side = 'right'; progress = (cycle - 2550) / 500 }
  else if (cycle >= 3050 && cycle < 3300) { side = 'right'; progress = 1 }
  else if (cycle >= 3300 && cycle < 3800) { side = 'right'; progress = 1 - (cycle - 3300) / 500 }
  const landmarks = Array.from({ length: 33 }, () => point(0.5, 0.5, 0.98))
  const leftHip = point(0.46, 0.52); const rightHip = point(0.54, 0.52)
  const leftKnee = side === 'left' ? point(0.55, 0.72 - progress * 0.21) : point(0.46, 0.72)
  const rightKnee = side === 'right' ? point(0.45, 0.72 - progress * 0.21) : point(0.54, 0.72)
  const leftAnkle = side === 'left' ? point(0.55, 0.91 - progress * 0.2) : point(0.46, 0.91)
  const rightAnkle = side === 'right' ? point(0.45, 0.91 - progress * 0.2) : point(0.54, 0.91)
  Object.assign(landmarks, {
    0: point(0.5, 0.13), 11: point(0.42, 0.29), 12: point(0.58, 0.29),
    13: point(0.46, 0.4), 14: point(0.54, 0.4), 15: point(0.5, 0.38), 16: point(0.5, 0.38),
    23: leftHip, 24: rightHip, 25: leftKnee, 26: rightKnee, 27: leftAnkle, 28: rightAnkle,
  })
  return { timestamp, landmarks, confidence: 0.98 }
}

export function createStepJackDemoPoseFrame(timestamp: number): PoseFrame {
  const cycle = timestamp % 3400
  let progress = 0
  let side: 'left' | 'right' | undefined
  if (cycle >= 200 && cycle < 800) { side = 'left'; progress = (cycle - 200) / 600 }
  else if (cycle < 1100 && cycle >= 800) { side = 'left'; progress = 1 }
  else if (cycle < 1600 && cycle >= 1100) { side = 'left'; progress = 1 - (cycle - 1100) / 500 }
  else if (cycle >= 1800 && cycle < 2400) { side = 'right'; progress = (cycle - 1800) / 600 }
  else if (cycle < 2700 && cycle >= 2400) { side = 'right'; progress = 1 }
  else if (cycle < 3200 && cycle >= 2700) { side = 'right'; progress = 1 - (cycle - 2700) / 500 }

  const armProgress = Math.max(0, Math.min(1, progress * 1.08))
  const angle = 8 + armProgress * 142
  const landmarks = Array.from({ length: 33 }, () => point(0.5, 0.5, 0.98))
  const leftShoulder = point(0.4, 0.34)
  const rightShoulder = point(0.6, 0.34)
  const leftHip = point(0.44, 0.58)
  const rightHip = point(0.56, 0.58)
  const limb = (shoulder: PoseLandmark, degrees: number, direction: -1 | 1) => {
    const radians = (degrees * Math.PI) / 180
    const elbow = point(shoulder.x + direction * Math.sin(radians) * 0.16, shoulder.y + Math.cos(radians) * 0.16)
    const wrist = point(elbow.x + direction * Math.sin(radians) * 0.16, elbow.y + Math.cos(radians) * 0.16)
    return { elbow, wrist }
  }
  const leftArm = limb(leftShoulder, angle, -1)
  const rightArm = limb(rightShoulder, angle, 1)
  const leftAnkleX = 0.45 - (side === 'left' ? progress * 0.13 : 0)
  const rightAnkleX = 0.55 + (side === 'right' ? progress * 0.13 : 0)
  Object.assign(landmarks, {
    0: point(0.5, 0.16), 11: leftShoulder, 12: rightShoulder,
    13: leftArm.elbow, 14: rightArm.elbow, 15: leftArm.wrist, 16: rightArm.wrist,
    23: leftHip, 24: rightHip,
    25: point((leftHip.x + leftAnkleX) / 2, 0.76), 26: point((rightHip.x + rightAnkleX) / 2, 0.76),
    27: point(leftAnkleX, 0.94), 28: point(rightAnkleX, 0.94),
  })
  return { timestamp, landmarks, confidence: 0.98 }
}

export function createSquatDemoPoseFrame(timestamp: number, maximumHipDrop = 0.38): PoseFrame {
  const cycle = timestamp % 5500
  let drop = 0
  if (cycle >= 800 && cycle < 2200) drop = (cycle - 800) / 1400
  else if (cycle >= 2200 && cycle < 2800) drop = 1
  else if (cycle >= 2800 && cycle < 4500) drop = 1 - (cycle - 2800) / 1700

  const torso = 0.22
  const hipDrop = maximumHipDrop * drop
  const hipY = 0.52 + hipDrop * torso
  const shoulderY = 0.3 + hipDrop * torso
  const noseY = 0.16 + hipDrop * torso
  const kneeY = 0.74 + drop * 0.018
  const landmarks = Array.from({ length: 33 }, () => point(0.5, 0.5, 0.98))
  Object.assign(landmarks, {
    0: point(0.5, noseY),
    11: point(0.4, shoulderY),
    12: point(0.6, shoulderY),
    13: point(0.46, shoulderY + 0.08),
    14: point(0.54, shoulderY + 0.08),
    15: point(0.49, shoulderY + 0.12),
    16: point(0.51, shoulderY + 0.12),
    23: point(0.445, hipY),
    24: point(0.555, hipY),
    25: point(0.45, kneeY),
    26: point(0.55, kneeY),
    27: point(0.45, 0.93),
    28: point(0.55, 0.93),
  })
  return { timestamp, landmarks, confidence: 0.98 }
}
