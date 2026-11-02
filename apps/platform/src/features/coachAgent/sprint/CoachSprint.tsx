import { useState, type FormEvent } from 'react'
import { Activity, ArrowRight, BookOpen, Database, Gamepad2, ShieldCheck } from 'lucide-react'
import { recommendCoach, answerCoachQuestion, FOCUS_LABELS } from '../recommendation/engine'
import { readRecommendationContext } from '../recommendation/context'
import { createRecommendationDemo } from '../recommendation/fixtures'
import { COACH_KNOWLEDGE } from '../recommendation/catalogue'
import type { CoachProfile, CoachQuestion, CoachRecommendation, RecommendationContext } from '../recommendation/types'

const EMPTY_CONTEXT = (): RecommendationContext => ({ evidence: [], limitations: ['尚未授权读取训练历史；游戏历史与 StartLux 尚未接入。'], decisionStatus: 'not_connected' })
const INITIAL_PROFILE: CoachProfile = { version: 1, goals: [], difficulties: [], regions: [], preference: 'mixed', risk: 'none', acknowledged: false }
const GOALS = [['mobility', '肩颈活动练习'], ['upper_limb', '上肢动作练习'], ['daily', '日常锻炼'], ['rehab_support', '康复辅助']] as const
const DIFFICULTIES = [['stiffness', '肩部僵硬'], ['reach_difficulty', '抬手困难'], ['soreness', '酸痛'], ['sedentary', '久坐肩颈不适'], ['none', '暂无不适']] as const
const REGIONS = [['shoulders', '肩部'], ['neck', '颈部'], ['arms', '上肢'], ['trunk', '躯干'], ['legs', '下肢']] as const
const QUESTIONS: Array<[CoachQuestion, string]> = [['suitable', '我适合练什么？'], ['first_game', '先玩哪个游戏？'], ['recent_issues', '最近主要问题是什么？'], ['why', '为什么这样推荐？'], ['next_focus', '下一阶段练什么？']]

function toggle<T>(items: T[], item: T): T[] { return items.includes(item) ? items.filter(value => value !== item) : [...items, item] }

