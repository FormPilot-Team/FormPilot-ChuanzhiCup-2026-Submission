import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { Activity, BookOpen, Check, Database, FlaskConical, History, Info, LockKeyhole, MessageSquareText, Send, ShieldCheck, Square, Trash2, Unplug } from 'lucide-react'
import type { CoachCitation } from '../answer'
import type { CoachLabController, LabSession, LabStatus } from './types'

const STATUS: Record<LabStatus, string> = {
  idle: '等待提问', ready: '准备就绪', running: '正在处理', answered: '已回答',
  insufficient: '证据不足', failed: '未完成', cancelled: '已取消', timeout: '已超时',
}
const PLANNING = { mock: 'Mock 规则演示', completed: '本地规划已完成并校验', not_completed: '本地规划未完成' }
const PROMPTS = [
  { label: '深蹲评分为什么不高？', question: '为什么我这次深蹲评分不高？', kind: 'warmup' },
  { label: '最近深蹲有进步吗？', question: '我最近几次深蹲有没有进步？', kind: 'warmup' },
  { label: '八段锦跟练表现如何？', question: '我最近的八段锦跟练表现如何？', kind: 'routine' },
] as const

function sessionName(session: LabSession) {
  if (session.source === 'synthetic') {
    if (session.kind === 'routine') return '八段锦 · 合成跟练记录'
    return session.id.includes('before') ? '深蹲 · 较早的合成记录' : '深蹲 · 当前合成记录'
  }
  return `${session.kind === 'warmup' ? '热身训练' : '功法训练'} · ${new Date(session.startedAt).toLocaleString('zh-CN', { hour12: false })}`
}

function Citation({ citation }: { citation: CoachCitation }) {
  const score = citation.score
  const label = citation.subject.kind === 'exercise' && citation.subject.id === 'squat' ? '深蹲' : citation.subject.kind === 'routine' && citation.subject.id === 'baduanjin' ? '八段锦' : citation.subject.id
  return <article className="lab-citation">
    <div className="lab-citation-top">
      <div><div className="lab-citation-kind">{score.scoreKind}</div><h4 className="lab-citation-name">{label} <span className="lab-source-label">{citation.provenance.source}</span></h4></div>
      <div className="lab-citation-score">{score.status === 'available' ? Number(score.value.toFixed(2)) : '无有效分数'}<small>{score.scale === '0-100' ? '/ 100' : score.scale === '0-1' ? '/ 1 相似度' : '仅指导'}</small></div>
    </div>
    <dl>
      <dt>Session</dt><dd className="lab-mono">{citation.sessionId}</dd>
      <dt>evidenceId</dt><dd className="lab-mono">{citation.evidenceId}</dd>
      <dt>评分版本</dt><dd className="lab-mono">{score.scoringVersion ?? '无评分版本'}{score.rulesVersion ? ` · ${score.rulesVersion.spec} / ${score.rulesVersion.threshold}` : ''}</dd>
      <dt>有效样本</dt><dd>{citation.sampleCount} 个 · 可观测性 {citation.observability}</dd>
      <dt>记录来源</dt><dd>{citation.provenance.source} / {citation.provenance.mode} / {citation.provenance.producer}</dd>
      <dt>原记录位置</dt><dd className="lab-mono">{citation.recordPaths.join(' · ') || '无可用路径'}</dd>
    </dl>
  </article>
}

