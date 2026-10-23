// Shared result page for all three games: Score, then the same five rows — completed, success rate /
// accuracy, best combo, play time and Motion Quality (a game reference only) — in each game's words.
import { useEffect, useState } from 'react'
import { GAMES } from '../data/games'
import { sfx } from '../shared/audio'
import { formatDuration, formatPercent, type GameResult } from '../shared/metrics'

export function ResultScreen({ result, restLockMs, onReplay, onHub }: {
  result: GameResult
  /** >0 when the session time cap is reached: replay unlocks after this rest time */
  restLockMs: number
  onReplay: () => void
  onHub: () => void
}) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [lockLeft, setLockLeft] = useState(restLockMs)
  const game = GAMES.find((g) => g.id === result.gameId)

  useEffect(() => {
    sfx.result()
  }, [])

  useEffect(() => {
    if (restLockMs <= 0) return
    const until = performance.now() + restLockMs
    const timer = setInterval(() => setLockLeft(Math.max(0, until - performance.now())), 250)
    return () => clearInterval(timer)
  }, [restLockMs])

  return (
    <div className={`result result-${result.gameId}`}>
      <section className="result-card" data-testid="result" data-game={result.gameId} aria-labelledby="result-title">
        <div className="result-game">{game?.name}</div>
        <h2 id="result-title">本次得分</h2>
        <div className="score-big" data-testid="result-score">{result.score}</div>
        {result.highlight && (
          <div className="result-highlight" data-testid="result-highlight">{result.highlight.label}<b>{result.highlight.value}</b></div>
        )}
        <ul className="stats">
          <li><span>{result.labels.completed}</span><b data-testid="result-completed">{result.completed} / {result.total}</b></li>
          <li><span>{result.labels.successRate}</span><b data-testid="result-rate">{formatPercent(result.successRate)}</b></li>
          <li><span>{result.labels.combo}</span><b data-testid="result-combo">×{result.maxCombo}</b></li>
          <li><span>游戏时长</span><b>{formatDuration(result.activeMs)}</b></li>
          <li>
            <span>动作稳定性<small>仅作游戏动作参考</small></span>
            <b data-testid="result-quality">{formatPercent(result.motionQuality)}</b>
          </li>
        </ul>
        {restLockMs > 0 && (
          <div className="rest-card" role="status">
            ☕ 这次已经玩了一段时间，先休息一下吧。{lockLeft > 0 ? `${Math.ceil(lockLeft / 1000)} 秒后可以再玩。` : '休息好了可以再玩一次。'}
          </div>
        )}
        <div className="result-actions">
          <button className="btn btn-primary" onClick={onReplay} disabled={lockLeft > 0}>再玩一次</button>
          <button className="btn btn-secondary" onClick={onHub}>返回游戏选择</button>
          <button className="btn btn-ghost wide" aria-expanded={showFeedback} onClick={() => setShowFeedback((v) => !v)}>
            {showFeedback ? '收起动作反馈' : '查看简单动作反馈'}
          </button>
        </div>
        {showFeedback && (
          <div className="feedback" data-testid="feedback">
            <ul>
              <li><span>难度</span><b>{result.difficultyLabel}</b></li>
              {result.feedback.map((item) => (
                <li key={item.label}><span>{item.label}</span><b>{item.value}</b></li>
              ))}
            </ul>
            <p className="tip">💡 {result.tip}</p>
          </div>
        )}
      </section>
    </div>
  )
}
