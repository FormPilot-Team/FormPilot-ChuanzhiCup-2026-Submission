// Guard for the product rule "no medical-effect claims, no developer wording in the normal UI".
// Scans the Chinese text of every player-facing source file (UI, data, game copy, results).
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COPY, GAMES } from './games'

const SRC = path.resolve(__dirname, '..')
const PLAYER_FACING = [
  'data/games.ts', 'games/apple/round.ts', 'games/apple/config.ts', 'games/apple/reach.ts', 'games/apple/ApplePlay.tsx', 'games/apple/AppleScene.ts',
  'ui/Hub.tsx', 'ui/Steps.tsx', 'ui/CameraStep.tsx', 'ui/ResultScreen.tsx', 'ui/SettingsDialog.tsx', 'ui/GameFlow.tsx', 'ui/Illustrations.tsx',
  'motion/framing.ts', 'motion/vendor/BrowserCameraAdapter.ts', 'motion/poseSource.ts',
]
const MEDICAL = ['治疗', '疗效', '康复', '痊愈', '治愈', '恢复', '改善', '诊断', '医疗', '病', '冻结肩', '肩周炎', '活动度', '关节角', '处方']
const DEVELOPER = ['Phase', '实验', 'landmark', 'JSON', 'detector', 'ROM', 'MediaPipe', '阈值', '置信度']

/** Chinese runs inside string literals / JSX text (comments are stripped first). */
function playerText(file: string): string[] {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  return code.match(/[^\s'"`<>{}()=,;:]*[一-鿿][^'"`<>{}\n]*/g) ?? []
}

describe('player-facing wording', () => {
  it('contains no medical-effect wording', () => {
    for (const file of PLAYER_FACING) {
      for (const text of playerText(file)) {
        for (const word of MEDICAL) expect(text, `${file}: "${text}"`).not.toContain(word)
      }
    }
  })

  it('contains no developer / measurement wording in Chinese UI strings', () => {
    for (const file of PLAYER_FACING) {
      for (const text of playerText(file)) {
        for (const word of DEVELOPER) expect(text, `${file}: "${text}"`).not.toContain(word)
      }
    }
  })

  it('keeps a stop-if-uncomfortable safety line and marks unreleased games', () => {
    expect(COPY.safety).toContain('不适')
    expect(GAMES.filter((g) => g.available).map((g) => g.id)).toEqual(['apple'])
    expect(GAMES.find((g) => g.id === 'boating')!.available).toBe(false)
    expect(GAMES.find((g) => g.id === 'archery')!.available).toBe(false)
  })
})