/** Independent development surface. This component has no persistence capability. */
export function CoachAgentLab({ controller }: { controller: CoachLabController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const tokenInput = useRef<HTMLInputElement>(null)
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:4320/v1/coach/local/step')
  const running = state.status === 'running'
  const selectedSession = state.sessions.find(session => session.id === state.currentSessionId)
  const result = state.result
  const connectionStatus = result?.providerKind === 'local'
    ? result.modelPlanning === 'completed'
      ? '本地规划已完成并通过校验。评分与历史比较继续使用本机原始记录。'
      : '本地模型不可用或规划未完成。请检查本机服务，也可切回 Mock 演示。'
    : state.localConfigured
      ? '连接待验证。发送问题时才握手并尝试规划；配置成功不代表模型已安装或推理成功。'
      : '本地模型不可用（尚未连接）。请先准备获准的本地模型服务，或返回 Mock。'

  useEffect(() => {
    const leave = () => {
      if (tokenInput.current) tokenInput.current.value = ''
      controller.clear()
    }
    window.addEventListener('pagehide', leave)
    return () => { window.removeEventListener('pagehide', leave); controller.dispose() }
  }, [controller])

  useEffect(() => {
    if (tokenInput.current) tokenInput.current.value = ''
  }, [state.mode, state.kind, state.dataSource, state.currentSessionId, state.allowedSessionIds, state.disclosureConsent, state.inferenceConsent])

  const configureLocal = (event: FormEvent) => {
    event.preventDefault()
    const token = tokenInput.current?.value ?? ''
    try { controller.configureLocal({ endpoint, bootstrapToken: token }) }
    finally { if (tokenInput.current) tokenInput.current.value = '' }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void controller.run() }

  return <div className="lab-page">
    <header className="lab-header">
      <div className="lab-brand"><span className="lab-mark"><Activity size={19} strokeWidth={2.2} aria-hidden="true" /></span>FormPilot<span className="lab-brand-divider" /><span className="lab-brand-sub">Coach Lab</span><span className="lab-development">DEVELOPMENT LAB</span></div>
      <div className="lab-header-status"><span />独立实验台 · 正式训练保持独立</div>
    </header>
    <main className="lab-wrap">
      <div className="lab-title-row">
        <div><h1>训练问答实验台</h1><p>选取记录，提出问题，查看每个回答背后的评分证据。</p></div>
        <span className="lab-readonly"><ShieldCheck size={14} aria-hidden="true" />只读访问</span>
      </div>
      <div className="lab-layout">
        <aside className="lab-sidebar" aria-label="数据与授权设置">
          <div className="lab-section-heading"><Database size={16} aria-hidden="true" /><h2>数据与读取范围</h2></div>
          <div className="lab-data-selectors">
            <div className="lab-field"><label htmlFor="lab-source">数据来源</label><select id="lab-source" className="lab-select" value={state.dataSource} onChange={event => controller.setDataSource(event.target.value as 'synthetic' | 'local')}><option value="synthetic">synthetic · 内存演示</option><option value="local">本机已有训练记录</option></select></div>
            <div className="lab-field"><label htmlFor="lab-kind">训练类型</label><select id="lab-kind" className="lab-select" value={state.kind} onChange={event => controller.setKind(event.target.value as 'warmup' | 'routine')}><option value="warmup">热身训练 · 深蹲</option><option value="routine">功法训练 · 八段锦</option></select></div>
          </div>
          {state.dataSource === 'synthetic' ? <div className="lab-source-note"><Info size={13} aria-hidden="true" /><p>合成记录只存在内存中，用于验证问答流程，不代表真人训练效果。</p></div> : <>
            <label className="lab-check"><input type="checkbox" checked={state.localConsent} onChange={event => controller.setLocalConsent(event.target.checked)} /><span>允许读取本机记录<small>先读取所选训练类型的记录目录，再由你指定可读取的 Session。</small></span></label>
            <button className="lab-button lab-sidebar-button" disabled={!state.localConsent} onClick={() => controller.loadLocalSessions()}><Database size={13} aria-hidden="true" />加载本机记录</button>
            <p className="lab-help">只读取当前浏览器的训练存储。不会上传、修复或写入记录。</p>
          </>}
          <hr className="lab-divider" />
          <div className="lab-field"><label htmlFor="lab-session">当前 Session</label><select id="lab-session" className="lab-select" value={state.currentSessionId ?? ''} disabled={!state.sessions.length} onChange={event => controller.selectCurrentSession(event.target.value || null)}><option value="">请选择记录</option>{state.sessions.map(session => <option value={session.id} key={session.id}>{sessionName(session)}</option>)}</select></div>
          {selectedSession && <p className="lab-help lab-mono">{selectedSession.id}<br />{selectedSession.source} · {selectedSession.evidenceCount} 条证据</p>}
          {!!state.sessions.length && <fieldset className="lab-session-list"><legend>允许读取的 Session</legend>{state.sessions.map(session => <label className="lab-check lab-session-item" key={session.id}><input type="checkbox" aria-label={`允许读取 ${session.id}`} checked={state.allowedSessionIds.includes(session.id)} onChange={event => controller.setAllowedSessions(event.target.checked ? [...state.allowedSessionIds, session.id] : state.allowedSessionIds.filter(id => id !== session.id))} /><span><span className="lab-session-name">{sessionName(session)}</span><span className="lab-session-meta"><span className="lab-source-label">{session.source}</span><span>{session.evidenceCount} 条证据</span></span></span></label>)}</fieldset>}
          {!state.sessions.length && <p className="lab-sidebar-empty">{state.dataSource === 'local' && !state.localConsent ? '尚未授权读取。当前不会访问本机训练历史。' : state.dataSource === 'local' && !state.localLoaded ? '授权后点击“加载本机记录”，选择你允许读取的 Session。' : '没有可选训练记录。请先在正式训练中产生记录，或切回内存演示。'}</p>}
          <p className="lab-help">仅勾选的记录可被工具读取。历史比较还需要通过原有版本与来源门禁；未授权完整比较范围时会拒绝比较。</p>
          <div className="lab-sidebar-foot"><LockKeyhole size={13} aria-hidden="true" /><p>切换记录或撤销授权，会取消当前任务并清除临时答复。</p></div>
        </aside>

        <section className="lab-workspace" aria-label="问答工作区">
          <div className="lab-toolbar">
            <div className="lab-mode-tabs" role="group" aria-label="Agent 模式"><button className="lab-mode-tab" aria-pressed={state.mode === 'mock'} onClick={() => controller.setMode('mock')}>Mock 规则演示</button><button className="lab-mode-tab" aria-pressed={state.mode === 'local'} onClick={() => controller.setMode('local')}>本地模型（零 API 费用）</button></div>
            <span className="lab-mode-note">{state.mode === 'mock' ? <><Unplug size={12} aria-hidden="true" />不调用模型</> : <><ShieldCheck size={12} aria-hidden="true" />本机推理 · 默认关闭</>}</span>
          </div>
          <div className="lab-body">
            {state.mode === 'local' && <details className="lab-local-connection" open={!state.localConfigured}>
              <summary>配置本地模型连接</summary>
              <div className="lab-local-connection-content">
                <p className="lab-local-connection-warning">仅连接本机已安装的开源权重模型。此处只接收本地规划服务生成的一次性令牌。需先检查硬件与模型许可；配置连接不会安装或下载模型。</p>
                <div className="lab-disclosure"><strong>即将发送的最小范围</strong><ul><li>问题分类、剩余调用次数、临时匿名 Session / 证据编号。</li><li>工具成功状态、固定错误码、评分种类、动作类别与比较 gate。</li></ul><p>不发送原问题、原始 Session ID、分数、姓名、视频、关键点或完整记录。最终事实仍在本机生成。</p></div>
                <label className="lab-check"><input type="checkbox" checked={state.disclosureConsent} onChange={event => controller.setDisclosureConsent(event.target.checked)} /><span>同意发送最小规划字段<small>只同意上述固定范围，随时可撤销。</small></span></label>
                <label className="lab-check"><input type="checkbox" checked={state.inferenceConsent} onChange={event => controller.setInferenceConsent(event.target.checked)} /><span>确认硬件、模型许可与资源占用并启用本地推理<small>已确认本机模型合法可用，允许占用 CPU / GPU / 内存与电量。零 API 费用；失败不自动重试。</small></span></label>
                <form onSubmit={configureLocal} autoComplete="off">
                  <div className="lab-local-connection-fields">
                    <div className="lab-field"><label htmlFor="lab-endpoint">本地规划服务地址</label><input id="lab-endpoint" className="lab-text-input lab-mono" value={endpoint} onChange={event => { setEndpoint(event.target.value); if (state.localConfigured) controller.setDisclosureConsent(false) }} spellCheck={false} autoComplete="off" /></div>
                    <div className="lab-field"><label htmlFor="lab-bootstrap">本机一次性 bootstrap token</label><input ref={tokenInput} id="lab-bootstrap" type="password" className="lab-text-input" autoComplete="off" spellCheck={false} autoCapitalize="none" disabled={state.localConfigured || !state.disclosureConsent || !state.inferenceConsent} placeholder="只在当前内存中使用，提交后清空" /></div>
                  </div>
                  <button className="lab-button" disabled={!state.disclosureConsent || !state.inferenceConsent || state.localConfigured || running} type="submit"><LockKeyhole size={13} aria-hidden="true" />建立本机会话</button>
                </form>
                <div className="lab-local-connection-status" role="status"><Info size={13} aria-hidden="true" /><p>{connectionStatus}</p></div>
              </div>
            </details>}

            <form onSubmit={submit}>
              <div className="lab-composer-heading"><h2>向训练记录提问</h2><span className="lab-scope-label">目前支持 3 类中文问题</span></div>
              <div className="lab-prompts">{PROMPTS.map(prompt => <button className="lab-prompt" type="button" key={prompt.kind + prompt.label} onClick={() => { controller.setKind(prompt.kind); controller.setQuestion(prompt.question) }}>{prompt.label}</button>)}</div>
              <label className="lab-question-label" htmlFor="lab-question">训练问题</label><textarea id="lab-question" className="lab-question" value={state.question} maxLength={4096} placeholder="例如：为什么我这次深蹲评分不高？" onChange={event => controller.setQuestion(event.target.value)} />
              <div className="lab-composer-footer"><p className="lab-composer-help">仅支持深蹲评分、深蹲历史与八段锦跟练。<br />不提供开放式聊天或医学判断。</p><div className="lab-actions"><button type="button" className="lab-button lab-button-quiet" onClick={() => controller.clear()}><Trash2 size={13} aria-hidden="true" />清空实验台</button><button type="button" className="lab-button" disabled={!running} onClick={() => controller.cancel()}><Square size={11} aria-hidden="true" />取消任务</button><button className="lab-button lab-button-primary" type="submit" disabled={running || !state.question.trim()}><Send size={13} aria-hidden="true" />发送问题</button></div></div>
            </form>

            <section className="lab-result-section" data-testid="lab-result" aria-labelledby="lab-result-title" aria-busy={running}>
              <div className="lab-result-top"><div className="lab-result-title"><MessageSquareText size={16} aria-hidden="true" /><h2 id="lab-result-title">回答与依据</h2></div><span className="lab-status-badge" data-status={state.status} role="status">{state.status === 'answered' && <Check size={11} aria-hidden="true" />}{STATUS[state.status]}</span></div>
              {state.problem && <div className="lab-notice" role="alert"><strong>{state.problem.code}</strong><br />{state.problem.message}</div>}
              {running ? <div className="lab-running"><p>正在规划工具并核验授权证据，可随时取消。</p><div className="lab-skeleton" /><div className="lab-skeleton" /><div className="lab-skeleton" /></div> : result ? <>
                <div className="lab-result-meta"><span>{result.providerKind === 'mock' ? 'MOCK · 确定性规则' : 'LOCAL · 受控规划'}</span><span>{PLANNING[result.modelPlanning]}</span><span>{state.dataSource === 'synthetic' ? 'synthetic · 合成数据' : '本机授权记录'}</span></div>
                <p className="lab-answer-text">{result.text}</p>
                {!!state.comparisons.length && <div className="lab-comparison" data-testid="lab-comparison"><h3><History size={14} aria-hidden="true" />历史比较门禁</h3>{state.comparisons.map(comparison => <p key={comparison.requestId}><strong>gate = {comparison.gate}</strong><br /><code>{comparison.reason ?? '已通过当前范围的比较门禁'}</code></p>)}</div>}
                <div className="lab-evidence" data-testid="lab-evidence"><div className="lab-evidence-heading"><h3>评分证据</h3><span>{result.citations.length} 条本地引用</span></div>{result.citations.length ? result.citations.map(citation => <Citation citation={citation} key={citation.requestId + citation.evidenceId} />) : <p className="lab-evidence-empty">本次没有有效证据引用，不会用模型输出补造成绩。</p>}</div>
                {!!result.findings.length && <details className="lab-limitations"><summary>本地评分分项 · {result.findings.length} 项</summary><ul>{result.findings.map(finding => <li key={finding.requestId + finding.criterionId}>{finding.label}：{finding.score} / 100 · {finding.criterionId} · {finding.evaluatedReps} 次有效动作</li>)}</ul></details>}
                {!!result.limitations.length && <details className="lab-limitations"><summary>有效样本与数据限制 · {result.limitations.length} 项</summary><ul>{result.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul></details>}
                <details className="lab-tools"><summary>工具执行记录 · {result.calls.length} 次</summary>{result.calls.length ? result.calls.map(call => <div className="lab-tool-row" key={call.requestId} data-ok={call.ok}><code>{call.tool ?? '未执行工具'}</code><span>{call.ok ? '成功' : `拒绝 / 失败：${call.problemCode ?? 'UNKNOWN'}`}</span><code>{call.requestId}</code></div>) : <p className="lab-help">未执行本地读取工具。</p>}</details>
              </> : <div className="lab-empty-result"><div className="lab-empty-icon"><BookOpen size={23} strokeWidth={1.5} aria-hidden="true" /></div><div><h3>每个回答，从可核验的记录开始</h3><p>选择上方示例或输入支持的问题。回答会列出原评分、来源和证据编号，合成数据不会被当作真人进步。</p></div></div>}
            </section>
          </div>
        </section>
      </div>
      <footer className="lab-footer"><span><FlaskConical size={11} aria-hidden="true" /> 开发实验台独立运行，不控制训练、不修改已有成绩，也不写入训练历史。</span><span>Phase 1F · 零 API 费用</span></footer>
    </main>
  </div>
}