function RecommendationRow({ item }: { item: CoachRecommendation }) {
  return <article className="cs-recommendation">
    <div className="cs-rec-heading"><h3>{item.entry.title}</h3><span className="cs-tag">{item.basis === 'live_and_rules' ? '授权记录 + 规则建议' : item.basis === 'synthetic_and_rules' ? '合成样例 + 规则建议' : '画像 + 规则建议'}</span></div>
    <p>{item.entry.movement}</p>
    <ul className="cs-reasons">{item.reasons.slice(0, 2).map((reason, index) => <li key={index}>{reason}</li>)}</ul>{item.reasons.length > 2 && <details><summary>查看关联记录与章节说明</summary><ul>{item.reasons.slice(2).map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>}
    {item.entry.href && <a className="cs-text-link" href={item.entry.href}>查看此章节 <ArrowRight size={14} aria-hidden="true" /></a>}
    {item.entry.kind === 'game' && <p className="cs-muted">玩法目录建议 · 请在对应游戏应用中选择，不会自动启动。</p>}
    <details><summary>查看知识来源与边界</summary><p>项目动作描述已核对；画像适配为工程建议，医学疗效与个人适用性待核验。</p><ul>{item.entry.sources.map(source => <li key={source}><code>{source}</code></li>)}</ul>{item.evidenceIds.length > 0 && <p>记录依据：{item.evidenceIds.join('、')}</p>}</details>
  </article>
}

/** Standalone, memory-only competition surface. History is read only after explicit consent. */
export function CoachSprint() {
  const [draft, setDraft] = useState<CoachProfile>(INITIAL_PROFILE)
  const [profile, setProfile] = useState<CoachProfile | null>(null)
  const [context, setContext] = useState<RecommendationContext>(EMPTY_CONTEXT)
  const [source, setSource] = useState<'none' | 'demo' | 'local'>('none')
  const [consent, setConsent] = useState(false)
  const [question, setQuestion] = useState<CoachQuestion>('suitable')
  const [attempted, setAttempted] = useState(false)
  const [readStatus, setReadStatus] = useState('')
  const result = profile ? recommendCoach(profile, context) : null
  const preview = attempted && !profile ? recommendCoach(draft, context) : null

  function edit(patch: Partial<CoachProfile>) { setDraft(value => ({ ...value, ...patch })); setProfile(null); setAttempted(false) }
  function submit(event: FormEvent) { event.preventDefault(); setAttempted(true); setProfile({ ...draft }) }
  function selectSource(value: 'none' | 'demo' | 'local') { setSource(value); setConsent(false); setContext(EMPTY_CONTEXT()); setReadStatus('') }
  function readLocal() {
    if (!consent || source !== 'local') return
    try { setContext(readRecommendationContext(window.localStorage, Date.now())); setReadStatus('读取结束：仅展示通过校验的记录；没有有效记录时保留证据不足。') }
    catch { setContext(EMPTY_CONTEXT()); setReadStatus('无法访问本机存储。可继续按画像推荐，或使用合成样例。') }
  }
  const categories = result ? [
    { id: 'routine', title: '功法方向', subtitle: '先确定方向，再选具体章节。', items: result.routines, icon: BookOpen },
    { id: 'chapter', title: '从这一章开始', subtitle: '按章节练习，保留舒适范围。', items: result.chapters, icon: Activity },
    { id: 'game', title: '换一种方式练习', subtitle: '用玩法配合训练兴趣。', items: result.games, icon: Gamepad2 },
  ].sort((a, b) => profile?.preference === 'game' ? Number(b.id === 'game') - Number(a.id === 'game') : 0) : []

  return <div className="cs-page">
    <header className="cs-header"><a className="cs-brand" href="/" aria-label="FormPilot 首页"><Activity aria-hidden="true" size={22} />FormPilot <span>AI Coach</span></a><span className="cs-header-note">传智杯 · 独立推荐展示</span></header>
    <main className="cs-main">
      <div className="cs-intro"><div><p className="cs-kicker">为下一次练习，找到方向</p><h1>从了解你开始。</h1><p>结合你的目标和可核验记录，选择功法、具体章节与体感游戏。每条建议都说明原因。</p></div><div className="cs-boundary"><ShieldCheck size={20} aria-hidden="true" /><p>运动练习建议<br /><strong>不做诊断，不替代医生</strong></p></div></div>
      <div className="cs-layout">
        <aside className="cs-sidebar" aria-label="用户画像与数据授权">
          <form onSubmit={submit}>
            <div className="cs-section-title"><h2>先认识你</h2><span>仅保留在当前页面内存</span></div>
            <fieldset><legend>你希望重点练习什么？<small>可多选</small></legend>{GOALS.map(([value, label]) => <label className="cs-check" key={value}><input type="checkbox" checked={draft.goals.includes(value)} onChange={() => edit({ goals: toggle(draft.goals, value) })} />{label}</label>)}</fieldset>
            <fieldset><legend>目前有哪些不适或困难？</legend>{DIFFICULTIES.map(([value, label]) => <label className="cs-check" key={value}><input type="checkbox" checked={draft.difficulties.includes(value)} onChange={() => edit({ difficulties: value === 'none' ? (draft.difficulties.includes('none') ? [] : ['none']) : toggle(draft.difficulties.filter(item => item !== 'none'), value) })} />{label}</label>)}</fieldset>
            <fieldset><legend>关注部位<small>可多选</small></legend><div className="cs-inline-checks">{REGIONS.map(([value, label]) => <label className="cs-check" key={value}><input type="checkbox" checked={draft.regions.includes(value)} onChange={() => edit({ regions: toggle(draft.regions, value) })} />{label}</label>)}</div></fieldset>
            <label className="cs-field" htmlFor="cs-preference">你更喜欢哪种方式？<select aria-label="你更喜欢哪种方式？" id="cs-preference" value={draft.preference} onChange={event => edit({ preference: event.target.value as CoachProfile['preference'] })}><option value="mixed">功法与游戏结合</option><option value="routine">功法优先</option><option value="game">游戏优先</option></select></label>
            <label className="cs-field" htmlFor="cs-risk">当前风险情况<select aria-label="当前风险情况" id="cs-risk" value={draft.risk} onChange={event => edit({ risk: event.target.value as CoachProfile['risk'] })}><option value="none">未报告以下风险</option><option value="acute_pain">当前有急性或明显疼痛</option><option value="dizziness">当前眩晕或站立不稳</option><option value="recent_injury">近期受伤或术后</option></select></label>
            <details className="cs-safety"><summary>阅读风险与适用范围</summary><p>如有疼痛加重、眩晕、近期受伤或术后情况，请停止本次推荐并咨询专业人员。康复辅助内容需要医生或治疗师确认。传统章节名称不代表医学疗效；不要强行达到过顶、下蹲或转身幅度。</p></details>
            <label className="cs-check cs-ack"><input type="checkbox" checked={draft.acknowledged} onChange={event => edit({ acknowledged: event.target.checked })} />我已了解：这是运动建议，不是诊断或治疗方案。</label>
            {(result?.status === 'profile_required' || preview?.status === 'profile_required') && <p className="cs-error" role="alert">{result?.message ?? preview?.message}</p>}
            <button className="cs-primary" type="submit">{profile ? '更新我的推荐' : '生成我的推荐'}<ArrowRight size={16} aria-hidden="true" /></button>
            <p className="cs-muted cs-form-note">修改画像后，请重新生成推荐。</p>
          </form>
          <section className="cs-data" aria-labelledby="cs-data-title"><h2 id="cs-data-title"><Database size={16} aria-hidden="true" />推荐的数据依据</h2>
            <label className="cs-field" htmlFor="cs-source">数据范围<select aria-label="数据范围" id="cs-source" value={source} onChange={event => selectSource(event.target.value as typeof source)}><option value="none">仅按画像与规则</option><option value="local">本机训练记录（需授权）</option><option value="demo">合成样例（比赛演示）</option></select></label>
            {source === 'local' && <><label className="cs-check"><input type="checkbox" checked={consent} onChange={event => { setConsent(event.target.checked); setContext(EMPTY_CONTEXT()); setReadStatus('') }} />允许读取此浏览器最近的热身与功法记录，各最多 8 条。</label><button className="cs-secondary" disabled={!consent} type="button" onClick={readLocal}>读取授权记录</button><p className="cs-muted">不会上传、修改训练记录；撤销勾选会清除读取结果。</p></>}
            {source === 'demo' && <><p className="cs-muted">人为构造的训练、游戏、报告与决策输出，只展示推荐流程，不代表真人或真实模型结果。</p><button className="cs-secondary" type="button" onClick={() => { setContext(createRecommendationDemo()); setReadStatus('已加载合成样例，所有记录均应标注“合成样例”。') }}>加载合成样例</button></>}
            <p className="cs-read-status" role="status">{readStatus}</p><p className="cs-muted">游戏历史：未接入。StartLux：{context.decisionStatus === 'synthetic' ? '合成输出样例' : context.decisionStatus === 'startlux' ? '经本地守卫的输出' : '未接入'}。本页不会运行模型。</p>
          </section>
        </aside>
        <div className="cs-workspace">
          <section className="cs-answer" aria-labelledby="cs-answer-title"><div className="cs-section-title"><h2 id="cs-answer-title">你的下一次练习</h2><span>{source === 'demo' ? '合成演示' : '本地规则推荐'}</span></div>
            <div className="cs-questions" role="group" aria-label="向 AI Coach 提问">{QUESTIONS.map(([id, label]) => <button type="button" key={id} aria-pressed={question === id} onClick={() => setQuestion(id)}>{label}</button>)}</div>
            <div className="cs-response" aria-live="polite" data-testid="coach-sprint-answer">{result ? <><span className="cs-response-label">{result.status === 'ready' ? 'AI Coach 建议' : result.status === 'safety_hold' ? '暂停推荐' : '还需要了解你'}</span><p>{answerCoachQuestion(question, result)}</p></> : <><span className="cs-response-label">从你的目标出发</span><h3>完成左侧画像，开始选择。</h3><p>不需要先有训练记录。你可以先获得画像建议，再决定是否授权读取历史。</p></>}</div>
            {result?.status === 'ready' && <div className="cs-focus"><strong>下一阶段关注</strong>{result.focus.map(focus => <span className="cs-tag" key={focus}>{FOCUS_LABELS[focus]}</span>)}<p>这是练习方向建议，效果与个人适用性待核验。</p></div>}
          </section>
          {result?.status === 'ready' && <div data-testid="coach-sprint-recommendations">{categories.map(category => <section className="cs-category" key={category.id} aria-labelledby={`cs-${category.id}-title`}><div className="cs-category-title"><category.icon size={20} aria-hidden="true" /><div><h2 id={`cs-${category.id}-title`}>{category.title}</h2><p>{category.subtitle}</p></div><span>{category.items.length} 项建议</span></div>{category.items.map(item => <RecommendationRow item={item} key={item.entry.id} />)}{!category.items.length && <p className="cs-muted">当前没有满足边界的内容。请核对画像或咨询专业人员。</p>}</section>)}</div>}
          <section className="cs-evidence" aria-labelledby="cs-evidence-title"><div className="cs-section-title"><h2 id="cs-evidence-title">依据与证据边界</h2><span>{context.evidence.length} 条可见依据</span></div><p className="cs-muted">画像是你的自述；目录映射与排序是规则建议；历史数据仅陈述已记录事实。合成样例和模型建议均不能证明训练改善。</p>
            {context.evidence.length ? <ol>{context.evidence.map(evidence => <li key={evidence.id}><span className="cs-tag">{evidence.source === 'synthetic' ? '合成样例' : evidence.category === 'decision' ? '决策建议' : '授权本机记录'}</span><strong>{evidence.title}</strong><time className="cs-evidence-time" dateTime={new Date(evidence.occurredAt).toISOString()}>{new Date(evidence.occurredAt).toLocaleString('zh-CN', { hour12: false })}</time><p>{evidence.detail}</p><details><summary>追溯记录</summary><code>{evidence.id}</code><ul>{evidence.references.map(ref => <li key={ref}><code>{ref}</code></li>)}</ul></details></li>)}</ol> : <p className="cs-empty-evidence">尚无历史证据，不能判断你最近的训练问题或进步。可在左侧授权读取，或选择合成样例体验流程。</p>}
            <details open><summary>尚未验证与缺失的数据</summary><ul>{[...new Set([...(result?.limitations ?? []), ...context.limitations, '未进行医学疗效验证；用户适配仍需真人验收。'])].map(limitation => <li key={limitation}>{limitation}</li>)}</ul></details>
          </section>
          <details className="cs-knowledge"><summary>推荐知识目录 · {COACH_KNOWLEDGE.filter(item => item.kind === 'routine').length} 种功法 / {COACH_KNOWLEDGE.filter(item => item.kind === 'chapter').length} 章 / {COACH_KNOWLEDGE.filter(item => item.kind === 'game').length} 款游戏</summary><p>动作描述以项目目录和分析器为依据。传统功法名称沿用原文，不用于推导医学功效。</p><div className="cs-table-wrap"><table><caption>结构化内容与动作练习方向</caption><thead><tr><th scope="col">内容</th><th scope="col">动作模式</th><th scope="col">练习方向</th></tr></thead><tbody>{COACH_KNOWLEDGE.map(entry => <tr key={entry.id}><th scope="row">{entry.title}</th><td>{entry.movement}</td><td>{entry.focuses.map(focus => FOCUS_LABELS[focus]).join('、')}<small>个人适配 / 疗效待核验</small></td></tr>)}</tbody></table></div></details>
        </div>
      </div>
      <footer className="cs-footer">FormPilot · AI Coach Agent 展示版本 <span>画像与输出仅存当前页面 · 无付费 API · 不自动控制训练</span></footer>
    </main>
  </div>
}
