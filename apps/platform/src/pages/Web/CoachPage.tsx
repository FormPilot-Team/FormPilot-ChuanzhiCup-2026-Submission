import { useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { GAMES_PATH, HISTORY_PATH, ROUTINES_PATH } from '../../app/routes'
import { resolveCoachDecisionRuntime, type CoachDecisionRuntime, type WebCoachDecisionMode } from '../../app/coachDecisionConfig'
import { CoachAgentChat } from '../../components/web/CoachAgentChat'
import { useCoachAgentChat } from '../../components/web/useCoachAgentChat'
import { CoachOrb } from '../../components/web/CoachOrb'
import { StatusPill, WebEmpty, WebShell } from '../../components/web/WebShell'
import {
  recommendCoachDecision, describeCoachDecisionModel,
  type CoachDecisionExplanation, type CoachDecisionFallbackReason, type CoachDecisionRankedItem, type CoachDecisionResponse,
} from '../../features/coachAgent/decisionModel/engine'
import { collectLocalDecisionInput } from '../../features/coachAgent/decisionModel/engine/platform'
import { COACH_DECISION_SHADOW_LOG_KEY, COACH_DECISION_SHADOW_LOG_MAX, toShadowLogEntry } from '../../features/coachAgent/decisionModel/engine/shadow'
import { FOCUS_LABELS } from '../../features/coachAgent/recommendation/engine'
import type { CoachProfile, CoachQuestion, CoachRecommendation } from '../../features/coachAgent/recommendation/types'
import type { AgentToolContext } from '../../features/coachLlm/tools'
import { findWebGame } from '../../features/web/games'

/** Option wording reused from the existing AI Coach profile form (CoachProfile v1, coachAgent/sprint). */
const GOALS = [['mobility', '肩颈活动练习'], ['upper_limb', '上肢动作练习'], ['daily', '日常锻炼'], ['rehab_support', '康复辅助']] as const
const DIFFICULTIES = [['stiffness', '肩部僵硬'], ['reach_difficulty', '抬手困难'], ['soreness', '酸痛'], ['sedentary', '久坐肩颈不适'], ['none', '暂无不适']] as const
const REGIONS = [['shoulders', '肩部'], ['neck', '颈部'], ['arms', '上肢'], ['trunk', '躯干'], ['legs', '下肢']] as const
const RISKS = [['none', '未报告以下风险'], ['acute_pain', '当前有急性或明显疼痛'], ['dizziness', '当前眩晕或站立不稳'], ['recent_injury', '近期受伤或术后']] as const
/** The fixed five questions of the Agent Web contract. */
export const COACH_FIXED_QUESTIONS: ReadonlyArray<[CoachQuestion, string]> = [['suitable', '我适合练什么？'], ['first_game', '先玩哪个游戏？'], ['recent_issues', '最近主要问题是什么？'], ['why', '为什么这样推荐？'], ['next_focus', '下一阶段练什么？']]

const INITIAL_PROFILE: CoachProfile = { version: 1, goals: [], difficulties: [], regions: [], preference: 'mixed', risk: 'none', acknowledged: false }
/** Model identity wording (matches the engine's tier label; the project owner reviewed the AI labels on 2026-11-09). */
export const EXPERIMENTAL_LABEL = '实验性模型：AI 标注训练，项目负责人已审阅标签，尚未进行独立人工或专家标注'
const SUITABILITY_NOTE = '适配度 = 校准后“标注者认为适合”的概率，只在本次候选内比较，不是医学概率或疗效判断。'

/** Why the page shows the rule recommendation instead of the model's, in user words. */
const FALLBACK_TEXT: Partial<Record<CoachDecisionFallbackReason, string>> = {
  MODEL_ABSTAINED: '模型对这种情况把握不足，已弃权并使用规则推荐。',
  INPUT_INVALID: '输入数据未通过校验，模型未运行，已使用规则推荐。',
  INVALID_AVAILABILITY: '可用内容清单未通过校验，已使用规则推荐。',
  MODEL_ERROR: '模型运行异常，已使用规则推荐。',
  OUTPUT_GUARD_REJECTED: '模型输出未通过独立安全检查，已使用规则推荐。',
  NO_CANDIDATES: '安全筛选后没有模型候选，已使用规则推荐。',
  MODEL_MISSING: '模型文件缺失，已使用规则推荐。',
  WEIGHTS_INVALID: '模型权重校验失败，已使用规则推荐。',
  MODEL_VERSION_MISMATCH: '模型版本不一致，已使用规则推荐。',
  CATALOGUE_MISMATCH: '内容目录指纹不一致，已使用规则推荐。',
  CONTENT_FEATURES_MISMATCH: '内容特征表指纹不一致，已使用规则推荐。',
  LABELS_NOT_ACCEPTED: '模型标签未被接受，已使用规则推荐。',
  MODEL_NOT_TRAINED: '模型尚未训练，已使用规则推荐。',
  EXPERIMENTAL_MODEL_NOT_APPROVED: '本构建未批准实验性模型，已使用规则推荐。',
}

type CoachView = 'profile' | 'result' | 'questions' | 'plan'
type DataScope = 'profile_only' | 'local_records'

function toggle<T>(items: readonly T[], item: T): T[] { return items.includes(item) ? items.filter((value) => value !== item) : [...items, item] }

function appendShadowLog(res: CoachDecisionResponse, elapsedMs: number): void {
  try {
    const raw = window.localStorage.getItem(COACH_DECISION_SHADOW_LOG_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    const log = Array.isArray(parsed) ? parsed : []
    log.push(toShadowLogEntry(res, { at: Date.now(), elapsedMs }))
    window.localStorage.setItem(COACH_DECISION_SHADOW_LOG_KEY, JSON.stringify(log.slice(-COACH_DECISION_SHADOW_LOG_MAX)))
  } catch { /* storage unavailable: SHADOW logging is best effort and never blocks the recommendation */ }
}

export interface CoachRun { response: CoachDecisionResponse | null; elapsedMs: number; failed: boolean }

/**
 * One recommendation: profile (+ consented local records) → `recommendCoachDecision` → rules or model display.
 * A plain mode string never approves the experimental weights; only the competition build's runtime does. Never throws.
 */
export function runCoachDecision(profile: CoachProfile, scope: DataScope, runtime: WebCoachDecisionMode | CoachDecisionRuntime, storage: Pick<Storage, 'getItem'> | null, now = Date.now()): CoachRun {
  const { mode, allowExperimentalModel } = typeof runtime === 'string' ? { mode: runtime, allowExperimentalModel: false } : runtime
  let started = performance.now()
  try {
    const input = collectLocalDecisionInput(profile, { storage: storage ?? { getItem: () => null }, now, consent: scope === 'local_records' && storage ? 'granted' : 'denied' })
    // elapsedMs times the engine call only, as the SHADOW log contract defines it (WEB_INTEGRATION_READY §10 S1).
    started = performance.now()
    const response = recommendCoachDecision(input, allowExperimentalModel ? { mode, allowExperimentalModel: true } : { mode })
    return { response, elapsedMs: performance.now() - started, failed: false }
  } catch {
    return { response: null, elapsedMs: performance.now() - started, failed: true }
  }
}

function itemHref(item: CoachRecommendation): { href: string | null; note?: string } {
  if (item.entry.kind === 'game') {
    const game = findWebGame(item.entry.id)
    return game ? { href: `${GAMES_PATH}?game=${game.id}` } : { href: null, note: '尚未接入游戏中心' }
  }
  if (item.entry.href) return { href: item.entry.href }
  if (item.entry.kind === 'routine' && item.entry.programId) return { href: `${ROUTINES_PATH}/${item.entry.programId}` }
  return { href: null }
}

function basisText(item: CoachRecommendation, origin: CoachDecisionResponse['decisionOrigin']): string {
  const data = item.basis === 'live_and_rules' ? '授权本机记录' : item.basis === 'synthetic_and_rules' ? '合成样例' : '自述画像'
  return origin === 'model' ? `${data} + 训练模型排序` : `${data} + 项目规则`
}

/** Signed contribution bars of the model's top features for one item. */
function ExplanationBars({ items }: { items: readonly CoachDecisionExplanation[] }) {
  const peak = Math.max(0.01, ...items.map((x) => Math.abs(x.points)))
  return (
    <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
      {items.map((x) => (
        <li key={x.feature} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) 1fr auto', gap: 8, alignItems: 'center', fontSize: 11 }}>
          <span>{x.label}<span className="tiny"> · {x.groupLabel}</span></span>
          <span className="fpw-explain-bar"><span style={{ left: x.points >= 0 ? '50%' : `${50 - (Math.abs(x.points) / peak) * 50}%`, width: `${(Math.abs(x.points) / peak) * 50}%`, background: x.points >= 0 ? 'var(--mint)' : 'var(--coral)' }} /></span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{x.points >= 0 ? '+' : ''}{x.points.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  )
}

function RecommendationItem({ item, rank, origin, showModel }: { item: CoachRecommendation; rank?: CoachDecisionRankedItem; origin: CoachDecisionResponse['decisionOrigin']; showModel: boolean }) {
  const target = itemHref(item)
  return (
    <article className="fpw-rec" data-testid={`coach-rec-${item.entry.id}`}>
      <div className="panel-title" style={{ marginBottom: 0 }}>
        <div><h3>{item.entry.title}</h3><p>{item.entry.movement}</p></div>
        {target.href ? <a className="btn btn-secondary plan-start" href={target.href} data-testid={`coach-go-${item.entry.id}`}>{item.entry.kind === 'game' ? '去游戏中心' : item.entry.kind === 'chapter' ? '开始跟练' : '查看功法'}</a> : <span className="tiny">{target.note ?? '从章节进入'}</span>}
      </div>
      {showModel && rank ? <p className="tiny" style={{ marginTop: 8 }} data-testid={`coach-suitability-${item.entry.id}`}>适配度 {Math.round(rank.suitability * 100)}% · 模型排名第 {rank.rank} 位</p> : null}
      <ul>{item.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
      {showModel && rank && rank.explanation.length ? (
        <details data-testid={`coach-explain-${item.entry.id}`}><summary>模型依据（特征贡献）</summary><ExplanationBars items={rank.explanation} /><p>{SUITABILITY_NOTE}</p></details>
      ) : null}
      <details><summary>依据与来源</summary><p>依据：{basisText(item, origin)}</p><p>知识来源：{item.entry.sources.join('、')}</p>{item.evidenceIds.length ? <p>记录：{item.evidenceIds.join('、')}</p> : null}</details>
    </article>
  )
}

function ShadowPanel({ response, elapsedMs }: { response: CoachDecisionResponse; elapsedMs: number }) {
  const card = useMemo(() => describeCoachDecisionModel(), [])
  const [cleared, setCleared] = useState(false)
  const exportLog = () => {
    try {
      const raw = window.localStorage.getItem(COACH_DECISION_SHADOW_LOG_KEY) ?? '[]'
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `coach-decision-shadow-log-${Date.now()}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch { /* nothing to export */ }
  }
  return (
    <section className="panel glass card fpw-dev-panel" style={{ marginTop: 15 }} aria-label="SHADOW 开发面板" data-testid="coach-shadow-panel">
      <div className="panel-title"><div><h3>SHADOW 开发面板</h3><p>仅开发 / 验收构建可见。用户看到的仍是规则推荐；模型排序不作为推荐展示。</p></div><StatusPill tone="coral">{EXPERIMENTAL_LABEL}</StatusPill></div>
      <p className="tiny" data-testid="coach-shadow-meta">mode {response.mode} · execution {response.execution} · fallback {response.fallbackReason ?? 'null'} · abstain {response.abstainReason ?? '—'} · confidence {response.confidence === null ? '—' : response.confidence.toFixed(2)} · {elapsedMs.toFixed(1)} ms · release {card.release} · bundle {String(card.bundleStatus)}</p>
      {response.outOfDistributionFeatures.length ? <p className="tiny">分布外特征：{response.outOfDistributionFeatures.join('、')}</p> : null}
      <div className="history-list" style={{ marginTop: 12 }}>
        {response.ranking.slice(0, 6).map((item) => (
          <details key={item.id} className="history-item" style={{ display: 'block' }}>
            <summary><strong>#{item.rank} {item.title}</strong> <span className="tiny">适配度 {Math.round(item.suitability * 100)}%{item.inSlate ? ' · 模型组合内' : ''}</span></summary>
            <ExplanationBars items={item.explanation} />
          </details>
        ))}
        {!response.ranking.length ? <p className="tiny">模型本次未运行或未产生排序（{response.execution}）。</p> : null}
      </div>
      <div className="report-actions"><button type="button" className="btn btn-secondary" onClick={exportLog}>导出 SHADOW 日志</button><button type="button" className="btn btn-secondary" onClick={() => { try { window.localStorage.removeItem(COACH_DECISION_SHADOW_LOG_KEY); setCleared(true) } catch { /* ignore */ } }}>{cleared ? '已清空' : '清空日志'}</button></div>
      <p className="tiny" style={{ marginTop: 8 }}>日志只含内容 ID、结果和耗时，不含画像答案，只保存在本机，不上传。</p>
    </section>
  )
}

/** Model identity and decision status, shown in the competition build (ACTIVE). */
function ModelPanel({ response, elapsedMs }: { response: CoachDecisionResponse; elapsedMs: number }) {
  const card = useMemo(() => describeCoachDecisionModel(), [])
  const model = response.model ?? card.model
  const usedModel = response.decisionOrigin === 'model'
  return (
    <section className="panel glass card" style={{ marginTop: 15 }} aria-label="决策模型" data-testid="coach-model-panel">
      <div className="panel-title"><div><h3>决策模型</h3><p>{usedModel ? '本次推荐由训练模型排序，规则只用于安全筛选和回退。' : (response.fallbackReason && FALLBACK_TEXT[response.fallbackReason]) ?? '本次展示规则推荐。'}</p></div><StatusPill tone={usedModel ? 'blue' : 'mint'} testId="coach-model-state">{usedModel ? '模型推荐' : '规则回退'}</StatusPill></div>
      <div className="fpw-setting-row">模型<span data-testid="coach-model-id">{model ? `${model.id} v${model.version} · 发布 ${model.release}` : '未加载'}</span></div>
      <div className="fpw-setting-row">模型身份<span>{model?.tierLabel ?? EXPERIMENTAL_LABEL}</span></div>
      <div className="fpw-setting-row">完整性<span>{String(card.bundleStatus) === 'ok' ? '权重、内容表与目录指纹校验通过' : `校验失败：${String(card.bundleStatus)}`}</span></div>
      <div className="fpw-setting-row">首选把握<span>{response.confidence === null ? '—' : `首选胜过第二名的校准概率 ${Math.round(response.confidence * 100)}%`}</span></div>
      <div className="fpw-setting-row">弃权<span data-testid="coach-model-abstain">{response.abstained ? `已弃权（${response.abstainReason === 'OUT_OF_DISTRIBUTION' ? '输入超出训练范围' : response.abstainReason === 'LOW_SUITABILITY' ? '合适候选不足' : '没有候选'}）` : '未弃权'}</span></div>
      <div className="fpw-setting-row">数据来源<span>画像（自述）· 训练历史 {response.dataSources.trainingHistory === 'live_local_records' ? '已授权本机记录' : '未读取'} · 最近报告 {response.dataSources.latestReport === 'live_local_records' ? '已授权' : '未读取'} · 游戏历史 未接入</span></div>
      <div className="fpw-setting-row">本次耗时<span>{elapsedMs.toFixed(1)} ms · 浏览器本地运行，不联网</span></div>
      <p className="tiny" style={{ marginTop: 10 }}>{SUITABILITY_NOTE} 模型与规则在冻结测试集上的差异置信区间跨 0，不能视为显著优于规则。</p>
    </section>
  )
}

/**
 * AI Coach (Web V1). Profile → risk confirmation → data consent → `recommendCoachDecision` (fp-coach-decision/v1).
 * Ordinary builds: OFF (rules). DEV/acceptance: SHADOW with a labelled panel. Competition build: ACTIVE with the
 * owner-approved experimental model, falling back to rules on abstention or any fault. The page never claims to observe
 * the user's posture. V1.2: free-text questions go to the local LLM agent (CoachAgentChat → loopback bridge → local
 * Qwen) only when the bridge reports the pinned model ready; otherwise the input stays disabled and says so.
 */
export function CoachPage({ mode, runtime: runtimeProp, storage = typeof window === 'undefined' ? null : window.localStorage, startInside = false }: { mode?: WebCoachDecisionMode; runtime?: CoachDecisionRuntime; storage?: Pick<Storage, 'getItem'> | null; startInside?: boolean }) {
  const [runtime] = useState<CoachDecisionRuntime>(() => runtimeProp ?? (mode ? { mode, allowExperimentalModel: false, source: 'default' } : resolveCoachDecisionRuntime()))
  const [intro, setIntro] = useState(() => !startInside && !(typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('view')))
  const [view, setView] = useState<CoachView>(() => {
    const requested = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('view')
    return requested === 'questions' || requested === 'result' || requested === 'plan' ? requested : 'profile'
  })
  /** Prefill only (never auto-sent): a question handed over from a report page. */
  const [askDraft] = useState(() => (typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('ask') ?? '').slice(0, 300)))
  /** Separate, explicit consent for the AI Coach chat to read warm-up and routine records (read-only). */
  const [agentRecordsConsent, setAgentRecordsConsent] = useState(false)
  const [draft, setDraft] = useState<CoachProfile>(INITIAL_PROFILE)
  const [scope, setScope] = useState<DataScope>('profile_only')
  const [consent, setConsent] = useState(false)
  const [run, setRun] = useState<CoachRun | null>(null)
  const [asked, setAsked] = useState<Array<{ question: CoachQuestion; at: number }>>([])
  const order = useRef(0)
  const nextOrder = () => { order.current += 1; return order.current }
  const agentChat = useCoachAgentChat((): AgentToolContext => ({
    storage, now: () => Date.now(),
    recordsConsent: agentRecordsConsent,
    recommend: () => run?.response ?? null,
    gamesAvailable: null,
  }), nextOrder)

  const response = run?.response ?? null
  const display = response?.display ?? null
  const result = display?.result ?? null
  const ready = response?.status === 'ready' && result !== null
  const firstChapter = ready ? result.chapters[0] : undefined
  const showModel = runtime.mode === 'active'
  const rankOf = (item: CoachRecommendation) => (showModel || runtime.mode === 'shadow') ? response?.ranking.find((x) => x.id === item.entry.id) : undefined

  const edit = (patch: Partial<CoachProfile>) => setDraft((value) => ({ ...value, ...patch }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const effectiveScope: DataScope = scope === 'local_records' && consent ? 'local_records' : 'profile_only'
    const next = runCoachDecision({ ...draft }, effectiveScope, runtime, storage)
    if (runtime.mode === 'shadow' && next.response) appendShadowLog(next.response, next.elapsedMs)
    setRun(next)
    setAsked([])
    setView('result')
  }
  const enter = (target: CoachView = 'profile') => { setIntro(false); setView(target); window.scrollTo?.({ top: 0 }) }

  if (intro) {
    return (
      <WebShell active="coach" bare testId="web-coach">
        <div className="signals-landing" data-testid="coach-intro">
          <div className="signals-wash" />
          <section className="signals-copy">
            <p className="signals-kicker">AI COACH · PERSONAL TRAINING</p>
            <h1><span>FormPilot</span><span>专属智能教练</span></h1>
            <p className="signals-intro">先告诉我你的目标、困难和关注部位，再决定是否授权读取本机训练记录。我会推荐功法章节和体感游戏，并说明依据。</p>
            <button className="signals-primary" type="button" onClick={() => enter('profile')} data-testid="coach-enter">开始画像 <b>→</b></button>
          </section>
          <CoachOrb variant="stage" testId="coach-orb-stage" />
          <aside className="signals-findings glass card" aria-label="可以问 AI Coach 的问题">
            <div className="signals-findings-head"><h2>固定五问</h2><small>完成画像后回答</small></div>
            <div className="signals-chat-list">
              {([['suitable', '根据你的目标、部位和风险，说明适合的功法章节与体感游戏。'], ['next_focus', '结合本次推荐和已授权的本机记录，说明下一阶段的练习重点。']] as const).map(([id, preview]) => (
                <button key={id} className="signals-chat-item" type="button" onClick={() => enter('profile')} aria-label={`开始话题：${COACH_FIXED_QUESTIONS.find(([q]) => q === id)?.[1]}`} data-testid={`coach-intro-topic-${id}`}>
                  <span className="signals-chat-subject"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8 9 9 0 0 1-3.5-.7L4 20l1.2-4.5a9 9 0 0 1-.7-3.5 8 8 0 0 1 8-8H13a8 8 0 0 1 7 7.5Z" /><path d="M8 10h8M8 14h5" /></svg><strong>{COACH_FIXED_QUESTIONS.find(([q]) => q === id)?.[1]}</strong><span aria-hidden="true">↗</span></span>
                  <span className="signals-chat-preview">{preview}</span>
                  <span className="signals-chat-meta">先完成画像 · 回答来自推荐结果</span>
                </button>
              ))}
            </div>
            <button className="signals-chat-all" type="button" onClick={() => enter('profile')}>进入 AI Coach <span aria-hidden="true">→</span></button>
          </aside>
        </div>
      </WebShell>
    )
  }

  const fallbackText = response && response.decisionOrigin === 'rules' && response.fallbackReason ? FALLBACK_TEXT[response.fallbackReason] : undefined
  const sourcePill = response
    ? response.decisionOrigin === 'model'
      ? <StatusPill tone="blue" testId="coach-origin">训练模型推荐</StatusPill>
      : <StatusPill tone="mint" testId="coach-origin">{showModel && fallbackText ? '规则推荐 · 模型已回退' : '规则推荐'}</StatusPill>
    : <StatusPill tone="mint">依据已标注 · 不替代专业诊断</StatusPill>
  const panelHead = (title: string, subtitle: string) => (
    <div className="chat-head"><div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}><CoachOrb variant="avatar" size="sm" animate={false} /><div><h3>{title}</h3><p className="tiny" style={{ marginTop: 5 }}>{subtitle}</p></div></div>{sourcePill}</div>
  )

  const profilePanel = (
    <section className="chat glass card" aria-label="用户画像" data-testid="coach-profile">
      {panelHead('先认识你', '画像只保存在当前页面内存，不上传')}
      <form onSubmit={submit} style={{ paddingTop: 20 }}>
        <fieldset className="fpw-fieldset"><legend>1 · 训练目标<small>可多选</small></legend><div className="fpw-chip-group">{GOALS.map(([value, label]) => <label key={value} className="check-chip"><input type="checkbox" checked={draft.goals.includes(value)} onChange={() => edit({ goals: toggle(draft.goals, value) })} />{label}</label>)}</div></fieldset>
        <fieldset className="fpw-fieldset"><legend>2 · 目前的困难<small>“暂无不适”不与其他项同选</small></legend><div className="fpw-chip-group">{DIFFICULTIES.map(([value, label]) => <label key={value} className="check-chip"><input type="checkbox" checked={draft.difficulties.includes(value)} onChange={() => edit({ difficulties: value === 'none' ? (draft.difficulties.includes('none') ? [] : ['none']) : toggle(draft.difficulties.filter((item) => item !== 'none'), value) })} />{label}</label>)}</div></fieldset>
        <fieldset className="fpw-fieldset"><legend>3 · 关注部位<small>可多选</small></legend><div className="fpw-chip-group">{REGIONS.map(([value, label]) => <label key={value} className="check-chip"><input type="checkbox" checked={draft.regions.includes(value)} onChange={() => edit({ regions: toggle(draft.regions, value) })} />{label}</label>)}</div></fieldset>
        <div className="form-grid" style={{ marginTop: 0 }}>
          <div className="field"><label htmlFor="coach-preference">偏好方式</label><select id="coach-preference" value={draft.preference} onChange={(event) => edit({ preference: event.target.value as CoachProfile['preference'] })}><option value="mixed">功法与游戏结合</option><option value="routine">功法优先</option><option value="game">游戏优先</option></select></div>
          <div className="field"><label htmlFor="coach-risk">4 · 当前风险情况</label><select id="coach-risk" value={draft.risk} onChange={(event) => edit({ risk: event.target.value as CoachProfile['risk'] })}>{RISKS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        </div>
        <div className="notice" style={{ marginTop: 16 }}>如有疼痛加重、眩晕、近期受伤或术后情况，请停止训练并咨询专业人员。康复辅助内容需要医生或治疗师确认；传统章节名称不代表医学疗效。</div>
        <label className="check-chip" style={{ marginTop: 12 }}><input type="checkbox" checked={draft.acknowledged} onChange={(event) => edit({ acknowledged: event.target.checked })} data-testid="coach-ack" />我已了解：这是运动建议，不是诊断或治疗方案。</label>
        <fieldset className="fpw-fieldset" style={{ marginTop: 20 }}><legend>5 · 数据读取授权</legend>
          <div className="fpw-chip-group">
            <label className="check-chip"><input type="radio" name="coach-scope" checked={scope === 'profile_only'} onChange={() => { setScope('profile_only'); setConsent(false) }} />仅按画像</label>
            <label className="check-chip"><input type="radio" name="coach-scope" checked={scope === 'local_records'} onChange={() => setScope('local_records')} data-testid="coach-scope-local" />使用本机功法记录（需授权）</label>
          </div>
          {scope === 'local_records' ? <label className="check-chip" style={{ marginTop: 10 }}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} data-testid="coach-consent" />允许读取此浏览器中的功法跟练记录与最近报告分项。只读、不上传、不修改；游戏历史未接入。</label> : null}
        </fieldset>
        <div className="wizard-actions"><span className="tiny">修改画像后请重新生成。</span><button className="btn btn-primary" type="submit" data-testid="coach-submit">{run ? '更新我的推荐' : '生成推荐'} →</button></div>
      </form>
    </section>
  )

  const resultPanel = (
    <section className="chat glass card" aria-label="推荐结果" data-testid="coach-result">
      {panelHead('你的下一次练习', response ? `数据：画像（自述）· 训练历史 ${response.dataSources.trainingHistory === 'live_local_records' ? '已授权读取本机记录' : '未读取'} · 报告 ${response.dataSources.latestReport === 'live_local_records' ? '已授权读取' : '未读取'} · 游戏历史未接入` : '')}
      <div className="chat-stream">
        {run?.failed || !response ? (
          <div className="fpw-alert" role="alert" data-testid="coach-error">推荐暂时无法生成，旧结果已清除。请检查画像后重试。<br /><button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => setView('profile')}>返回画像</button></div>
        ) : response.status === 'safety_hold' ? (
          <div className="fpw-alert" role="alert" data-testid="coach-safety-hold"><strong>暂停推荐</strong><br />{display?.result.message}<br />本次不展示任何功法、章节或游戏。请先停止训练，必要时咨询医生或康复治疗师。<br /><button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => setView('profile')}>修改画像</button></div>
        ) : response.status === 'profile_required' ? (
          <div className="notice" role="alert" data-testid="coach-profile-required">{display?.result.message}<br /><button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => setView('profile')}>完善画像</button></div>
        ) : response.status === 'error' ? (
          <div className="fpw-alert" role="alert" data-testid="coach-error">{response.error?.message ?? '请求无效'}</div>
        ) : response.status === 'empty' || !result ? (
          <WebEmpty title="当前筛选下没有可用内容" testId="coach-empty">{display?.result.message ?? '不会补造或强行替换推荐。'}</WebEmpty>
        ) : (
          <>
            <div className="bubble coach">{result.message}<span className="basis">依据：{response.decisionOrigin === 'rules' ? '自述画像 + 项目规则' : `训练模型 ${response.model?.id ?? ''} 排序 + 规则安全筛选`}{response.dataSources.trainingHistory === 'live_local_records' ? ' + 授权本机功法记录' : ''}</span></div>
            {fallbackText && (showModel || response.fallbackReason === 'MODEL_ABSTAINED') ? <div className="notice" data-testid={response.fallbackReason === 'MODEL_ABSTAINED' ? 'coach-abstained' : 'coach-fallback'}>{fallbackText}</div> : null}
            {[['从这一章开始', result.chapters], ['功法方向', result.routines], ['换一种方式练习', result.games]].map(([title, items]) => (items as CoachRecommendation[]).length ? (
              <div key={title as string}><h3 style={{ marginBottom: 9 }}>{title as string}</h3>{(items as CoachRecommendation[]).map((item) => <RecommendationItem key={item.entry.id} item={item} rank={rankOf(item)} origin={response.decisionOrigin} showModel={showModel && response.decisionOrigin === 'model'} />)}</div>
            ) : null)}
            <div className="tip-card card" data-testid="coach-next-step"><strong>下一步训练建议</strong><p>{firstChapter ? `先练「${firstChapter.entry.title}」，在舒适范围内完成。练完后回到这里重新生成，结合新的记录调整。` : '先从推荐的功法方向中选择一章开始。'}</p>{firstChapter && itemHref(firstChapter).href ? <a className="btn btn-dark" style={{ marginTop: 14 }} href={itemHref(firstChapter).href ?? undefined} data-testid="coach-start-first">开始这项训练</a> : null}<div className="tip-source">下一阶段关注：{result.focus.map((focus) => FOCUS_LABELS[focus]).join('、') || '—'}</div></div>
            <details className="tiny"><summary>说明与局限</summary><ul>{[...new Set([...response.limitations, ...result.limitations, `决策模型：${runtime.mode === 'active' ? 'ACTIVE（竞赛构建，已批准实验性模型）' : runtime.mode === 'shadow' ? 'SHADOW（开发验收，仅后台运行）' : '默认关闭'} · ${EXPERIMENTAL_LABEL}`])].map((line) => <li key={line}>{line}</li>)}</ul></details>
          </>
        )}
      </div>
    </section>
  )

  const fixedTimeline = display ? asked.map(({ question, at }, index) => ({ at, key: `${question}-${index}`, node: (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="bubble user">{COACH_FIXED_QUESTIONS.find(([id]) => id === question)?.[1]}</div>
      <div className="bubble coach" data-testid={`coach-answer-${question}`}>{display.answers[question]}<span className="basis">依据：{response?.decisionOrigin === 'model' ? '训练模型排序 + 规则安全筛选' : '自述画像 + 项目规则'}{response?.dataSources.trainingHistory === 'live_local_records' ? ' + 授权本机记录' : ''}</span>{question === 'suitable' && firstChapter && itemHref(firstChapter).href ? <><br /><a className="btn btn-primary" style={{ marginTop: 12 }} href={itemHref(firstChapter).href ?? undefined}>开始训练 →</a></> : null}</div>
    </div>
  ) })) : []
  const questionsPanel = (
    <section className="chat glass card" aria-label="训练问答" data-testid="coach-questions">
      {panelHead('训练问答', '固定五问来自本次推荐结果 · 自由提问由本机大模型调用只读工具回答')}
      <CoachAgentChat
        chat={agentChat}
        initialDraft={askDraft}
        recordsConsent={agentRecordsConsent}
        onRecordsConsent={setAgentRecordsConsent}
        intro={!display ? <div className="bubble coach">先完成画像并生成推荐，再选择下面的固定问题。<span className="basis">依据：尚未生成推荐</span></div> : asked.length === 0 ? <div className="bubble coach">选择下面任一固定问题，我会根据本次推荐回答。<span className="basis">依据：本次推荐结果</span></div> : null}
        timeline={fixedTimeline}
        prompts={<div className="chat-prompts" aria-label="固定五问">{COACH_FIXED_QUESTIONS.map(([id, label]) => <button key={id} type="button" className="prompt" disabled={!display} onClick={() => setAsked((items) => [...items, { question: id, at: nextOrder() }])} data-testid={`coach-ask-${id}`}>{label}</button>)}</div>}
      />
    </section>
  )

  const planItems = ready ? [...result.chapters, ...result.games].slice(0, 5) : []
  const planPanel = (
    <section className="chat glass card coach-plan-panel" aria-label="推荐计划" data-testid="coach-plan">
      {panelHead('推荐计划', '按本次推荐的顺序安排，每项都能直接开始')}
      {planItems.length ? (
        <div className="plan-list">{planItems.map((item, index) => { const target = itemHref(item); return (
          <article key={item.entry.id} className="plan-item"><div className="plan-day">第 {index + 1} 项<span>{index === 0 ? '推荐' : item.entry.kind === 'game' ? '游戏' : '章节'}</span></div><div className="plan-copy"><strong>{item.entry.title}</strong><p>{item.entry.movement}</p></div>{target.href ? <a className="btn btn-secondary plan-start" href={target.href}>开始</a> : <span className="tiny">{target.note ?? '—'}</span>}</article>
        ) })}</div>
      ) : <WebEmpty title="还没有计划" testId="coach-plan-empty">生成推荐后，这里会按顺序列出可以直接开始的章节和游戏。</WebEmpty>}
      <div className="plan-note">计划不会自动记录完成情况。完成训练后，可在“我的”查看真实记录，再回到这里重新生成。</div>
    </section>
  )

  const panels: Record<CoachView, ReactElement> = { profile: profilePanel, result: resultPanel, questions: questionsPanel, plan: planPanel }
  const links: ReadonlyArray<[CoachView, string]> = [['profile', '用户画像'], ['result', '推荐与依据'], ['questions', '训练问答'], ['plan', '推荐计划']]

  return (
    <WebShell active="coach" testId="web-coach">
      <div className="page-head"><div><div className="eyebrow">PERSONAL COACH</div><h1 style={{ marginTop: 10 }}>AI Coach</h1><p>解释你的训练，给出下一步，并把建议变成可执行任务。</p></div><span className="status-pill mint">依据已标注 · 不替代专业诊断</span></div>
      <div className="coach-layout">
        <aside className="coach-side glass card">
          <div className="coach-profile"><CoachOrb variant="avatar" testId="coach-orb-avatar" /><div><h3>FormPilot Coach</h3><span className="tiny">陪你把动作练清楚</span></div></div>
          <div className="coach-links">
            {links.map(([id, label]) => <button key={id} type="button" className={`coach-link${view === id ? ' active' : ''}`} onClick={() => setView(id)} data-testid={`coach-link-${id}`}>{label}</button>)}
            <a className="coach-link" href={HISTORY_PATH}>最近报告</a>
          </div>
          <div className="section-head" style={{ marginTop: 28 }}><div><h3>今日建议</h3><p>{firstChapter ? '1 项可执行任务' : '完成画像后生成'}</p></div></div>
          <div className="tip-card card" style={{ padding: 18 }}>
            <div className="tip-mark coach-tip-icon" aria-hidden="true" style={{ width: 32, height: 32, marginBottom: 13 }}><svg viewBox="0 0 24 24"><path d="M12 3.5v3m0 11v3M3.5 12h3m11 0h3" /><circle cx="12" cy="12" r="5.2" /><path d="m13.8 10.2-1.2 3-3 1.2 1.2-3z" /></svg></div>
            <strong style={{ fontSize: 13 }}>{firstChapter ? firstChapter.entry.title : '先完成你的画像'}</strong>
            <p style={{ fontSize: 11, marginTop: 6 }}>{firstChapter ? firstChapter.reasons[0] ?? firstChapter.entry.movement : '目标、困难、部位和风险确认后，AI Coach 才会给出建议。'}</p>
            {firstChapter && itemHref(firstChapter).href ? <a className="btn btn-dark" style={{ marginTop: 15, width: '100%' }} href={itemHref(firstChapter).href ?? undefined}>开始这项训练</a> : <button type="button" className="btn btn-dark" style={{ marginTop: 15, width: '100%' }} onClick={() => setView('profile')}>填写画像</button>}
          </div>
        </aside>
        <div style={{ minWidth: 0 }}>
          {panels[view]}
          {showModel && response && view === 'result' && response.status !== 'error' ? <ModelPanel response={response} elapsedMs={run?.elapsedMs ?? 0} /> : null}
          {runtime.mode === 'shadow' && response ? <ShadowPanel response={response} elapsedMs={run?.elapsedMs ?? 0} /> : null}
        </div>
      </div>
    </WebShell>
  )
}
