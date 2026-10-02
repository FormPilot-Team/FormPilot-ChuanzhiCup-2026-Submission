import { COPY, INTRO } from '../data/games'
import type { GameDefinition } from '../games/registry'
import { ROUND_OPTIONS, type Difficulty, type Settings } from '../shared/settings'
import { PositioningArt } from './Illustrations'

export function Stepper({ index }: { index: number }) {
  return (
    <nav className="stepper" aria-label="进度">
      {COPY.steps.map((label, i) => (
        <span key={label} className={i === index ? 'on' : i < index ? 'done' : ''} aria-current={i === index ? 'step' : undefined}>
          {i < index ? '✓' : i + 1} {label}
        </span>
      ))}
    </nav>
  )
}

export function IntroStep({ game, settings, onChange, onNext, onBack }: { game: GameDefinition; settings: Settings; onChange: (s: Settings) => void; onNext: () => void; onBack: () => void }) {
  const copy = INTRO[game.id]
  return (
    <div className="page">
      <section className={`panel intro-${game.id}`} data-testid="step-intro">
        <h2>{copy.title}</h2>
        <p className="lead">{copy.lead}</p>
        <div className="how">
          {copy.how.map((item, i) => {
            const Art = game.howArt[i]
            return (
              <div className="how-item" key={item.title}>
                {Art && <Art />}
                <b>{i + 1}. {item.title}</b>
                <span>{item.text}</span>
              </div>
            )
          })}
        </div>
        <div className={`options${game.drawSideOption ? ' four' : ''}`}>
          <div>
            <div className="option-label">难度</div>
            <div className="seg">
              {(Object.keys(game.difficulty) as Difficulty[]).map((d) => (
                <button key={d} aria-pressed={settings.difficulty === d} onClick={() => onChange({ ...settings, difficulty: d })}>{game.difficulty[d].label}</button>
              ))}
            </div>
            <div className="seg-note">{game.difficulty[settings.difficulty].description}</div>
          </div>
          <div>
            <div className="option-label">怎么玩</div>
            <div className="seg">
              <button aria-pressed={!settings.seated} onClick={() => onChange({ ...settings, seated: false })}>站着玩</button>
              <button aria-pressed={settings.seated} onClick={() => onChange({ ...settings, seated: true })}>坐着玩</button>
            </div>
          </div>
          {game.drawSideOption && (
            <div>
              <div className="option-label">拉弦的手</div>
              <div className="seg">
                <button aria-pressed={settings.drawSide === 'right'} onClick={() => onChange({ ...settings, drawSide: 'right' })}>右手</button>
                <button aria-pressed={settings.drawSide === 'left'} onClick={() => onChange({ ...settings, drawSide: 'left' })}>左手</button>
              </div>
            </div>
          )}
          <div>
            <div className="option-label">时长</div>
            <div className="seg">
              {ROUND_OPTIONS.map((s) => (
                <button key={s} aria-pressed={settings.roundSeconds === s} onClick={() => onChange({ ...settings, roundSeconds: s })}>{s / 60} 分钟</button>
              ))}
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={onBack}>← 返回</button>
          <span className="note">⚠ {COPY.safety}</span>
          <button className="btn btn-primary" onClick={onNext}>下一步</button>
        </div>
      </section>
    </div>
  )
}

export function PositioningStep({ seated, onNext, onBack }: { seated: boolean; onNext: () => void; onBack: () => void }) {
  const tips = seated ? COPY.positioning.seated : COPY.positioning.standing
  return (
    <div className="page">
      <section className="panel" data-testid="step-positioning">
        <div className="positioning">
          <PositioningArt seated={seated} />
          <div>
            <h2>{seated ? '坐好位置' : '站好位置'}</h2>
            <p className="lead">下一步会打开摄像头。画面只在这台电脑上使用，不会录像或上传。</p>
            <ul className="check-list">
              {tips.map((tip, i) => (
                <li key={tip}><span className="dot">{i + 1}</span>{tip}</li>
              ))}
            </ul>
            <div className="actions">
              <button className="btn btn-ghost" onClick={onBack}>← 上一步</button>
              <button className="btn btn-primary" onClick={onNext}>打开摄像头</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
